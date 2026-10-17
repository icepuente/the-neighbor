// Makes an account the owner: sets the `admin` custom claim that firestore.rules and storage.rules
// check, creating the account first if it does not exist (then --password is required).
//
//   node scripts/set-owner.js <email> --emulator [--password <pw>]   (local emulators)
//   node scripts/set-owner.js <email> [--password <pw>]              (the real project; needs
//      `gcloud auth application-default login` as a project Owner first)
//
// The owner signs in on admin.html with this email and password. Changing the claim takes effect at
// the owner's next sign-in.
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--password');
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!email) {
  console.error('usage: node scripts/set-owner.js <email> [--emulator] [--password <pw>]');
  process.exit(2);
}
if (flag('emulator')) process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const projectId = value('project') || 'my-first-firebase-projec-b242f';
const auth = getAuth(initializeApp({ projectId }));

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e;
  const password = value('password');
  if (!password) { console.error(`${email} has no account yet: give --password to create it`); process.exit(1); }
  user = await auth.createUser({ email, password, emailVerified: true });
  console.log(`created ${email}`);
}
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
console.log(`${email} is now the owner (admin claim set) on ${flag('emulator') ? 'the emulators' : projectId}`);
