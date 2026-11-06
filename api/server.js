// The booking API's server: `node api/server.js` (in production, the `api` container in
// deploy/compose.yaml, behind nginx). Settings come from the environment:
//   RESEND_API_KEY     Resend API key; without it every request gets 503 and the page falls back to
//                      the visitor's own mail program. In production: secrets/resend.env on the server.
//   MAIL_FROM          sender, default "The Neighbor <booking@theneighbor.dk>"
//   IP_LIMIT_PER_HOUR  requests sent per visitor per hour (default 5)
//   DAILY_CAP          requests sent per day for the whole site (default 40)
//   PORT, HOST         default 8080 on all interfaces (the container publishes no port)
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { DEFAULT_FROM } from './mail.js';
import { resendTransport } from './resend.js';
import { hasDanishLocale } from './texts.js';

const env = process.env;
const int = (v, d) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : d);
const apiKey = String(env.RESEND_API_KEY || '').trim();
const from = String(env.MAIL_FROM || DEFAULT_FROM).trim();
if (!/^[^<>\r\n"]{1,60} <[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>$/.test(from)) {
  console.error('api: MAIL_FROM must look like "Name <address@domain>"');
  process.exit(1);
}

const app = createApp({
  send: apiKey ? resendTransport({ apiKey }) : null,
  from,
  ipPerHour: int(env.IP_LIMIT_PER_HOUR, 5),
  dailyCap: int(env.DAILY_CAP, 40),
});

const server = createServer(app.handle);
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.maxHeadersCount = 50;
const port = int(env.PORT, 8080);
server.listen(port, env.HOST || '0.0.0.0', () => {
  console.log(`api: listening on ${port}; email ${apiKey ? 'configured' : 'NOT configured (requests get 503; the page falls back to mailto:)'}`);
  if (!hasDanishLocale()) console.warn('api: this Node has no Danish locale data (full ICU); Danish dates in the emails will be wrong');
});

const stop = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
