import crypto from 'node:crypto';
import { env } from './config.js';

// The app sits behind cloudflared, which sets CF-Connecting-IP. The app port is
// only published on localhost, so the header can't be spoofed from outside.
export const clientIp = (req) => req.get('cf-connecting-ip') || req.ip;

export function rateLimit({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset < now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const key = clientIp(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// --- Validation helpers ------------------------------------------------------

export const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^\+?[\d\s()-]{6,20}$/;

// --- Admin session (stateless HMAC-signed cookie) ----------------------------

const COOKIE = 'bb_admin';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

const sign = (payload) => crypto.createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export const checkPassword = (input) => crypto.timingSafeEqual(sha(input), sha(env.adminPassword));

function cookieOptions() {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/' };
}

export function startSession(res) {
  const payload = `v1.${Date.now() + SESSION_MS}`;
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions(), maxAge: SESSION_MS });
}

export const endSession = (res) => res.clearCookie(COOKIE, cookieOptions());

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isAdmin(req) {
  const value = readCookie(req, COOKIE);
  if (!value) return false;
  const i = value.lastIndexOf('.');
  const payload = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  const [version, exp] = payload.split('.');
  return version === 'v1' && Number(exp) > Date.now();
}

// Admin API calls must carry a custom header. Browsers can't send one
// cross-site without a CORS preflight (which we never grant), so this blocks CSRF
// on top of the SameSite=Strict cookie.
export function requireAdmin(req, res, next) {
  if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'Forbidden' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in.' });
  next();
}
