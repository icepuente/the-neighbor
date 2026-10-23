// A small static server for working on the site locally: serves web/ on http://127.0.0.1:5000/
// (PORT to change it) with the same Content-Security-Policy as nginx in production, read from
// deploy/nginx/default.conf, so a page that breaks the policy breaks here too.
//   npm run serve
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(root, 'web');
const PORT = Number(process.env.PORT || 5000);

const conf = readFileSync(join(root, 'deploy', 'nginx', 'default.conf'), 'utf8');
const csp = conf.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1];
if (!csp) throw new Error('no Content-Security-Policy in deploy/nginx/default.conf');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

createServer(async (req, res) => {
  const headers = { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers).end(); return; }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(WEB, path));
  if (file !== WEB && !file.startsWith(WEB + sep)) { res.writeHead(403, headers).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`The Neighbor: http://127.0.0.1:${PORT}/`));
