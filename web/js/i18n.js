// Translations for the site. Danish is the default; the header switch stores the visitor's choice
// (the only thing the site keeps, in the visitor's own browser). Static HTML uses data-i18n="key"
// (text) and data-i18n-ph (placeholder); scripts call I18N.t(key, vars).
(function () {
  'use strict';

  const KEY = 'neighbor-lang';
  let lang = null;
  try { lang = localStorage.getItem(KEY); } catch { lang = null; }
  if (lang !== 'da' && lang !== 'en') lang = 'da';

  const D = {
    da: {
      // Shared
      'demo.bar': 'Demo: forespørgsler går til en testadresse ({email}) og når ikke frem til The Neighbor.',
      'nav.repairs': 'Reparationer',
      'nav.faq': 'Spørgsmål',
      'nav.book': 'Book besøg',
      'footer.terms': 'Vilkår',
      'footer.privacy': 'Privatliv',
      'legal.back': 'Til forsiden',
      'legal.privacyTitle': 'Privatlivspolitik · The Neighbor',
      'legal.termsTitle': 'Handelsbetingelser · The Neighbor',
      'dateAt': '{date} kl. {time}',

      // Front page
      'hero.title': 'Punktering? Vi kommer til dig.',
      'hero.lead': 'En mobil cykelmekaniker i København, der reparerer din cykel, hvor den står.',
      'hero.puncture': 'Jeg er punkteret',
      'hero.repairs': 'Noget andet skal ordnes',
      'hero.repairsSub': 'Bremser, gear, kæde og fejlfinding fra {price}',
      'pt.come': 'Vi kommer til dig',
      'pt.comeSub': 'Intet slæb med cyklen til værkstedet.',
      'pt.prices': 'Klare priser',
      'pt.pricesSub': 'Du ser prisen, før du booker. Dele kun efter dit ja.',
      'pt.mail': 'Ingen konto',
      'pt.mailSub': 'Du booker med en almindelig mail.',
      'pt.one': 'Én person',
      'pt.oneSub': 'Tal direkte med din mekaniker.',
      'rep.title': 'Reparationer',
      'rep.sub': 'Vi reparerer din cykel, hvor den står. Dele koster ekstra.',
      'svc.time': 'ca. {m} min.',
      'svc.tubeIncl': 'slange inkluderet',
      // What each service covers (the owner's list). The puncture fix says "tube included" instead.
      'svc.puncture.what': '',
      'svc.brakes.what': 'justering, funktionstjek og test',
      'svc.gears.what': 'justering af gear og kabler, test',
      'svc.chain.what': 'eftersyn, smøring og justering',
      'svc.diagnostics.what': 'vi finder fejlen; beskriv problemet, når du booker',
      'how.1': 'Send en forespørgsel', 'how.2': 'Vi bekræfter tiden', 'how.3': 'Vi kommer', 'how.4': 'Kør videre',

      // Booking form
      'bk.title': 'Book et besøg',
      'bk.sub': 'Udfyld formularen, og se prisen. Så åbner dit mailprogram med forespørgslen, klar til at sende til os. Vi svarer og bekræfter tiden.',
      'bk.what': '1. Hvad', 'bk.whatSub': 'vælg én eller flere',
      'bk.selectServices': 'Vælg reparationer',
      'bk.bike': 'Cykel',
      'bike.city': 'By / pendler', 'bike.road': 'Racer', 'bike.mtb': 'Mountainbike', 'bike.e': 'Elcykel', 'bike.cargo': 'Ladcykel / andet',
      'bk.when': '2. Hvornår', 'bk.hours': 'Mandag til lørdag, 8.30\u201315.30.',
      'bk.date': 'Ønsket dato',
      'bk.selectDate': 'Vælg en dato',
      'cal.prev': 'Forrige måned', 'cal.next': 'Næste måned', 'cal.unavailable': 'ikke ledig',
      'bk.arrival': 'Ønsket ankomst',
      'bk.arrivalSub': 'Vi bekræfter tiden, når vi svarer på din mail.',
      'bk.where': '3. Hvor og hvem',
      'bk.street': 'Adresse', 'bk.streetPh': 'fx Jagtvej 10, 2. tv.',
      'bk.postcode': 'Postnummer', 'bk.postcodePh': 'fx 2200',
      'f.name': 'Navn', 'f.phone': 'Telefon',
      'bk.note': 'Noget, vi skal vide?', 'bk.noteSub': '(skal udfyldes ved fejlfinding)',
      'bk.notePh': 'fx bagbremsen hviner, eller hvor cyklen står',
      'bk.seePrice': 'Se pris',
      'err.services': 'Vælg mindst én reparation.',
      'err.tooLong': 'Det er mere, end der kan nås på ét besøg (højst 45 minutter). Fjern en reparation, eller book to besøg.',
      'err.date': 'Vælg en dato.',
      'err.past': 'Vælg en dato fra i dag og frem.',
      'err.lead': 'Book mindst 2 dage frem.',
      'err.sunday': 'Vi har lukket om søndagen. Vælg en anden dag.',
      'err.closed': 'Vi har lukket den dag. Vælg en anden dato.',
      'err.arrival': 'Vælg et ønsket ankomsttidspunkt.',
      'err.note': 'Beskriv problemet, så vi ved, hvad vi skal kigge efter.',
      'err.noteLong': 'Beskeden er for lang (højst 300 tegn).',
      'err.contact': 'Udfyld adresse, postnummer, navn og telefon.',
      'err.postcode': 'Skriv et postnummer med 4 cifre.',
      'err.far': 'Adressen ligger mere end 18 km fra os. Skriv til os, så finder vi en løsning.',

      // Price page
      'co.title': 'Din pris',
      'co.travel': 'Kørsel',
      'co.travelVal': '{amount} (ca. {km} km, én vej)',
      'co.total': 'I alt',
      'co.visit': 'Besøget tager op til {min} minutter. Dele kommer oveni, og vi spørger altid først.',
      'co.confirmNote': 'Kl. {time} er dit ønske. Vi svarer på din mail og bekræfter tiden eller foreslår en anden.',
      'co.estimate': 'Kørslen er anslået ud fra postnummeret. Vi bekræfter den endelige pris i vores svar.',
      'co.acceptTerms': 'Jeg accepterer handelsbetingelserne',
      'co.readTerms': 'læs dem her',
      'co.earlyStart': 'Jeg beder jer udføre arbejdet, også hvis besøget ligger inden for fortrydelsesfristen på 14 dage, og jeg ved, at min fortrydelsesret ophører, når arbejdet er fuldt udført.',
      'co.privacy': 'Sådan behandler vi dine oplysninger',
      'co.send': 'Send forespørgsel på mail',
      'co.sendSub': 'Dit mailprogram åbner med forespørgslen. Den er først sendt, når du trykker send dér.',
      'co.change': 'Ret',
      'err.accept.terms': 'Sæt flueben ved handelsbetingelserne for at sende forespørgslen.',
      'err.accept.earlyStart': 'Sæt flueben ved fortrydelsesretten for at sende forespørgslen.',
      'rules.title': 'Kørsel',
      'rules.rate': '{rate} kr. pr. km fra {base}, kun den ene vej.',
      'rules.max': 'Op til {max} km væk.',
      'rules.estimate': 'Indtil videre anslår vi afstanden ud fra postnummeret og bekræfter prisen i vores svar.',
      'rules.ok': 'Forstået',

      // After "send"
      'done.title': 'Næsten færdig',
      'done.msg': 'Dit mailprogram skulle nu være åbnet med forespørgslen til {email}. Tryk send dér, så svarer vi og bekræfter tiden.',
      'done.help': 'Åbnede der ikke noget? Kopiér teksten herunder, og send den til {email}.',
      'done.helpPhone': 'Åbnede der ikke noget? Kopiér teksten herunder, og send den til {email}, eller ring på {phone}.',
      'done.text': 'Din forespørgsel',
      'done.to': 'Til',
      'done.subject': 'Emne',
      'done.copy': 'Kopiér teksten',
      'done.copied': 'Kopieret.',
      'done.copySelf': 'Teksten er markeret. Kopiér den med Ctrl+C (eller \u2318+C).',
      'done.again': 'Ny forespørgsel',

      // The request email (written in the visitor's language; the visitor sends it)
      'mail.subject': 'Bookingforespørgsel: {services}, {date} kl. {time}',
      'mail.hello': 'Hej The Neighbor',
      'mail.intro': 'Jeg vil gerne bede om et besøg:',
      'mail.services': 'Reparationer',
      'mail.date': 'Ønsket dato',
      'mail.time': 'Ønsket ankomst',
      'mail.timeVal': 'kl. {time} (besøget tager op til {min} min.)',
      'mail.bike': 'Cykel',
      'mail.address': 'Adresse',
      'mail.name': 'Navn',
      'mail.phone': 'Telefon',
      'mail.note': 'Besked',
      // A price never ends a sentence here: "kr." would get a second full stop.
      'mail.price': 'Pris ifølge hjemmesiden: ca. {total} i alt, heraf {services} for reparationerne og ca. {travel} for kørsel (anslået {km} km). Dele kommer oveni.',
      'mail.bye': 'Venlig hilsen',

      // About and FAQ
      'about.title': 'Om os',
      'about.quote': 'Du behøver ikke et værksted. Du har brug for en nabo, der kan sit håndværk med cykler.',
      'about.sub': 'Ejeren udfører selv hvert job med værktøjet i varevognen.',
      'faq.parts': 'Er dele inkluderet?', 'faq.partsA': 'Nej, bortset fra slangen ved en punktering. Andre dele koster ekstra, og vi spørger altid først.',
      'faq.come': 'Kommer I ud til mig?', 'faq.comeA': 'Ja. Alt arbejde foregår der, hvor cyklen står, op til 18 km fra os.',
      'faq.hours': 'Hvornår har I åbent?', 'faq.hoursA': 'Mandag til lørdag, 8.30\u201315.30. Søndag har vi lukket.',
      'faq.confirm': 'Hvornår er min tid bekræftet?', 'faq.confirmA': 'Når vi har svaret på din mail. Vi bekræfter dit ønskede tidspunkt eller foreslår et andet. Book mindst 2 dage frem.',
      'faq.pay': 'Hvordan betaler jeg?', 'faq.payA': 'Efter besøget, mod faktura på mail.',
      'faq.data': 'Gemmer siden mine oplysninger?', 'faq.dataA': 'Nej. Siden har ingen konti og gemmer intet. Din forespørgsel er en almindelig mail fra dig til os.',
    },

    en: {
      'demo.bar': 'Demo: requests go to a test address ({email}) and do not reach The Neighbor.',
      'nav.repairs': 'Repairs',
      'nav.faq': 'FAQ',
      'nav.book': 'Book a visit',
      'footer.terms': 'Terms',
      'footer.privacy': 'Privacy',
      'legal.back': 'Back to the front page',
      'legal.privacyTitle': 'Privacy policy · The Neighbor',
      'legal.termsTitle': 'Terms and conditions · The Neighbor',
      'dateAt': '{date} at {time}',

      'hero.title': 'Flat tyre? We come to you.',
      'hero.lead': 'A mobile bike mechanic in Copenhagen who repairs your bike where it is.',
      'hero.puncture': 'I have a flat tyre',
      'hero.repairs': 'Something else needs fixing',
      'hero.repairsSub': 'Brakes, gears, chain and diagnostics from {price}',
      'pt.come': 'We come to you',
      'pt.comeSub': 'No hauling your bike to a workshop.',
      'pt.prices': 'Clear prices',
      'pt.pricesSub': 'You see the price before you book. Parts only after you say yes.',
      'pt.mail': 'No account',
      'pt.mailSub': 'You book with an ordinary email.',
      'pt.one': 'One person',
      'pt.oneSub': 'Talk directly to your mechanic.',
      'rep.title': 'Repairs',
      'rep.sub': 'We repair your bike where it is. Parts are extra.',
      'svc.time': '~{m} min',
      'svc.tubeIncl': 'tube included',
      'svc.puncture.what': '',
      'svc.brakes.what': 'adjustment, performance check and test',
      'svc.gears.what': 'shifting and cable adjustment, test',
      'svc.chain.what': 'inspection, lubrication and adjustment',
      'svc.diagnostics.what': 'we find the fault; describe the problem when you book',
      'how.1': 'Send a request', 'how.2': 'We confirm the time', 'how.3': 'We arrive', 'how.4': 'Ride away',

      'bk.title': 'Book a visit',
      'bk.sub': 'Fill in the form and see the price. Your mail program then opens with the request, ready to send to us. We reply to confirm the time.',
      'bk.what': '1. What', 'bk.whatSub': 'choose one or more',
      'bk.selectServices': 'Select repairs',
      'bk.bike': 'Bike',
      'bike.city': 'City / commuter', 'bike.road': 'Road', 'bike.mtb': 'Mountain', 'bike.e': 'E-bike', 'bike.cargo': 'Cargo / other',
      'bk.when': '2. When', 'bk.hours': 'Monday to Saturday, 08:30\u201315:30.',
      'bk.date': 'Preferred date',
      'bk.selectDate': 'Select a date',
      'cal.prev': 'Previous month', 'cal.next': 'Next month', 'cal.unavailable': 'not available',
      'bk.arrival': 'Preferred arrival',
      'bk.arrivalSub': 'We confirm the time when we reply to your email.',
      'bk.where': '3. Where & who',
      'bk.street': 'Address', 'bk.streetPh': 'e.g. Jagtvej 10, 2. tv.',
      'bk.postcode': 'Postcode', 'bk.postcodePh': 'e.g. 2200',
      'f.name': 'Name', 'f.phone': 'Phone',
      'bk.note': 'Anything we should know?', 'bk.noteSub': '(required for diagnostics)',
      'bk.notePh': 'e.g. the rear brake squeals, or where the bike is',
      'bk.seePrice': 'See price',
      'err.services': 'Choose at least one repair.',
      'err.tooLong': 'That is more than fits in one visit (45 minutes at most). Remove a repair, or book two visits.',
      'err.date': 'Choose a date.',
      'err.past': 'Choose a date from today onward.',
      'err.lead': 'Please book at least 2 days ahead.',
      'err.sunday': 'We are closed on Sundays. Please pick another day.',
      'err.closed': 'We are closed that day. Please pick another date.',
      'err.arrival': 'Choose a preferred arrival time.',
      'err.note': 'Describe the problem so we know what to look for.',
      'err.noteLong': 'The message is too long (300 characters at most).',
      'err.contact': 'Fill in your address, postcode, name and phone.',
      'err.postcode': 'Enter a 4-digit postcode.',
      'err.far': 'That address is more than 18 km from us. Write to us and we will find a solution.',

      'co.title': 'Your price',
      'co.travel': 'Travel',
      'co.travelVal': '{amount} (about {km} km, one way)',
      'co.total': 'Total',
      'co.visit': 'The visit takes up to {min} minutes. Parts are extra, and we always ask first.',
      'co.confirmNote': '{time} is your preferred time. We reply to your email to confirm it or suggest another.',
      'co.estimate': 'Travel is estimated from the postcode. We confirm the final price in our reply.',
      'co.acceptTerms': 'I accept the terms and conditions',
      'co.readTerms': 'read them here',
      'co.earlyStart': 'I ask you to do the work even if the visit falls within the 14-day withdrawal period, and I know that my right of withdrawal ends once the work is fully done.',
      'co.privacy': 'How we handle your information',
      'co.send': 'Send request by email',
      'co.sendSub': 'Your mail program opens with the request. It is only sent when you press send there.',
      'co.change': 'Change',
      'err.accept.terms': 'Tick the box to accept the terms and conditions.',
      'err.accept.earlyStart': 'Tick the box about the right of withdrawal.',
      'rules.title': 'Travel',
      'rules.rate': '{rate} DKK per km from {base}, one way only.',
      'rules.max': 'Up to {max} km away.',
      'rules.estimate': 'For now, we estimate the distance from the postcode and confirm the price in our reply.',
      'rules.ok': 'Got it',

      'done.title': 'Almost done',
      'done.msg': 'Your mail program should now be open with the request to {email}. Press send there, and we will reply to confirm the time.',
      'done.help': 'Nothing opened? Copy the text below and send it to {email}.',
      'done.helpPhone': 'Nothing opened? Copy the text below and send it to {email}, or call {phone}.',
      'done.text': 'Your request',
      'done.to': 'To',
      'done.subject': 'Subject',
      'done.copy': 'Copy the text',
      'done.copied': 'Copied.',
      'done.copySelf': 'The text is selected. Copy it with Ctrl+C (or \u2318+C).',
      'done.again': 'New request',

      'mail.subject': 'Booking request: {services}, {date} at {time}',
      'mail.hello': 'Hello The Neighbor',
      'mail.intro': "I'd like to book a visit:",
      'mail.services': 'Repairs',
      'mail.date': 'Preferred date',
      'mail.time': 'Preferred arrival',
      'mail.timeVal': '{time} (the visit takes up to {min} min)',
      'mail.bike': 'Bike',
      'mail.address': 'Address',
      'mail.name': 'Name',
      'mail.phone': 'Phone',
      'mail.note': 'Message',
      'mail.price': 'Price according to the website: about {total} in total, of which {services} for the repairs and about {travel} for travel (estimated {km} km). Parts are extra.',
      'mail.bye': 'Kind regards',

      'about.title': 'About',
      'about.quote': "You don't need a workshop. You need a neighbor who knows bikes.",
      'about.sub': 'The owner does every job personally, with the tools in the van.',
      'faq.parts': 'Are parts included?', 'faq.partsA': 'No, except the inner tube for a puncture. Other parts are extra, and we always ask first.',
      'faq.come': 'Do you come to me?', 'faq.comeA': 'Yes. All work is done where the bike is, up to 18 km from us.',
      'faq.hours': 'When are you open?', 'faq.hoursA': 'Monday to Saturday, 08:30\u201315:30. Closed on Sundays.',
      'faq.confirm': 'When is my time confirmed?', 'faq.confirmA': 'When we have replied to your email. We confirm your preferred time or suggest another. Book at least 2 days ahead.',
      'faq.pay': 'How do I pay?', 'faq.payA': 'After the visit, by invoice sent by email.',
      'faq.data': 'Does the site keep my details?', 'faq.dataA': 'No. The site has no accounts and stores nothing. Your request is an ordinary email from you to us.',
    },
  };

  function t(key, vars) {
    let s = D[lang][key] ?? D.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  }

  // Prices and dates in the page language: "199 kr." and Danish dates, or "199 DKK" in English.
  const dkk = (n) => Math.round(n).toLocaleString('da-DK') + (lang === 'da' ? ' kr.' : ' DKK');
  const date = (s) => new Date(`${s}T12:00:00`).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    apply();
  }

  window.I18N = {
    lang,
    t,
    apply,
    dkk,
    date,
    dict: D,
    set(l) {
      try { localStorage.setItem(KEY, l); } catch { /* storage unavailable: the switch lasts this page only */ }
      location.reload();
    },
    // A service's name in the current language.
    svc: (s) => (lang === 'da' && s.da ? s.da : s.name),
  };
})();
