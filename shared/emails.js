// The emails customers receive, in Danish and English: the language the customer used on the site
// (stored with the booking or request as `lang`; Danish when missing). Emails to the owner stay in
// English, like the dashboard. Each template takes plain values and returns { subject, text };
// `npm run export-texts` renders every template for the proofreading sheet.

export const LANGS = ['da', 'en'];
export const langOf = (v) => (v === 'en' ? 'en' : 'da');

// "tirsdag den 20. oktober 2026" / "Tuesday 20 October 2026"; "212 kr." / "212 DKK".
export const fmtDay = (date, lang) => new Date(`${date}T12:00:00Z`)
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const fmtMonth = (month, lang) => new Date(`${month}-01T12:00:00Z`)
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'da-DK', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const money = (n, lang) => `${Math.round(n).toLocaleString('da-DK')} ${lang === 'en' ? 'DKK' : 'kr.'}`;

const join = (lines) => lines.filter((l) => l !== null && l !== undefined).join('\n');
const bullets = (items) => items.map((x) => `- ${x}`).join('\n');
const SIGN = { da: '\nVenlig hilsen\nThe Neighbor', en: '\nBest regards,\nThe Neighbor' };
const hi = { da: (n) => `Hej ${n}`, en: (n) => `Hi ${n},` };
const at = (v, lang) => (lang === 'en' ? `${fmtDay(v.date, lang)} at ${v.time}` : `${fmtDay(v.date, lang)} kl. ${v.time}`);

// Every template: (v, lang) -> { subject, text }. `v` holds the values named in the comment.
export const TEMPLATES = {
  // name, ref, services [{ name, price }], date, time, address, total
  bookingReceived: (v, lang) => (lang === 'en' ? {
    subject: `Booking received ${v.ref}`,
    text: join([hi.en(v.name), '', 'Thanks for booking with The Neighbor. We have received:', bullets(v.services.map((s) => `${s.name}: ${money(s.price, lang)}`)), '',
      at(v, lang), v.address, '', `Total: ${money(v.total, lang)}`, '', 'We will confirm your booking shortly.', SIGN.en]),
  } : {
    subject: `Vi har modtaget din booking ${v.ref}`,
    text: join([hi.da(v.name), '', 'Tak for din booking hos The Neighbor. Vi har modtaget:', bullets(v.services.map((s) => `${s.name}: ${money(s.price, lang)}`)), '',
      at(v, lang), v.address, '', `I alt: ${money(v.total, lang)}`, '', 'Vi bekræfter din booking hurtigst muligt.', SIGN.da]),
  }),

  // name, ref, date, time, address
  bookingConfirmed: (v, lang) => (lang === 'en' ? {
    subject: `Your booking ${v.ref} is confirmed`,
    text: join([hi.en(v.name), '', `Your booking on ${at(v, lang)} is confirmed.`, v.address, '', 'We look forward to seeing you.', SIGN.en]),
  } : {
    subject: `Din booking ${v.ref} er bekræftet`,
    text: join([hi.da(v.name), '', `Din booking ${at(v, lang)} er bekræftet.`, v.address, '', 'Vi glæder os til at se dig.', SIGN.da]),
  }),
  bookingCompleted: (v, lang) => (lang === 'en' ? {
    subject: `Your booking ${v.ref} is complete`,
    text: join([hi.en(v.name), '', `Your booking on ${at(v, lang)} is complete.`, '', 'Thank you for choosing The Neighbor.', SIGN.en]),
  } : {
    subject: `Din booking ${v.ref} er gennemført`,
    text: join([hi.da(v.name), '', `Din booking ${at(v, lang)} er gennemført.`, '', 'Tak, fordi du valgte The Neighbor.', SIGN.da]),
  }),
  bookingCancelled: (v, lang) => (lang === 'en' ? {
    subject: `Your booking ${v.ref} has been cancelled`,
    text: join([hi.en(v.name), '', `Your booking on ${at(v, lang)} has been cancelled.`, v.address, '', 'Get in touch if you would like a new time.', SIGN.en]),
  } : {
    subject: `Din booking ${v.ref} er aflyst`,
    text: join([hi.da(v.name), '', `Din booking ${at(v, lang)} er aflyst.`, v.address, '', 'Skriv til os, hvis du gerne vil have en ny tid.', SIGN.da]),
  }),

  // name, ref, date, time, oldDate, oldTime, address
  bookingMoved: (v, lang) => (lang === 'en' ? {
    subject: `Your booking ${v.ref} has a new time`,
    text: join([hi.en(v.name), '', `Your booking has been moved to ${at(v, lang)} (it was ${at({ date: v.oldDate, time: v.oldTime }, lang)}).`, v.address, '',
      'Reply to this email if the new time does not suit you.', SIGN.en]),
  } : {
    subject: `Ny tid for din booking ${v.ref}`,
    text: join([hi.da(v.name), '', `Din booking er flyttet til ${at(v, lang)} (før: ${at({ date: v.oldDate, time: v.oldTime }, lang)}).`, v.address, '',
      'Svar på denne e-mail, hvis den nye tid ikke passer dig.', SIGN.da]),
  }),

  // name, ref, message (the owner's own words, sent as written)
  ownerMessage: (v, lang) => (lang === 'en' ? {
    subject: `About your booking ${v.ref}`,
    text: join([hi.en(v.name), '', v.message, SIGN.en]),
  } : {
    subject: `Angående din booking ${v.ref}`,
    text: join([hi.da(v.name), '', v.message, SIGN.da]),
  }),

  // name, ref, date, work [text], parts [{ name, price }], notes, recommendation { title, reason } | null, total, hasAccount
  visitDone: (v, lang) => {
    const en = lang === 'en';
    const parts = v.parts.length ? ['', en ? 'Parts:' : 'Brugte dele:', bullets(v.parts.map((p) => `${p.name}: ${money(p.price, lang)}`))] : [];
    const rec = v.recommendation ? ['', `${en ? 'Our recommendation' : 'Vores anbefaling'}: ${v.recommendation.title}${v.recommendation.reason ? ` (${v.recommendation.reason})` : ''}`] : [];
    return {
      subject: en ? `Your bike service is done (${v.ref})` : `Din cykel er klar (${v.ref})`,
      text: join([en ? hi.en(v.name) : hi.da(v.name), '',
        en ? `Your bike has been serviced (${fmtDay(v.date, lang)}, ${v.ref}). Work done:` : `Vi har serviceret din cykel (${fmtDay(v.date, lang)}, ${v.ref}). Udført arbejde:`,
        bullets(v.work), ...parts,
        ...(v.notes ? ['', `${en ? 'Notes' : 'Noter'}: ${v.notes}`] : []), ...rec,
        '', `${en ? 'Total' : 'I alt'}: ${money(v.total, lang)}`,
        ...(v.hasAccount ? ['', en ? 'The full record, with photos, is in your account.' : 'Du kan se hele servicehistorikken med billeder på din konto.'] : []),
        en ? SIGN.en : SIGN.da]),
    };
  },

  // name, company
  consultationReceived: (v, lang) => (lang === 'en' ? {
    subject: 'We have received your consultation request',
    text: join([hi.en(v.name), '', `Thanks for your interest. We will contact you shortly to arrange a meeting about ${v.company}.`, SIGN.en]),
  } : {
    subject: 'Vi har modtaget jeres henvendelse',
    text: join([hi.da(v.name), '', `Tak for jeres interesse. Vi kontakter dig snarest for at aftale et møde om ${v.company}.`, SIGN.da]),
  }),

  // contact, company, plan, price (per bike per month), link, demo { email, password } | null
  businessInvite: (v, lang) => (lang === 'en' ? {
    subject: 'Your business account at The Neighbor',
    text: join([hi.en(v.contact), '', `Welcome aboard: ${v.company} is set up on the ${v.plan} plan (${money(v.price, lang)} per bike per month).`,
      'In your account you will find your fleet and the service report after each visit.', '',
      v.demo ? `Demo: log in at ${v.link} with ${v.demo.email} and the password ${v.demo.password}.` : `Choose your password here: ${v.link}`, SIGN.en]),
  } : {
    subject: 'Jeres erhvervskonto hos The Neighbor',
    text: join([hi.da(v.contact), '', `Velkommen! ${v.company} er nu oprettet på ${v.plan}-aftalen (${money(v.price, lang)} pr. cykel pr. måned).`,
      'På kontoen kan I se jeres flåde og servicerapporten efter hvert besøg.', '',
      v.demo ? `Demo: Log ind på ${v.link} med ${v.demo.email} og adgangskoden ${v.demo.password}.` : `Vælg din adgangskode her: ${v.link}`, SIGN.da]),
  }),

  // contact, company, month (yyyy-mm), visitDate, counts { ready, attention, repair }, updated
  fleetReport: (v, lang) => (lang === 'en' ? {
    subject: `Fleet report ${v.updated ? 'updated' : 'ready'}: ${fmtMonth(v.month, lang)}`,
    text: join([hi.en(v.contact), '', `The ${fmtMonth(v.month, lang)} report for ${v.company} is ${v.updated ? 'updated' : 'ready'} in your account (visit on ${fmtDay(v.visitDate, lang)}).`,
      `${v.counts.ready} ready, ${v.counts.attention} need attention, ${v.counts.repair} need repair.`, SIGN.en]),
  } : {
    subject: `Flåderapport ${v.updated ? 'opdateret' : 'klar'}: ${fmtMonth(v.month, lang)}`,
    text: join([hi.da(v.contact), '', `Rapporten for ${v.company} for ${fmtMonth(v.month, lang)} er ${v.updated ? 'opdateret' : 'klar'} på jeres konto (besøg ${fmtDay(v.visitDate, lang)}).`,
      `${v.counts.ready} er klar, ${v.counts.attention} kræver opmærksomhed, og ${v.counts.repair} skal repareres.`, SIGN.da]),
  }),
};

export const email = (name, v, lang) => TEMPLATES[name](v, langOf(lang));
