// A small headless-Chrome driver for the browser tests, over the DevTools protocol (no extra
// packages). Chrome comes from CHROME_PATH or its usual install location. Screenshots go to
// test/browser/shots/ (git-ignored); each run uses a fresh, temporary Chrome profile.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..', '..');
export const FIXTURE = path.join(here, 'fixtures', 'bike.png');
const SHOTS = path.join(here, 'shots');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const errors = [];
let chrome; let ws; let msgId = 0; let n = 0; let profile;
const pending = new Map();

export function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Runs `expr` in the page and returns its value (awaiting promises). Return plain values only.
export async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  if (!r.result) throw new Error(`could not evaluate: ${expr.slice(0, 80)}`);
  return r.result.value;
}

export async function open(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 50; i++) { await sleep(100); if (await evaluate('document.readyState') === 'complete') break; }
  await sleep(300);
}

// Polls the page until `expr` is truthy.
export async function waitFor(expr, what, ms = 15000) {
  for (let i = 0; i < ms / 100; i++) { if (await evaluate(expr)) return; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}

export async function shot(name, height) {
  if (height) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
}

// Captures one element, wherever it is on the page.
export async function shotEl(name, selector) {
  const r = await evaluate(`(()=>{const b=document.querySelector('${selector}').getBoundingClientRect();return {x:b.left+scrollX,y:b.top+scrollY,w:b.width,h:b.height}})()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20, scale: 1 } });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
}

// Chooses a file in a file input, as a visitor would, then gives the page time to shrink it.
export async function setFile(selector, file = FIXTURE) {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await sleep(800);
}

export const check = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok ${++n} - ${msg}`);
};

async function start(port) {
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('Chrome not found: set CHROME_PATH');
  fs.mkdirSync(SHOTS, { recursive: true });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neighbor-chrome-'));
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' '));
  };
  await send('Runtime.enable');
  await send('Page.enable');
}

// Runs one test file's body in a fresh Chrome, then reports and cleans up.
export async function run(port, body) {
  try {
    await start(port);
    await body();
    check(errors.length === 0, `no script errors in the browser${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`\n${n} browser checks passed`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    chrome?.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a file */ }
  }
}
