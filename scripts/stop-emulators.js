// Stops Firebase emulator processes that outlived their parent. On Windows, stopping
// `firebase emulators:start` or `emulators:exec` can leave the Java emulators (Firestore, the
// Storage rules runtime) holding their ports, so the next run fails. Only node and java processes
// that run Firebase's emulator programs are stopped; nothing else is touched (a shell whose command
// line merely mentions them, for example, is left alone).
import { execFileSync } from 'node:child_process';

const isEmulatorJar = (name, cmd) => name === 'java.exe' && cmd.includes('.cache') && /firebase[\\/]emulators[\\/]/.test(cmd);
const isEmulatorCli = (name, cmd) => name === 'node.exe' && cmd.includes('firebase-tools') && /emulators:(start|exec)/.test(cmd);

function windowsPids() {
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\' OR Name=\'java.exe\'" | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)" }';
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return out.split(/\r?\n/).map((line) => line.split('\t'))
    .filter(([pid, name, cmd]) => cmd && Number(pid) !== process.pid && (isEmulatorJar(name, cmd) || isEmulatorCli(name, cmd)))
    .map(([pid]) => pid);
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
