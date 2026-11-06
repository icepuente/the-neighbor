// A small static server for working on the site locally: serves web/ on http://127.0.0.1:5000/
// (PORT to change it) with the same headers as nginx in production (deploy/nginx/headers.inc), so a
// page that breaks the Content-Security-Policy breaks here too.
//   npm run serve
// POST /api/request is refused (405), so the page falls back to the mailto: link, unless API_URL
// points at a running API (`npm run api`, which sends nothing without RESEND_API_KEY):
//   API_URL=http://127.0.0.1:8080 npm run serve
import { createServer, request as httpRequest, Agent } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteHeaders } from './headers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(root, 'web');
const PORT = Number(process.env.PORT || 5000);

const SITE_HEADERS = siteHeaders();
const API_URL = process.env.API_URL ? new URL(process.env.API_URL) : null;
const apiAgent = new Agent();

// The local stand-in for nginx's `location = /api/request` (deploy/nginx/default.conf).
function proxyApi(req, res, headers) {
  const up = httpRequest({
    host: API_URL.hostname, port: API_URL.port, method: 'POST', path: '/api/request', agent: apiAgent,
    headers: { 'content-type': req.headers['content-type'] || '', 'content-length': req.headers['content-length'] || '', 'x-client-ip': '127.0.0.1' },
  }, (r) => { res.writeHead(r.statusCode, { ...headers, ...r.headers }); r.pipe(res); });
  up.on('error', () => res.writeHead(502, headers).end());
  req.pipe(up);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

createServer(async (req, res) => {
  const headers = { ...SITE_HEADERS, 'Cache-Control': 'no-cache' };
  if (API_URL && req.method === 'POST' && req.url === '/api/request') { proxyApi(req, res, headers); return; }
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
