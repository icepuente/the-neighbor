// Stops Firebase emulator processes that outlived their parent. On Windows, stopping
// `firebase emulators:start` or `emulators:exec` can leave the Java emulators (Firestore, the
// Storage rules runtime) holding their ports, so the next run fails. Only processes whose command
// line runs Firebase's emulator programs are stopped; nothing else is touched.
import { execFileSync } from 'node:child_process';

const PATTERNS = ['firebase\\emulators\\', 'firebase/emulators/', 'firebase-tools', 'emulators:'];

function windowsPids() {
  const ps = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out.split(/\r?\n/).map((line) => line.split('\t')).filter(([pid, cmd]) => {
    if (!cmd || Number(pid) === process.pid) return false;
    const isEmulatorJar = cmd.includes('.cache') && (cmd.includes(PATTERNS[0]) || cmd.includes(PATTERNS[1]));
    const isFirebaseEmulatorCli = cmd.includes(PATTERNS[2]) && cmd.includes(PATTERNS[3]);
    return isEmulatorJar || isFirebaseEmulatorCli;
  }).map(([pid]) => pid);
}

if (process.platform === 'win32') {
  const pids = windowsPids();
  for (const pid of pids) {
    try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
  }
  console.log(pids.length ? `stop-emulators: stopped ${pids.length} process(es)` : 'stop-emulators: nothing running');
} else {
  try { execFileSync('pkill', ['-f', '.cache/firebase/emulators/']); console.log('stop-emulators: stopped leftovers'); } catch { console.log('stop-emulators: nothing running'); }
}
