// Runs the browser tests: the mock (no server needed), then the real site on the emulators. If
// `npm run dev` is already running, the web test uses those emulators; otherwise it starts a fresh
// set for the run and cleans up afterwards (see stop-emulators.js).
import { spawnSync } from 'node:child_process';

const run = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true }).status;
const up = async (url) => { try { await fetch(url, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; } };

let status = run('node test/browser/mock.js');
if (await up('http://127.0.0.1:5000/') && await up('http://127.0.0.1:5001/')) {
  console.log('\nweb: using the running emulators');
  status ||= run('npm run sync-shared && node test/browser/web.js && node test/browser/admin.js && node test/browser/account.js');
} else {
  console.log('\nweb: starting emulators for the run');
  status ||= run('npm run sync-shared && npx firebase emulators:exec --only auth,firestore,functions,storage,hosting "node test/browser/web.js && node test/browser/admin.js && node test/browser/account.js"');
  run('node scripts/stop-emulators.js');
}
process.exit(status ?? 1);
