# The Neighbor

**The Neighbor** is a mobile bike mechanic in Copenhagen who repairs bikes where they stand. This
repo is the website: a static site in [`web/`](web/), in Danish with English, and a small API in
[`api/`](api/) that emails booking requests (no database, no npm packages).

**Live:** [theneighbor.dk](https://theneighbor.dk), served from Alec's home server through a
Cloudflare Tunnel ([`docs/operations.md`](docs/operations.md), which also covers moving to
Cloudflare Pages).

## How booking works

1. The visitor chooses one or more repairs (puncture fix, brakes, gears, chain, bike service, or
   an "other repair" they describe in the comment field, priced by the owner in the reply), a
   preferred day and arrival time, and gives an address, postcode, name, phone and email address.
2. The site checks the request (open Monday to Saturday 08:30-15:30, at least 2 days ahead, at most
   45 minutes of work, within 18 km) and shows the price: the repairs plus travel at 2.5 DKK per km,
   one way, estimated from the postcode.
3. The visitor ticks two boxes (the terms, and the early start of work with the withdrawal
   acknowledgement), then **Send request**. The API checks the request again with the same rules,
   works out the price itself, and sends two emails through [Resend](https://resend.com) from
   `booking@theneighbor.dk`: the request to the owner (reply goes to the customer), and a copy to
   the customer with both ticked statements (reply goes to the owner).
4. If the API cannot send it (no key yet, too many requests, Resend down, offline), the page falls
   back to the old way: a button that opens the visitor's own mail program with the same email,
   addressed to the owner, and the text to copy.
5. The owner replies to confirm the time and price (or suggest another time). The agreement is made
   with that reply.

The site stores nothing: no accounts, no database, no cookies, no third-party requests in the
browser (the fonts are self-hosted). The API keeps nothing either: it passes each request to Resend
and forgets it; its log has only status lines, and its abuse limits live in memory. The only thing
the browser keeps is the visitor's language choice. Resend keeps the sent emails for 30 days (see
the privacy policy). Address
suggestions (`CONFIG.addressSuggest`) are the one other thing that leaves the browser: what is typed
in the street field goes to this site's `/api/address`, which nginx passes on, alone, to the Danish
address register, and nothing of it is kept (see docs/operations.md, "Address suggestions").

## Running it

```bash
npm install
npm run serve          # http://127.0.0.1:5000 (copies the fonts first); POST /api/request -> 405,
                       # so the page shows the mail fallback. API_URL=http://127.0.0.1:8080 to use the API
npm run api            # the API on :8080 (503 without RESEND_API_KEY: nothing is sent)
npm test               # the booking rules and the API (fake email transport: nothing is sent)
npm run test:browser   # the whole booking in headless Chrome, on a local server
npm run deploy         # to the home server (theneighbor.dk)
npm run test:live      # the browser test against theneighbor.dk
npm run build:pages    # dist/ for Cloudflare Pages, if the site moves
```

Chrome is needed for the browser tests (set `CHROME_PATH` if it is not in the usual place). The
browser tests replace the page's `fetch()` with a stub, so they never send an email, not even
`test:live`.

## Where things are

```text
web/index.html            The front page: services, the booking form, the price page, FAQ
web/js/booking-rules.js   Services, prices, opening hours, travel, the checks and the request email.
                          CONFIG at the top holds the booking address, the demo flag and closed days.
web/js/landing.js         The booking form: sending through the API, and the mailto: fallback
web/js/i18n.js            Every Danish and English text
web/js/datepicker.js      The calendar used for the date field
web/privacy.html          Privacy policy (draft, DA/EN)
web/terms.html            Terms and conditions (draft, DA/EN)
api/                      The booking API: POST /api/request -> two emails through Resend (Node 22,
                          no dependencies). app.js (the endpoint), validate.js, mail.js, limits.js,
                          resend.js, texts.js (runs web/js/i18n.js for the email texts), server.js
deploy/                   nginx, the api container and Cloudflare Tunnel on the home server
scripts/                  serve.js, deploy.sh, vendor.js (fonts), texts.js (proofreading sheet)
docs/                     operations.md (the server), legal-checklist.md, review/ (proofreading)
```

## Still to do (2026-11-06)

- **Sending from the site** (branch `server-email`): create the Resend account, verify
  `theneighbor.dk` there (EU region) with its DNS records, put the API key on the server, then
  deploy. See [`docs/operations.md`](docs/operations.md#booking-emails-resend). Until then the page
  falls back to the mailto: link by itself.
- Go through [`docs/legal-checklist.md`](docs/legal-checklist.md) (section 4 is new: Resend).
- Have the Danish proofread: [`docs/review/`](docs/review/README.md); the new and changed texts
  are flagged in the sheet's Status column.

## History

- Until 2026-10-17: **Spoke & Go**, an Express and SQLite booking app, ran at book.icepuente.com.
- 2026-10-17 to 2026-10-23: The Neighbor was built on Firebase (accounts, business fleet plans and
  reports, subscriptions, photos, an owner's dashboard), demonstrated on the Firebase emulators. The
  plan is in git history: `git show 437650b:docs/firebase-plan.md`.
- 2026-10-23: the owner chose to start smaller: repairs for private customers only, no accounts or
  subscriptions, and no personal data kept by the site. The site became the static, email-based
  version above, and the Firebase project was deleted.
  The earlier versions can be recovered from git history (commit `437650b` is the last Firebase
  version).
- 2026-11: live on theneighbor.dk; book.icepuente.com taken down.
- 2026-11-06: requests are sent by the site's own API through Resend, with the mailto: link as the
  fallback (branch `server-email`). This changes the 2026-10-23 choice of a site that sends nothing;
  see `docs/legal-checklist.md`.
