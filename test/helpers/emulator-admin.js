// Admin access to the EMULATORS for tests (Storage files, Firestore documents). The emulator
// addresses are set before firebase-admin starts, so this can never reach the real project.
// firebase-admin is installed in functions/, so it is loaded from there.
import { createRequire } from 'node:module';

process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { getApps, initializeApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

export const PROJECT = 'my-first-firebase-projec-b242f';
const app = getApps()[0] || initializeApp({ projectId: PROJECT });
export const bucket = getStorage(app).bucket(`${PROJECT}.firebasestorage.app`);

export const exists = async (path) => (await bucket.file(path).exists())[0];
export const listFiles = async (prefix) => (await bucket.getFiles({ prefix }))[0].map((f) => f.name);
