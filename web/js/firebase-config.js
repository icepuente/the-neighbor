// Firebase settings for the site. These values are public by design (they identify the project;
// security comes from the rules and Functions), so they live in the repo.
//
// One codebase, three environments (docs/firebase-plan.md, section 3), chosen by where the page is
// served from:
// - 'local': this PC, `npm run dev` (127.0.0.1 or localhost, port 5000). Each service talks to its
//   emulator port directly.
// - 'production': Firebase Hosting (the project's web.app / firebaseapp.com addresses, and later the
//   .dk domain, added to PRODUCTION_HOSTS). The real project.
// - 'demo': anywhere else, such as book.icepuente.com on the home server (phase 7). The emulators sit
//   behind nginx on the same address as the site (deploy/demo/nginx.conf), and the project is
//   `demo-the-neighbor`: Firebase treats demo- projects as emulator-only, so the demo can never
//   reach the real project.
//
// The Firebase JS SDK itself is served from web/vendor/firebase/ (copied from the `firebase` npm
// package, whose version is pinned in package.json, by scripts/sync-vendor.js).

const PROJECT_ID = 'my-first-firebase-projec-b242f';
const PRODUCTION_HOSTS = [`${PROJECT_ID}.web.app`, `${PROJECT_ID}.firebaseapp.com`];

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5000';
export const environment = PRODUCTION_HOSTS.includes(location.hostname) ? 'production' : isLocal ? 'local' : 'demo';

const production = {
  apiKey: 'AIzaSyC7LspI7yhyEtwCvsyetWZNHpTmOsuMnOc',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: '143967181905',
  appId: '1:143967181905:web:2328886c15b878e5836c70',
};
// The emulators accept any API key and app id.
const DEMO_PROJECT = 'demo-the-neighbor';
const demo = { ...production, projectId: DEMO_PROJECT, authDomain: location.host, storageBucket: `${DEMO_PROJECT}.firebasestorage.app` };

export const firebaseConfig = environment === 'demo' ? demo : production;

// Functions run in the same region as the data.
export const functionsRegion = 'europe-west1';

// How to reach the emulators: by port on this PC (ports match "emulators" in firebase.json), or
// through the page's own address in the demo.
export const emulators = {
  local: { mode: 'ports', host: location.hostname, auth: 9099, firestore: 8085, storage: 9199, functions: 5001 },
  demo: { mode: 'proxy', origin: location.origin, host: location.host, ssl: location.protocol === 'https:' },
}[environment] || null;
