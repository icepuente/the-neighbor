// Copies third-party browser files from node_modules into web/vendor/ (git-ignored), so the site
// loads nothing from Google's servers before the visitor does anything (no IP address shared just
// for fonts or program code):
// - The Firebase JS SDK modules (the `firebase` package, pinned in package.json). Each module imports
//   firebase-app.js by its full gstatic URL; that import is rewritten to the local copy.
// - The fonts (Fontsource packages, OFL-1.1), with their licences. web/css/fonts.css uses them.
// Runs as part of `npm run sync-shared`, so before the emulators start and before every deploy.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'web', 'vendor');

// ---- Firebase ----
const MODULES = ['app', 'auth', 'functions', 'storage', 'firestore'];
const fbDir = join(out, 'firebase');
mkdirSync(fbDir, { recursive: true });
let version;
try {
  ({ version } = JSON.parse(readFileSync(join(nm, 'firebase', 'package.json'), 'utf8')));
} catch (e) {
  throw new Error(`cannot read node_modules/firebase/package.json (run npm install first): ${e.message}`);
}
const remote = `https://www.gstatic.com/firebasejs/${version}/firebase-app.js`;
for (const m of MODULES) {
  const name = `firebase-${m}.js`;
  const code = readFileSync(join(nm, 'firebase', name), 'utf8').replaceAll(remote, './firebase-app.js');
  // Fail loudly if a future version imports something else from Google's servers.
  const leftover = code.match(/(?:import|from)\s*["']https?:\/\/[^"']+["']/);
  if (leftover) throw new Error(`${name} still imports from the network: ${leftover[0]}`);
  writeFileSync(join(fbDir, name), code);
  const map = join(nm, 'firebase', `${name}.map`);
  if (existsSync(map)) copyFileSync(map, join(fbDir, `${name}.map`));
}

// ---- Fonts: Latin and Latin Extended only (covers Danish) ----
const fontDir = join(out, 'fonts');
mkdirSync(fontDir, { recursive: true });
const FONTS = [
  ['@fontsource/dm-serif-display', ['dm-serif-display-latin-400-normal.woff2', 'dm-serif-display-latin-ext-400-normal.woff2'], 'OFL-dm-serif-display.txt'],
  ['@fontsource-variable/source-serif-4', ['source-serif-4-latin-opsz-normal.woff2', 'source-serif-4-latin-ext-opsz-normal.woff2'], 'OFL-source-serif-4.txt'],
];
for (const [pkg, files, licence] of FONTS) {
  for (const f of files) copyFileSync(join(nm, pkg, 'files', f), join(fontDir, f));
  copyFileSync(join(nm, pkg, 'LICENSE'), join(fontDir, licence));
}

console.log(`vendor: Firebase ${version} (${MODULES.length} modules) and ${FONTS.length} fonts -> web/vendor`);
