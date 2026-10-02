import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { env, site, root, contactEmail } from './src/config.js';
import { db } from './src/db.js';
import { verifyMail } from './src/mailer.js';
import { esc } from './src/emails.js';
import { publicRouter } from './src/routes/public.js';
import { adminRouter } from './src/routes/admin.js';

const publicDir = path.join(root, 'public');

// HTML pages get a few site values filled in server-side ({{businessName}} etc.).
const pageVars = {
  businessName: site.businessName,
  tagline: site.tagline,
  description: site.description,
  serviceArea: site.serviceArea,
  contactEmail,
  contactPhone: site.contactPhone || '',
  year: String(new Date().getFullYear()),
};
const pages = Object.fromEntries(
  ['index', 'booking', 'admin', 'privacy'].map((name) => {
    const html = fs.readFileSync(path.join(publicDir, `${name}.html`), 'utf8');
    return [name, html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in pageVars ? esc(pageVars[k]) : m))];
  }),
);
const sendPage = (name, { noindex = false } = {}) => (req, res) => {
  if (noindex) res.set('X-Robots-Tag', 'noindex, nofollow');
  res.type('html').send(pages[name]);
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, uniquelocal');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:'],
        'upgrade-insecure-requests': env.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: env.cookieSecure,
  }),
);
app.use(express.json({ limit: '50kb' }));

app.get('/healthz', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('/', sendPage('index'));
app.get('/privacy', sendPage('privacy'));
app.get('/b/:token', sendPage('booking', { noindex: true }));
app.get('/admin', sendPage('admin', { noindex: true }));
app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /b/\nDisallow: /admin\nDisallow: /api/\n'));

app.use(express.static(publicDir, { index: false, maxAge: env.isProd ? '1h' : 0 }));

app.use((req, res) => res.status(404).type('html').send(pages.index));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

app.listen(env.port, () => {
  console.log(`${site.businessName} booking site listening on :${env.port} (${env.publicUrl})`);
  verifyMail();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
