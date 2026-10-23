// Copies the fonts (Fontsource packages, OFL-1.1, with their licences) from node_modules into
// web/vendor/fonts/ (git-ignored), so the site loads nothing from other servers: no visitor's IP
// address is shared just for fonts. web/css/fonts.css uses them. Runs with `npm run vendor`, before
// `npm run serve` and before every deploy.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'web', 'vendor');

// The Firebase SDK copied here by earlier versions is no longer used.
rmSync(join(out, 'firebase'), { recursive: true, force: true });

// Latin and Latin Extended only (covers Danish).
const fontDir = join(out, 'fonts');
mkdirSync(fontDir, { recursive: true });
const FONTS = [
  ['@fontsource/dm-serif-display', ['dm-serif-display-latin-400-normal.woff2', 'dm-serif-display-latin-ext-400-normal.woff2'], 'OFL-dm-serif-display.txt'],
  ['@fontsource-variable/source-serif-4', ['source-serif-4-latin-opsz-normal.woff2', 'source-serif-4-latin-ext-opsz-normal.woff2'], 'OFL-source-serif-4.txt'],
];
for (const [pkg, files, licence] of FONTS) {
  for (const f of files) {
    try {
      copyFileSync(join(nm, pkg, 'files', f), join(fontDir, f));
    } catch (e) {
      throw new Error(`cannot copy ${pkg}/files/${f} (run npm install first): ${e.message}`);
    }
  }
  copyFileSync(join(nm, pkg, 'LICENSE'), join(fontDir, licence));
}

console.log(`vendor: ${FONTS.length} fonts -> web/vendor/fonts`);
