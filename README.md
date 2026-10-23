# The Neighbor

**The Neighbor** is a mobile bike mechanic in Copenhagen who repairs bikes where they stand. This
repo is the website: a static site in [`web/`](web/), in Danish with English, with no backend.

**Demo:** [book.icepuente.com](https://book.icepuente.com). Booking requests from the demo go to a
placeholder address (`booking@example.com`), so they reach no one.

## How booking works

1. The visitor chooses one or more repairs (puncture fix, brakes, gears, chain, bike service, or
   an "other repair" they describe in the comment field, priced by the owner in the reply), a
   preferred day and arrival time, and gives an address, postcode, name and phone.
2. The site checks the request (open Monday to Saturday 08:30-15:30, at least 2 days ahead, at most
   45 minutes of work, within 18 km) and shows the price: the repairs plus travel at 2.5 DKK per km,
   one way, estimated from the postcode.
3. The visitor ticks two boxes (the terms, and the early start of work with the withdrawal
   acknowledgement), then **Send request by email** opens their own mail program with the request
   written out, addressed to the owner. If no mail program opens, the page shows the same text to
   copy.
4. The owner replies to confirm the time and price (or suggest another time). The agreement is made
   with that reply.

The site stores nothing and sends nothing: no accounts, no database, no cookies, no third-party
requests (the fonts are self-hosted). The only thing it keeps is the visitor's language choice, in
their own browser. That keeps the personal data to the emails the owner receives anyway.

## Running it

```bash
npm install
npm run serve          # http://127.0.0.1:5000 (copies the fonts first)
npm test               # the booking rules
npm run test:browser   # the whole booking in headless Chrome, on a local server
npm run deploy         # to the home server (book.icepuente.com)
npm run test:live      # the browser test against book.icepuente.com
```

Chrome is needed for the browser tests (set `CHROME_PATH` if it is not in the usual place).

## Where things are

```text
web/index.html            The front page: services, the booking form, the price page, FAQ
web/js/booking-rules.js   Services, prices, opening hours, travel, the checks and the request email.
                          CONFIG at the top holds the booking address, the demo flag and closed days.
web/js/landing.js         The booking form and the mailto: link
web/js/i18n.js            Every Danish and English text
web/js/datepicker.js      The calendar used for the date field
web/privacy.html          Privacy policy (draft, DA/EN)
web/terms.html            Terms and conditions (draft, DA/EN)
deploy/                   nginx and Cloudflare Tunnel on the home server
scripts/                  serve.js, deploy.sh, vendor.js (fonts), texts.js (proofreading sheet)
docs/                     operations.md (the server), legal-checklist.md, review/ (proofreading)
```

## Before real customers use it

- In `web/js/booking-rules.js`: put the owner's booking email (and phone, if wanted) in
  `CONFIG.contact`, and set `CONFIG.demo` to `false`.
- Fill in the business details marked in yellow on the site (legal name, address, CVR) and go
  through [`docs/legal-checklist.md`](docs/legal-checklist.md).
- Have the Danish proofread: [`docs/review/`](docs/review/README.md).
- On its own domain: remove the `noindex` header and `robots.txt` from
  [`deploy/nginx/default.conf`](deploy/nginx/default.conf).

## History

- Until 2026-10-17: **Spoke & Go**, an Express and SQLite booking app, ran at book.icepuente.com.
- 2026-10-17 to 2026-10-23: The Neighbor was built on Firebase (accounts, business fleet plans and
  reports, subscriptions, photos, an owner's dashboard), demonstrated on the Firebase emulators. The
  plan is in git history: `git show 437650b:docs/firebase-plan.md`.
- 2026-10-23: the owner chose to start smaller: repairs for private customers only, no accounts or
  subscriptions, and no personal data kept by the site. The site became the static, email-based
  version above, and the Firebase project was deleted. The earlier versions can be recovered from
  git history (commit `437650b` is the last Firebase version).
