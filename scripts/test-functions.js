// Runs the Cloud Functions tests on a fresh, empty set of emulators, then always cleans up
// emulator leftovers (see stop-emulators.js), and exits with the tests' result.
// Storage is included so a Function touching files can never reach the real bucket during tests.
import { spawnSync } from 'node:child_process';

const run = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true }).status;

let status = run('npm run sync-shared');
if (status === 0) {
  status = run('npx firebase emulators:exec --only auth,firestore,functions,storage "node --test test/emulator/*.test.js"');
}
run('node scripts/stop-emulators.js');
process.exit(status ?? 1);
