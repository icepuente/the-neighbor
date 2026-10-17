// Docker health check for the emulators container: healthy once the emulator hub lists all four
// emulators and a Cloud Function actually answers.
const ok = async () => {
  const hub = await (await fetch('http://127.0.0.1:4400/emulators')).json();
  if (!['auth', 'firestore', 'functions', 'storage'].every((e) => hub[e])) return false;
  const res = await fetch('http://127.0.0.1:5001/demo-the-neighbor/europe-west1/bookingOptions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}',
  });
  return res.ok;
};
ok().then((up) => process.exit(up ? 0 : 1), () => process.exit(1));
