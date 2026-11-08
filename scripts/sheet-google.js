// The owner's Google Sheet through the Google APIs: a private sheet, no "anyone with the link".
//
//   npm run sheet-create [-- <editor email>] [--force]
//                       makes the spreadsheet "The Neighbor – tekster" from the export, formats it
//                       (frozen header, column widths, wrapping, warning-only protection of Hvor,
//                       Nøgle and Hjælp), writes its ID to the sheet-id file, prints the ID and URL,
//                       and shares it with the editor email if one is given (Google sends the mail)
//   npm run sheet-populate [-- --force]
//                       refreshes the existing sheet from the export (after texts changed in the
//                       code). Refuses while the sheet has edits the sync has not taken yet (cells
//                       that differ from both docs/review/sheet-state.json and the code), unless
//                       --force. Comments (Kommentar) are kept, row by row.
//   node scripts/sheet-google.js fetch --out=<file.csv>
//                       downloads the sheet as CSV (scripts/sheet-sync.sh uses this)
//
// Configuration (nothing secret is ever printed or logged):
//   $NEIGHBOR_SHEET_OAUTH  JSON file with client_id, client_secret and refresh_token (default
//                          ~/.config/the-neighbor/google-oauth.json; the client fields may also sit
//                          under "installed" or "web", as Google's download has them). The refresh
//                          token needs the scope https://www.googleapis.com/auth/drive.file only.
//   $NEIGHBOR_SHEET_ID     the spreadsheet's ID, or a file holding it (default
//                          ~/.config/the-neighbor/sheet-id; sheet-create writes it)
//   $NEIGHBOR_GOOGLE_API   for the tests: one base URL instead of Google's hosts
//
// Node's built-in fetch only, no dependencies.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as T from './texts-lib.js';
import { SHEET_HEAD, sheetRows, readFiles, readState } from './texts.js';

export const TITLE = 'The Neighbor – tekster';
export const TAB = 'Tekster';
const SCOPE_NOTE = 'drive.file';
const confDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'the-neighbor');
export const oauthFile = () => process.env.NEIGHBOR_SHEET_OAUTH || join(confDir(), 'google-oauth.json');
// NEIGHBOR_SHEET_ID is the ID itself, or a path to a file with it.
export const sheetIdSource = () => process.env.NEIGHBOR_SHEET_ID || join(confDir(), 'sheet-id');
const looksLikeId = (s) => /^[\w-]{20,}$/.test(s);

export class GoogleError extends Error {}
const fail = (msg) => { throw new GoogleError(msg); };

function endpoints() {
  const base = process.env.NEIGHBOR_GOOGLE_API;
  return base
    ? { token: `${base}/token`, sheets: `${base}/sheets/v4/spreadsheets`, drive: `${base}/drive/v3/files` }
    : { token: 'https://oauth2.googleapis.com/token', sheets: 'https://sheets.googleapis.com/v4/spreadsheets', drive: 'https://www.googleapis.com/drive/v3/files' };
}

export function readOAuth(file = oauthFile()) {
  if (!existsSync(file)) fail(`no Google credentials: ${file} is missing (client_id, client_secret, refresh_token)`);
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { fail(`${file} is not valid JSON`); }
  const c = { ...(j.installed || j.web || {}), ...j };
  const out = { client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token };
  const missing = Object.entries(out).filter(([, v]) => typeof v !== 'string' || !v).map(([k]) => k);
  if (missing.length) fail(`${file} has no ${missing.join(', ')}`);
  return out;
}

export function readSheetId(src = sheetIdSource()) {
  if (looksLikeId(src) && !existsSync(src)) return src;
  if (!existsSync(src)) return null;
  const id = readFileSync(src, 'utf8').trim();
  if (!looksLikeId(id)) fail(`${src} does not hold a spreadsheet ID`);
  return id;
}

// Google's answer, or a GoogleError with Google's own message (never the request: that holds the
// token or the secret).
async function call(fetchImpl, what, url, init) {
  let res;
  try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60000) }); } catch (e) { fail(`${what}: could not reach Google (${e.cause?.code || e.name})`); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = body?.error;
    const msg = typeof err === 'string' ? `${err}${body.error_description ? `: ${body.error_description}` : ''}` : err?.message || `HTTP ${res.status}`;
    fail(`${what}: ${msg} (HTTP ${res.status})`);
  }
  if (body == null) fail(`${what}: Google did not answer with JSON`);
  return body;
}

export async function accessToken(oauth, fetchImpl = fetch) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', ...oauth });
  const r = await call(fetchImpl, 'Google sign-in (refresh token)', endpoints().token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.access_token) fail('Google sign-in: no access token in the answer');
  return r.access_token;
}

// A small client: { get, post, put } with the token, JSON in and out.
export async function client({ fetchImpl = fetch, oauth = readOAuth() } = {}) {
  const token = await accessToken(oauth, fetchImpl);
  const req = (method) => (what, url, json) => call(fetchImpl, what, url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  return { get: req('GET'), post: req('POST'), put: req('PUT'), ep: endpoints() };
}

// The first tab's rows, as strings, padded to the header's width (the API leaves out empty cells at
// the end of a row).
export async function fetchRows(api, id) {
  const meta = await api.get('reading the sheet', `${api.ep.sheets}/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,title,index)`);
  const first = [...(meta.sheets || [])].sort((a, b) => a.properties.index - b.properties.index)[0];
  if (!first) fail('the spreadsheet has no tabs');
  const range = encodeURIComponent(`'${first.properties.title.replace(/'/g, "''")}'`);
  const r = await api.get('reading the sheet', `${api.ep.sheets}/${encodeURIComponent(id)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
  const rows = (r.values || []).map((row) => row.map((c) => String(c ?? '')));
  const width = Math.max(0, ...rows.map((x) => x.length));
  return { rows: rows.map((x) => [...x, ...Array(width - x.length).fill('')]), tab: first.properties };
}

// Cells the sync has not taken yet: the sheet differs from what it held at the last sync (the
// state) and from the code, so writing over it would lose an edit (or a conflict, or a rejected
// SLET, still to be sorted out).
export function pendingEdits(rows, files, state) {
  const head = rows[0]?.map((h) => h.trim()) || [];
  const col = (n) => head.indexOf(n);
  if (col('Nøgle') < 0) return ['the sheet has no "Nøgle" column'];
  const entries = new Map(T.collect(files).map((e) => [e.key, e]));
  const out = [];
  for (const r of rows.slice(1)) {
    const key = (r[col('Nøgle')] || '').trim();
    const e = entries.get(key);
    if (!e) continue;
    for (const lang of T.LANGS) {
      const c = col(lang === 'da' ? 'Dansk' : 'English');
      if (c < 0 || e[lang] == null) continue;
      const sheet = T.norm(e.kind, r[c]);
      const known = state?.[key] && lang in state[key];
      if ((known && sheet === T.norm(e.kind, state[key][lang])) || sheet === T.norm(e.kind, e[lang])) continue;
      out.push(`${key} (${lang}): "${sheet.length > 60 ? `${sheet.slice(0, 57)}...` : sheet}"`);
    }
  }
  return out;
}

// The export, with each row's comment carried over from the old sheet.
function exportValues(oldRows = []) {
  const head = oldRows[0]?.map((h) => h.trim()) || [];
  const k = head.indexOf('Nøgle');
  const c = head.indexOf('Kommentar');
  const comments = new Map(k >= 0 && c >= 0 ? oldRows.slice(1).map((r) => [r[k], r[c]]).filter(([, v]) => v) : []);
  return [SHEET_HEAD, ...sheetRows().map((r) => [...r.slice(0, 5), comments.get(r[1]) ?? r[5]])];
}

// Frozen header in bold, column widths, wrapping in the text columns, and a warning (not a lock)
// when someone edits Hvor, Nøgle or Hjælp.
function formatRequests(sheetId) {
  const widths = [150, 190, 420, 420, 260, 220];
  const col = (name) => SHEET_HEAD.indexOf(name);
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    ...widths.map((px, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId, startRowIndex: 0 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } },
    ...['Hvor', 'Nøgle', 'Hjælp'].map((name) => ({ addProtectedRange: { protectedRange: {
      range: { sheetId, startColumnIndex: col(name), endColumnIndex: col(name) + 1 },
      description: `${name}: bruges af hjemmesiden, ret ikke her`, warningOnly: true,
    } } })),
  ];
}

const writeValues = (api, id, tabTitle, values) => api.put('writing the texts',
  `${api.ep.sheets}/${encodeURIComponent(id)}/values/${encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'!A1`)}?valueInputOption=RAW`,
  { range: `'${tabTitle.replace(/'/g, "''")}'!A1`, majorDimension: 'ROWS', values });

export async function createSheet({ api, editor, idFile = sheetIdSource(), force = false, log = console.log }) {
  if (!force && existsSync(idFile) && readFileSync(idFile, 'utf8').trim()) fail(`${idFile} already names a sheet; use sheet-populate to refresh it, or --force to make a new one`);
  if (editor && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editor)) fail(`"${editor}" is not an email address`);
  const values = exportValues();
  const made = await api.post('creating the spreadsheet', api.ep.sheets, {
    properties: { title: TITLE, locale: 'da_DK' },
    sheets: [{ properties: { title: TAB, gridProperties: { rowCount: values.length + 20, columnCount: SHEET_HEAD.length, frozenRowCount: 1 } } }],
  });
  const id = made.spreadsheetId;
  const sheetId = made.sheets?.[0]?.properties?.sheetId ?? 0;
  if (!id) fail('creating the spreadsheet: Google returned no ID');
  // The ID first: if a later step fails, the sheet is not lost.
  mkdirSync(dirname(idFile), { recursive: true });
  writeFileSync(idFile, `${id}\n`);
  await writeValues(api, id, TAB, values);
  await api.post('formatting the sheet', `${api.ep.sheets}/${encodeURIComponent(id)}:batchUpdate`, { requests: formatRequests(sheetId) });
  if (editor) {
    await api.post(`sharing with ${editor}`, `${api.ep.drive}/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true&fields=id`, { role: 'writer', type: 'user', emailAddress: editor });
  }
  const url = made.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit`;
  log(`Made "${TITLE}" with ${values.length - 1} texts.\nID:  ${id}\nURL: ${url}\nThe ID is in ${idFile}.${editor ? `\nShared with ${editor} as editor (Google emails them).` : ''}`);
  return { id, url };
}

export async function populateSheet({ api, id, force = false, files = readFiles(), state = readState(), log = console.log }) {
  const { rows, tab } = await fetchRows(api, id);
  const pending = rows.length ? pendingEdits(rows, files, state) : [];
  if (pending.length && !force) {
    fail(`the sheet has ${pending.length} cell(s) the sync has not taken yet; run the sync first (or fix them), or use --force to overwrite them:\n${pending.map((x) => `- ${x}`).join('\n')}`);
  }
  const values = exportValues(rows);
  // Clear first, so a sheet with more rows than the export keeps no stale ones.
  await api.post('clearing the sheet', `${api.ep.sheets}/${encodeURIComponent(id)}/values/${encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'`)}:clear`, {});
  await writeValues(api, id, tab.title, values);
  log(`Refreshed the sheet with ${values.length - 1} texts${pending.length ? ` (overwrote ${pending.length} unsynced cell(s))` : ''}. The next sync records it in docs/review/sheet-state.json.`);
}

export async function fetchCsv({ api, id }) {
  const { rows } = await fetchRows(api, id);
  if (!rows.length) fail('the sheet is empty');
  return T.toCsv(rows, ',', false);
}

async function main(argv) {
  const [cmd, ...args] = argv;
  const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const force = args.includes('--force');
  const positional = args.filter((a) => !a.startsWith('--'));
  const needId = () => readSheetId() || fail(`no spreadsheet ID: set NEIGHBOR_SHEET_ID or write it to ${sheetIdSource()} (sheet-create does)`);
  if (cmd === 'fetch' && opt('out')) {
    const id = needId();
    writeFileSync(opt('out'), await fetchCsv({ api: await client(), id }));
    return 0;
  }
  if (cmd === 'create') {
    const idSrc = sheetIdSource();
    if (looksLikeId(idSrc) && !existsSync(idSrc)) fail('NEIGHBOR_SHEET_ID holds an ID; for sheet-create it must be a file path (or unset)');
    await createSheet({ api: await client(), editor: positional[0], idFile: idSrc, force });
    return 0;
  }
  if (cmd === 'populate') {
    await populateSheet({ api: await client(), id: needId(), force });
    return 0;
  }
  console.log(`Usage: node scripts/sheet-google.js fetch --out=<file.csv> | create [<editor email>] [--force] | populate [--force]   (scope: ${SCOPE_NOTE})`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    if (!(e instanceof GoogleError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  });
}
