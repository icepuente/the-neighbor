// Business accounts on the emulators (phase 4): createCompany (company, the contact's login, the
// invite), the rules for a company's data, and saveFleetReport. Run with `npm run test:functions`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = 'my-first-firebase-projec-b242f';
const FS = `http://127.0.0.1:8085/v1/projects/${P}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${P}/europe-west1`;
const ADMIN = { Authorization: 'Bearer owner' }; // emulator-only bypass, to look at results
const json = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email, password) {
  const s = await (await fetch(`${AUTH}/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: json, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json();
  return s.idToken ? { Authorization: `Bearer ${s.idToken}` } : null;
}
async function account(email, claims) {
  const body = { email, password: 'secret-password', returnSecureToken: true };
  const r = await (await fetch(`${AUTH}/accounts:signUp?key=demo`, { method: 'POST', headers: json, body: JSON.stringify(body) })).json();
  if (claims) {
    await fetch(`${AUTH}/projects/${P}/accounts:update`, { method: 'POST', headers: { ...ADMIN, ...json }, body: JSON.stringify({ localId: r.localId, customAttributes: JSON.stringify(claims) }) });
  }
  return signIn(email, 'secret-password');
}
const call = async (name, data, headers = {}) => (await fetch(`${FN}/${name}`, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify({ data }) })).json();
const read = (path, headers) => fetch(`${FS}/${path}`, { headers });
// Firestore REST values from plain strings, numbers and (empty) lists.
const value = (v) => {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { stringValue: v };
};
const write = (path, data, headers, mask) => fetch(`${FS}/${path}${mask ? `?${Object.keys(data).map((k) => `updateMask.fieldPaths=${k}`).join('&')}` : ''}`, {
  method: 'PATCH', headers: { ...headers, ...json }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, value(v)])) }),
});
const mailFor = async (to) => ((await (await fetch(`${FS}/mail?pageSize=300`, { headers: ADMIN })).json()).documents || [])
  .filter((d) => d.fields.to.stringValue === to).map((d) => d.fields.message.mapValue.fields);
async function lead(company, email) {
  const input = { name: 'Bo Hansen', company, email, phone: '+45 11 22 33 44', companyType: 'Hotel', bikes: '6–15', message: 'Fleet care, please.' };
  return (await call('createConsultation', { input })).result.lead.id;
}

let owner;
let companyId;
let contact;

test('createCompany: owner only; sets up the company, the contact\'s login and the invite', async () => {
  owner = await account('owner-business@example.com', { admin: true });
  const leadId = await lead('Hotel Test', 'bo@hotel-test.dk');
  const customer = await account('not-owner@example.com');
  assert.equal((await call('createCompany', { leadId, plan: 'standard' }, customer)).error?.status, 'PERMISSION_DENIED', 'not for customers');
  assert.equal((await call('createCompany', { leadId, plan: 'gold' }, owner)).result.error, 'plan', 'a known plan only');
  const r = (await call('createCompany', { leadId, plan: 'standard' }, owner)).result;
  assert.equal(r.ok, true);
  companyId = r.companyId;
  assert.equal((await call('createCompany', { leadId, plan: 'standard' }, owner)).result.error, 'exists', 'once per request');

  const c = (await (await read(`companies/${companyId}`, owner)).json()).fields;
  assert.deepEqual([c.name.stringValue, c.plan.stringValue, c.pricePerBike.integerValue, c.contact.stringValue, c.status.stringValue],
    ['Hotel Test', 'standard', '300', 'Bo Hansen', 'active'], 'the company, from the request and the plan');
  const l = (await (await read(`consultations/${leadId}`, owner)).json()).fields;
  assert.deepEqual([l.status.stringValue, l.companyId.stringValue], ['won', companyId], 'the request is won and points to the company');
  const invite = (await mailFor('bo@hotel-test.dk')).find((m) => m.subject.stringValue === 'Your business account at The Neighbor');
  assert.ok(invite?.text.stringValue.includes('Standard plan'), 'the contact gets the invite');

  // On the emulators the invite cannot be sent, so the contact gets the demo password.
  contact = await signIn('bo@hotel-test.dk', 'neighbor-demo');
  assert.ok(contact, 'the contact can sign in');
  const claims = JSON.parse(Buffer.from(contact.Authorization.split('.')[1], 'base64url').toString());
  assert.equal(claims.companyId, companyId, 'with the company in the token');
  const profile = (await (await read(`users/${claims.user_id}`, ADMIN)).json()).fields;
  assert.deepEqual([profile.role.stringValue, profile.companyId.stringValue], ['business', companyId]);
});

test('createCompany refuses an email that already has a private account', async () => {
  const u = await account('private-person@example.com');
  await call('syncAccount', { profile: { name: 'Private Person' } }, u);
  const leadId = await lead('Taken Ltd', 'private-person@example.com');
  assert.equal((await call('createCompany', { leadId, plan: 'basic' }, owner)).result.error, 'taken');
});

test('company data: the members and the owner read it; the owner keeps the fleet', async () => {
  const other = await account('other-company@example.com', { companyId: 'someone-else' });
  const customer = await account('just-a-customer@example.com');
  assert.equal((await read(`companies/${companyId}`, contact)).status, 200, 'the contact reads their company');
  assert.equal((await read(`companies/${companyId}`, other)).status, 403, "not another company's member");
  assert.equal((await read(`companies/${companyId}`, customer)).status, 403, 'not a private customer');

  const bike = { number: '#001', type: 'City bike', location: 'Reception', year: '2022', photos: [] };
  assert.equal((await write(`companies/${companyId}/bikes/b1`, bike, owner)).status, 200, 'the owner adds a bike');
  assert.equal((await write(`companies/${companyId}/bikes/b2`, { ...bike, number: '#002' }, owner)).status, 200);
  assert.equal((await write(`companies/${companyId}/bikes/b3`, { ...bike, number: '' }, owner)).status, 403, 'a bike needs a number');
  assert.equal((await write(`companies/${companyId}/bikes/b3`, { ...bike, price: 5 }, owner)).status, 403, 'known fields only');
  assert.equal((await write(`companies/${companyId}/bikes/b3`, bike, contact)).status, 403, 'the contact cannot change the fleet');
  assert.equal((await read(`companies/${companyId}/bikes/b1`, contact)).status, 200, 'but reads it');
  assert.equal((await read(`companies/${companyId}/bikes/b1`, other)).status, 403);

  assert.equal((await write(`companies/${companyId}`, { nextVisit: '2026-11-03', status: 'active' }, owner, true)).status, 200, 'the owner sets the next visit');
  assert.equal((await write(`companies/${companyId}`, { status: 'gone' }, owner, true)).status, 403, 'a known status only');
  assert.equal((await write(`companies/${companyId}`, { pricePerBike: 1 }, owner, true)).status, 403, 'not the price');
  assert.equal((await write(`companies/${companyId}`, { nextVisit: '2026-11-04' }, contact, true)).status, 403, 'not as the contact');
});

test('saveFleetReport: owner only; counts the statuses, emails the contact, and updates a month', async () => {
  const entries = { b1: { status: 'ready', action: '', note: '' }, b2: { status: 'repair', action: 'New wheel', note: 'Bent rim' }, nope: { status: 'ready' } };
  const base = { companyId, month: '2026-10', visitDate: '2026-10-08', entries };
  assert.equal((await call('saveFleetReport', base, contact)).error?.status, 'PERMISSION_DENIED', 'not for the contact');
  assert.equal((await call('saveFleetReport', { ...base, month: '2026-13' }, owner)).result.error, 'month');
  assert.equal((await call('saveFleetReport', { ...base, entries: { nope: { status: 'ready' } } }, owner)).result.error, 'entries', 'bikes of this fleet only');
  const r = (await call('saveFleetReport', base, owner)).result;
  assert.deepEqual(r.counts, { ready: 1, attention: 0, repair: 1 });
  const rep = (await (await read(`companies/${companyId}/reports/2026-10`, contact)).json()).fields;
  assert.deepEqual(Object.keys(rep.entries.mapValue.fields).sort(), ['b1', 'b2'], 'unknown bikes are left out');
  assert.equal(rep.entries.mapValue.fields.b1.mapValue.fields.action.stringValue, '–', 'an empty action shows a dash');
  assert.equal((await write(`companies/${companyId}/reports/2026-11`, { month: '2026-11' }, owner)).status, 403, 'reports are written by the Function only');
  await call('saveFleetReport', { ...base, entries: { ...entries, b2: { status: 'attention', action: 'Wheel trued' } } }, owner);
  await sleep(500);
  const subjects = (await mailFor('bo@hotel-test.dk')).map((m) => m.subject.stringValue);
  assert.ok(subjects.includes('Fleet report ready: October 2026') && subjects.includes('Fleet report updated: October 2026'), 'the contact is emailed each time');
});
