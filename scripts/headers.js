// The site's response headers, read from deploy/nginx/headers.inc: the one list that nginx, the
// local server (scripts/serve.js) and the Cloudflare Pages build (scripts/build-pages.js) all use.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS_FILE = join(root, 'deploy', 'nginx', 'headers.inc');

// { 'Content-Security-Policy': "default-src 'self'; ...", ... }
export function siteHeaders() {
  const out = {};
  for (const m of readFileSync(HEADERS_FILE, 'utf8').matchAll(/^add_header\s+([\w-]+)\s+"([^"]*)"\s+always;/gm)) out[m[1]] = m[2];
  if (!out['Content-Security-Policy']) throw new Error(`no Content-Security-Policy in ${HEADERS_FILE}`);
  return out;
}
