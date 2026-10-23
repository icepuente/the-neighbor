// Runs the browser test (test/browser/site.js) against the local server: uses `npm run serve` if it
// is already running on port 5000, otherwise starts one for the run and stops it afterwards.
import { spawn, spawnSync } from 'node:child_process';

const SITE = 'http://127.0.0.1:5000/';
const up = async () => { try { return (await fetch(SITE, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

spawnSync(process.execPath, ['scripts/vendor.js'], { stdio: 'inherit' });
let server = null;
if (!await up()) {
  server = spawn(process.execPath, ['scripts/serve.js'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !await up(); i++) await new Promise((r) => setTimeout(r, 100));
}
const { status } = spawnSync(process.execPath, ['test/browser/site.js'], { stdio: 'inherit', env: { ...process.env, SITE } });
server?.kill();
process.exit(status ?? 1);
