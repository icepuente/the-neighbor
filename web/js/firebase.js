// Starts Firebase and, outside production, connects every service to the emulators: by port on
// this PC, or through the page's own address in the demo (see firebase-config.js).
// Loaded as a module; page scripts use the services through window.NBF once the
// 'nbf-ready' event has fired (or right away if window.NBF is already set).
import { environment, firebaseConfig, functionsRegion, emulators } from './firebase-config.js';

// The SDK is served from this site (web/vendor/firebase), not Google's CDN.
const sdk = (name) => `../vendor/firebase/firebase-${name}.js`;

const [appMod, authMod, fsMod, fnMod, stMod] = await Promise.all(
  ['app', 'auth', 'firestore', 'functions', 'storage'].map((n) => import(sdk(n))),
);

const app = appMod.initializeApp(firebaseConfig);
const auth = authMod.getAuth(app);
let db;
let functions;
const storage = stMod.getStorage(app);

if (emulators?.mode === 'ports') {
  const { host } = emulators;
  authMod.connectAuthEmulator(auth, `http://${host}:${emulators.auth}`, { disableWarnings: true });
  db = fsMod.getFirestore(app);
  fsMod.connectFirestoreEmulator(db, host, emulators.firestore);
  functions = fnMod.getFunctions(app, functionsRegion);
  fnMod.connectFunctionsEmulator(functions, host, emulators.functions);
  stMod.connectStorageEmulator(storage, host, emulators.storage);
} else if (emulators?.mode === 'proxy') {
  // Behind nginx on this address, over HTTPS when the page is. The SDK's connect*Emulator helpers
  // would switch to plain HTTP on a separate port, so the documented alternatives are used:
  // Auth accepts an https:// emulator URL; Firestore takes host and ssl settings; Functions take a
  // custom domain (nginx maps /fn/<name> to the emulator).
  authMod.connectAuthEmulator(auth, emulators.origin, { disableWarnings: true });
  db = fsMod.initializeFirestore(app, { host: emulators.host, ssl: emulators.ssl });
  functions = fnMod.getFunctions(app, `${emulators.origin}/fn`);
  // Storage has no documented equivalent: point it at this address the way
  // connectStorageEmulator does internally, keeping the page's protocol. Checked by
  // test/browser/demo.js; revisit when upgrading the SDK.
  storage.host = emulators.host;
  storage._protocol = emulators.ssl ? 'https' : 'http';
} else {
  db = fsMod.getFirestore(app);
  functions = fnMod.getFunctions(app, functionsRegion);
}

// Make it obvious that this is not the real site.
if (environment !== 'production') {
  const bar = document.createElement('div');
  bar.className = 'env-bar';
  bar.textContent = environment === 'demo'
    ? 'Demo: intet her er rigtigt, ingen e-mails sendes, og alt slettes hver dag · Demo: nothing here is real, no emails are sent, and everything is wiped daily'
    : 'Testmiljø: Firebase-emulatorer · Test environment: Firebase emulators';
  document.body.prepend(bar);
}

window.NBF = {
  app, auth, db, functions, storage, environment, emulated: environment !== 'production',
  sdk: { auth: authMod, firestore: fsMod, functions: fnMod, storage: stMod },
};
window.dispatchEvent(new Event('nbf-ready'));

// For page modules: `const { NBF } = await import('./firebase.js')`.
export const NBF = window.NBF;
