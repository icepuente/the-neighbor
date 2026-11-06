// The page's own texts (web/js/i18n.js), in both languages, for the emails the API sends. i18n.js is
// a plain browser script that picks its language from localStorage and sets window.I18N, so it is
// run here as-is, once per language, in a small sandbox: the emails use exactly the texts, price
// and date formats the page uses (and the mailto: fallback used before).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const I18N_FILE = new URL('../web/js/i18n.js', import.meta.url);
export const LANGS = ['da', 'en'];
const BIKES = ['city', 'road', 'mtb', 'e', 'cargo'];

// { t, fmt: { dkk, date }, svcName, bikes } for one language.
export function loadLanguage(lang, source = readFileSync(I18N_FILE, 'utf8')) {
  const sandbox = { window: {}, localStorage: { getItem: () => lang, setItem() {} } };
  vm.runInNewContext(source, sandbox, { filename: 'web/js/i18n.js', timeout: 1000 });
  const I = sandbox.window.I18N;
  if (!I || I.lang !== lang) throw new Error(`web/js/i18n.js did not load in ${lang}`);
  return {
    lang,
    t: I.t,
    fmt: { dkk: I.dkk, date: I.date },
    svcName: I.svc,
    // The bike types the form offers; the form sends the label in the page language.
    bikes: BIKES.map((k) => I.t(`bike.${k}`)),
  };
}

export function loadTexts() {
  return Object.fromEntries(LANGS.map((l) => [l, loadLanguage(l)]));
}

// Dates and prices need Node's full ICU data (official Node images have it). Without it Danish
// dates would come out in English; the server logs a warning at start (see server.js).
export const hasDanishLocale = () => new Intl.DateTimeFormat('da-DK', { month: 'long' }).format(new Date('2026-10-20T12:00:00Z')) === 'oktober';
