// Starts Firebase and, on this PC, connects every service to the emulators.
// Loaded as a module; page scripts use the services through window.NBF once the
// 'nbf-ready' event has fired (or right away if window.NBF is already set).
import { firebaseConfig, functionsRegion, emulators } from './firebase-config.js';

// The SDK is served from this site (web/vendor/firebase), not Google's CDN.
const sdk = (name) => `../vendor/firebase/firebase-${name}.js`;

const [appMod, authMod, fsMod, fnMod, stMod] = await Promise.all(
  ['app', 'auth', 'firestore', 'functions', 'storage'].map((n) => import(sdk(n))),
);

const app = appMod.initializeApp(firebaseConfig);
const auth = authMod.getAuth(app);
const db = fsMod.getFirestore(app);
const functions = fnMod.getFunctions(app, functionsRegion);
const storage = stMod.getStorage(app);

if (emulators) {
  const { host } = emulators;
  authMod.connectAuthEmulator(auth, `http://${host}:${emulators.auth}`, { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, host, emulators.firestore);
  fnMod.connectFunctionsEmulator(functions, host, emulators.functions);
  stMod.connectStorageEmulator(storage, host, emulators.storage);

  // Make it obvious that this is not the real site.
  const bar = document.createElement('div');
  bar.className = 'env-bar';
  bar.textContent = 'Testmiljø: Firebase-emulatorer · Test environment: Firebase emulators';
  document.body.prepend(bar);
}

window.NBF = {
  app, auth, db, functions, storage, emulated: Boolean(emulators),
  sdk: { auth: authMod, firestore: fsMod, functions: fnMod, storage: stMod },
};
window.dispatchEvent(new Event('nbf-ready'));

// For page modules: `const { NBF } = await import('./firebase.js')`.
export const NBF = window.NBF;
