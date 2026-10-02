import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isProd = process.env.NODE_ENV === 'production';

const sitePath = process.env.SITE_CONFIG || path.join(root, 'config', 'site.json');
export const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));

function required(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  console.warn(`[config] ${name} not set, using a development default`);
  return devFallback;
}

const port = Number(process.env.PORT || 3000);
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');

export const env = {
  isProd,
  port,
  publicUrl,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  ownerEmail: process.env.OWNER_EMAIL || '',
  mailFromAddress: process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || 'bookings@localhost',
  adminPassword: required('ADMIN_PASSWORD', 'admin'),
  sessionSecret: required('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),
  cookieSecure: publicUrl.startsWith('https://'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

export const contactEmail = site.contactEmail || env.ownerEmail;

export function serviceById(id) {
  return site.services.find((s) => s.id === id);
}

export function formatPrice(amount) {
  if (amount == null) return '';
  return new Intl.NumberFormat(site.currencyLocale || site.locale, {
    style: 'currency',
    currency: site.currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

// The subset of site config the browser needs.
export function publicConfig() {
  return {
    businessName: site.businessName,
    tagline: site.tagline,
    description: site.description,
    serviceArea: site.serviceArea,
    contactPhone: site.contactPhone,
    contactEmail,
    locale: site.locale,
    currency: site.currency,
    autoConfirm: !!site.autoConfirm,
    postcodePattern: site.postcodePattern,
    postcodeHint: site.postcodeHint,
    highlights: site.highlights || [],
    services: site.services.map((s) => ({ ...s, priceLabel: formatPrice(s.price) })),
    bikeTypes: site.bikeTypes,
    faq: site.faq || [],
  };
}
