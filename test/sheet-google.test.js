// The private Google Sheet: scripts/sheet-google.js against a mocked Google (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as T from '../scripts/texts-lib.js';
import * as G from '../scripts/sheet-google.js';
import { SHEET_HEAD, sheetRows } from '../scripts/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = Object.fromEntries(Object.entries(T.FILES).map(([k, f]) => [k, readFileSync(join(root, f), 'utf8')]));
const STATE = JSON.parse(readFileSync(join(root, 'docs/review/sheet-state.json'), 'utf8')).texts;
const OAUTH = { client_id: 'cid.apps.googleusercontent.com', client_secret: 'SECRET-xyz', refresh_token: 'REFRESH-abc' };
const TOKEN = 'ya29.ACCESS-123';
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

// A fake Google: records every request and answers from a spreadsheet held in memory.
function fakeGoogle({ values = null, tokenError = null } = {}) {
  const calls = [];
  const sheet = { values, title: 'Tekster' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body == null ? null : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : JSON.parse(init.body);
    calls.push({ method: init.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), auth: init.headers?.authorization, body });
    if (u.hostname === 'oauth2.googleapis.com') {
      if (tokenError) return json({ error: 'invalid_grant', error_description: tokenError }, 400);
      return json({ access_token: TOKEN, expires_in: 3599, token_type: 'Bearer' });
    }
    if (init.headers?.authorization !== `Bearer ${TOKEN}`) return json({ error: { code: 401, message: 'Request had invalid authentication credentials.' } }, 401);
    const p = decodeURIComponent(u.pathname);
    if (init.method === 'POST' && p === '/v4/spreadsheets') return json({ spreadsheetId: ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`, sheets: [{ properties: { sheetId: 0, title: 'Tekster' } }] });
    if (p === `/v4/spreadsheets/${ID}` && (init.method || 'GET') === 'GET') return json({ sheets: [{ properties: { sheetId: 0, title: sheet.title, index: 0 } }] });
    if (p.startsWith(`/v4/spreadsheets/${ID}/values/`)) {
      if (p.endsWith(':clear')) { sheet.values = []; return json({}); }
      if (init.method === 'PUT') { sheet.values = body.values; return json({ updatedRows: body.values.length }); }
      // The API leaves out empty cells at the end of a row.
      return json({ range: 'Tekster!A1:F300', values: (sheet.values || []).map((r) => { const x = [...r]; while (x.length && x.at(-1) === '') x.pop(); return x; }) });
    }
    if (p === `/v4/spreadsheets/${ID}:batchUpdate`) return json({ replies: [] });
    if (p === `/drive/v3/files/${ID}/permissions`) return json({ id: 'perm1' });
    return json({ error: { code: 404, message: `not mocked: ${init.method} ${p}` } }, 404);
  };
  return { calls, sheet, fetchImpl };
}
const exported = () => [SHEET_HEAD, ...sheetRows()];
const noSecrets = (s) => { for (const x of [TOKEN, OAUTH.client_secret, OAUTH.refresh_token]) assert.ok(!String(s).includes(x), `"${x}" leaked`); };

test('credentials: a flat file or Google\'s "installed" download plus a refresh token; anything missing is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-'));
  try {
    const f = join(dir, 'o.json');
    writeFileSync(f, JSON.stringify(OAUTH));
    assert.deepEqual(G.readOAuth(f), OAUTH);
    writeFileSync(f, JSON.stringify({ installed: { client_id: OAUTH.client_id, client_secret: OAUTH.client_secret }, refresh_token: OAUTH.refresh_token }));
    assert.deepEqual(G.readOAuth(f), OAUTH);
    writeFileSync(f, JSON.stringify({ client_id: 'x' }));
    assert.throws(() => G.readOAuth(f), (e) => /client_secret, refresh_token/.test(e.message));
    assert.throws(() => G.readOAuth(join(dir, 'none.json')), /missing/);
    writeFileSync(join(dir, 'id'), `${ID}\n`);
    assert.equal(G.readSheetId(join(dir, 'id')), ID);
    assert.equal(G.readSheetId(ID), ID, 'or the ID itself');
    assert.equal(G.readSheetId(join(dir, 'nope')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sign-in: an access token from the refresh token; Google\'s refusal is reported without any secret', async () => {
  const g = fakeGoogle();
  assert.equal(await G.accessToken(OAUTH, g.fetchImpl), TOKEN);
  assert.deepEqual(g.calls[0].body, { grant_type: 'refresh_token', ...OAUTH });
  const bad = fakeGoogle({ tokenError: 'Token has been expired or revoked.' });
  await assert.rejects(G.accessToken(OAUTH, bad.fetchImpl), (e) => { noSecrets(e.message); return /invalid_grant: Token has been expired or revoked\. \(HTTP 400\)/.test(e.message); });
  // Google unreachable.
  await assert.rejects(G.accessToken(OAUTH, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }), /could not reach Google \(ENOTFOUND\)/);
});

test('fetch: the first tab through values.get, padded, as CSV the import reads unchanged', async () => {
  const g = fakeGoogle({ values: exported() });
  const api = await G.client({ fetchImpl: g.fetchImpl, oauth: OAUTH });
  const csv = await G.fetchCsv({ api, id: ID });
  const rows = T.parseCsv(T.decodeCsv(Buffer.from(csv)));
  assert.deepEqual(rows, exported());
  const get = g.calls.find((c) => c.path.includes('/values/'));
  assert.equal(get.query.valueRenderOption, 'FORMATTED_VALUE');
  assert.equal(decodeURIComponent(get.path).split('/values/')[1], "'Tekster'");
  const r = T.importSheet(FILES, rows, STATE);
  assert.deepEqual([r.changes, r.conflicts, r.warnings], [[], [], []]);
  // Every call after sign-in carries the token, and the token goes nowhere else.
  for (const c of g.calls.slice(1)) assert.equal(c.auth, `Bearer ${TOKEN}`);
  noSecrets(csv);
});

test('create: the spreadsheet, filled from the export, formatted, protected (warning only), shared, ID saved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-'));
  try {
    const g = fakeGoogle();
    const api = await G.client({ fetchImpl: g.fetchImpl, oauth: OAUTH });
    const idFile = join(dir, 'conf', 'sheet-id');
    const out = [];
    const r = await G.createSheet({ api, editor: 'owner@example.dk', idFile, log: (s) => out.push(s) });
    assert.equal(r.id, ID);
    assert.equal(readFileSync(idFile, 'utf8').trim(), ID);
    const [create, put, batch, share] = g.calls.slice(1);
    assert.equal(create.body.properties.title, 'The Neighbor – tekster');
    assert.equal(put.method, 'PUT');
    assert.equal(put.query.valueInputOption, 'RAW', 'texts go in as typed: no formulas, no number guessing');
    assert.deepEqual(put.body.values, exported());
    const reqs = batch.body.requests;
    assert.ok(reqs.some((q) => q.updateSheetProperties?.properties.gridProperties.frozenRowCount === 1), 'header frozen');
    assert.ok(reqs.some((q) => q.repeatCell?.cell.userEnteredFormat.wrapStrategy === 'WRAP'), 'wrapping');
    assert.equal(reqs.filter((q) => q.updateDimensionProperties).length, 6, 'column widths');
    const prot = reqs.filter((q) => q.addProtectedRange).map((q) => q.addProtectedRange.protectedRange);
    assert.deepEqual(prot.map((p) => [p.range.startColumnIndex, p.warningOnly]), [[0, true], [1, true], [4, true]], 'Hvor, Nøgle, Hjælp: a warning, not a lock');
    assert.equal(share.path, `/drive/v3/files/${ID}/permissions`);
    assert.equal(share.query.sendNotificationEmail, 'true');
    assert.deepEqual(share.body, { role: 'writer', type: 'user', emailAddress: 'owner@example.dk' });
    assert.match(out.join(), new RegExp(`ID:  ${ID}[\\s\\S]*URL: https://docs.google.com/spreadsheets/d/${ID}/edit`));
    noSecrets(out.join());
    // Not twice over an existing sheet, and no sharing with a non-address.
    await assert.rejects(G.createSheet({ api, idFile, log() {} }), /already names a sheet.*sheet-populate/);
    await assert.rejects(G.createSheet({ api, idFile, force: true, editor: 'not-an-email', log() {} }), /not an email address/);
    // Without an editor: nothing is shared.
    const g2 = fakeGoogle();
    await G.createSheet({ api: await G.client({ fetchImpl: g2.fetchImpl, oauth: OAUTH }), idFile: join(dir, 'id2'), log() {} });
    assert.ok(!g2.calls.some((c) => c.path.includes('permissions')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('populate: refuses over edits the sync has not taken (unless --force); keeps comments; fine over a stale sheet', async () => {
  const old = exported();
  const keyCol = 1;
  const row = (key) => old.findIndex((r) => r[keyCol] === key);
  // A pending edit (sheet differs from the state and the code) and a comment.
  old[row('hero.lead')][2] = 'Ejerens nye lead';
  old[row('faq.pay')][5] = 'Husk MobilePay-nummeret';
  const g = fakeGoogle({ values: old.map((r) => [...r]) });
  const api = await G.client({ fetchImpl: g.fetchImpl, oauth: OAUTH });
  await assert.rejects(G.populateSheet({ api, id: ID, files: FILES, state: STATE, log() {} }), (e) => /1 cell\(s\) the sync has not taken yet/.test(e.message) && /hero\.lead \(da\): "Ejerens nye lead"/.test(e.message));
  assert.ok(!g.calls.some((c) => c.method === 'PUT' || c.path.endsWith(':clear')), 'nothing written');
  const msgs = [];
  await G.populateSheet({ api, id: ID, force: true, files: FILES, state: STATE, log: (s) => msgs.push(s) });
  assert.match(msgs.join(), /overwrote 1 unsynced cell/);
  const now = g.sheet.values;
  assert.equal(now[row('hero.lead')][2], T.collect(FILES).find((e) => e.key === 'hero.lead').da, 'the export again');
  assert.equal(now.find((r) => r[keyCol] === 'faq.pay')[5], 'Husk MobilePay-nummeret', 'the comment is kept');
  assert.equal(now.length, exported().length);
  // A stale sheet (the code moved on, the sheet still has the old text, as the state does) is
  // not an edit: populate goes ahead.
  const code = { ...FILES, i18n: T.setSiteText(FILES.i18n, 'da', 'hero.title', 'Ny fra koden') };
  assert.deepEqual(G.pendingEdits(exported(), code, STATE), []);
  // Nor is a cell that already matches the code, or a deleted text shown as SLET in both.
  const r = T.importSheet(FILES, [SHEET_HEAD, ...sheetRows().map((x) => (x[1] === 'faq.payA' ? [x[0], x[1], 'SLET', 'SLET', x[4], ''] : x))], STATE);
  assert.deepEqual(G.pendingEdits([SHEET_HEAD, ...sheetRows(T.collect(r.files))], r.files, STATE), []);
  // A rejected SLET on a protected text is still waiting for the owner: populate refuses.
  const rejected = exported().map((x) => (x[1] === 'co.send' ? [x[0], x[1], 'SLET', x[3], x[4], ''] : x));
  assert.match(G.pendingEdits(rejected, FILES, STATE).join(), /co\.send \(da\): "SLET"/);
});
