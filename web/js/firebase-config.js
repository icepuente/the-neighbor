// Firebase settings for the site. These values are public by design (they identify the project;
// security comes from the rules and Functions), so they live in the repo.
//
// One codebase, two environments (docs/firebase-plan.md, section 3): on this PC (localhost) the
// site talks to the Firebase emulators; anywhere else it talks to the real project. The home-server
// demo (phase 7) will set `emulators` to its HTTPS host instead.
//
// The Firebase JS SDK itself is served from web/vendor/firebase/ (copied from the `firebase` npm
// package, whose version is pinned in package.json, by scripts/sync-vendor.js).

export const firebaseConfig = {
  apiKey: 'AIzaSyC7LspI7yhyEtwCvsyetWZNHpTmOsuMnOc',
  authDomain: 'my-first-firebase-projec-b242f.firebaseapp.com',
  projectId: 'my-first-firebase-projec-b242f',
  storageBucket: 'my-first-firebase-projec-b242f.firebasestorage.app',
  messagingSenderId: '143967181905',
  appId: '1:143967181905:web:2328886c15b878e5836c70',
};

// Functions run in the same region as the data.
export const functionsRegion = 'europe-west1';

const local = ['localhost', '127.0.0.1'].includes(location.hostname);

// Ports match "emulators" in firebase.json.
export const emulators = local
  ? { host: location.hostname, auth: 9099, firestore: 8085, storage: 9199, functions: 5001 }
  : null;
