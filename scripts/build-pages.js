// Builds dist/ for Cloudflare Pages, if the site moves off the home server: a copy of web/ (fonts
// included) plus Pages' _headers and _redirects, made from the same rules nginx uses
// (deploy/nginx/headers.inc and default.conf), so the site behaves the same on either host.
//   npm run build:pages     then, e.g.: npx wrangler pages deploy dist --project-name the-neighbor
// See docs/operations.md, "Moving to Cloudflare Pages". dist/ is git-ignored.
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteHeaders } from './headers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (spawnSync(process.execPath, [join(root, 'scripts', 'vendor.js')], { stdio: 'inherit' }).status) process.exit(1);
rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'web'), dist, { recursive: true });

// Pages serves HTML, JS and CSS with "must-revalidate", so the /r/<version>/ asset paths nginx needs
// (Cloudflare's 4-hour cache on a proxied origin) are not needed here: the pages keep plain links.
const headers = Object.entries(siteHeaders()).map(([k, v]) => `  ${k}: ${v}`).join('\n');
writeFileSync(join(dist, '_headers'), `/*\n${headers}\n`);
// The same redirects as nginx. www -> the bare domain is a Cloudflare Redirect Rule, not a file.
writeFileSync(join(dist, '_redirects'), '/account.html / 301\n/admin.html / 301\n');

console.log('dist/ ready for Cloudflare Pages (web/ + _headers + _redirects)');
