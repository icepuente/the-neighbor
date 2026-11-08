# Review pack: getting the content right before launch

Three reviews, which can run at the same time. None of them needs a developer until the
corrections come back.

| Review | Who | What they get | What comes back |
|---|---|---|---|
| 1. Try the demo | the owner | [the demo guide](#1-demo-guide-for-the-owner) below | notes on what is wrong or missing |
| 2. Proofread the Danish | a native Danish speaker | [`proofreading.csv`](proofreading.csv) | the same file, with corrections |
| 3. Legal review | a lawyer, or someone who knows Danish consumer law | `/privacy.html`, `/terms.html` and [the checklist](../legal-checklist.md) | the business details, the choices, and corrections |

After launch the owner keeps the texts up to date himself, in a Google Sheet: see
[4. The owner's Google Sheet](#4-the-owners-google-sheet).

## 1. Demo guide (for the owner)

The demo is at **https://book.icepuente.com**. The yellow bar at the top says so: requests from the
demo go to a test address (`booking@example.com`), so nothing reaches anyone, and the site itself
stores nothing.

Try it on your phone as well as a computer: customers will mostly book on a phone.

1. On the front page, tap **Jeg er punkteret** (or pick repairs further down).
2. In the form, choose a day in the calendar and an arrival time, enter an address, postcode, name
   and phone, and tap **Se pris**.
3. On the price page, check the price, tick both boxes, and tap **Send forespørgsel**. The site
   sends the request to you and a copy to the address typed in the form (since 2026-11-06, once
   the Resend key is set up; see `docs/operations.md`).
4. If the site cannot send it, the page offers to open the visitor's mail program with the request
   written out (exactly what you would receive), and shows the same text to copy.
5. Switch to **EN** at the top and look at the English version.

**What to look for:** prices, services, opening hours and travel that are wrong; anything a customer
would not understand; whether the request email tells you everything you need to plan the visit;
and anything missing.

## 2. Proofreading the Danish

[`proofreading.csv`](proofreading.csv) opens in Excel. It has one row per text: the site's
buttons and messages, the request email and the customer's copy (the `mail.*` rows), and the privacy
policy and terms paragraph by paragraph, and the repairs' names and prices.

- **Status** says *Ny/ændret 2026-11-06* for texts that are new or changed since the last review
  (sending from the site): read those first.
- **Dansk** is the text now; **English** is there for context. For the terms, the English column
  may be empty where the two versions are not split into the same paragraphs; the English page is
  `/terms.html`, further down.
- Write a correction in **Rettelse** (the whole corrected text, not just the changed word), and
  anything else in **Kommentar**. Leave rows that are fine empty.
- Words in curly braces, such as `{time}` or `{total}`, are filled in by the site. Keep them as they
  are.
- Save as CSV (either "CSV UTF-8" or plain CSV works) and send the file back.

The corrections are applied with `npm run import-texts -- <file>`, legal paragraphs included. A
correction that would cross a link or bold text in a legal paragraph is listed instead, to apply
by hand. After changes, run `npm run export-texts` to make a fresh sheet.

The texts were written by an AI assistant. They are understandable, but they will not always sound
the way a Dane would write them. The **legal pages and the early-start checkbox** (`co.earlyStart`)
matter most, then the request email and the booking form.

## 3. Legal review

See [`docs/legal-checklist.md`](../legal-checklist.md): what the owner must provide (business
details, CVR, choices for the terms), what the owner's reply to a request must contain, the
questions for the reviewer, and the rules that were checked.

## 4. The owner's Google Sheet

The owner edits the site's texts himself in a Google Sheet, and a job brings his changes to
theneighbor.dk within about 15 minutes (`scripts/sheet-sync.sh`, see
[docs/operations.md](../operations.md#texts-from-the-google-sheet)).

The sheet has one row per text, the same texts as the proofreading sheet plus the repairs' names
and prices: **Hvor** (where), **Nøgle** (the key; do not change), **Dansk**, **English**,
**Hjælp** (a hint) and **Kommentar** (free notes; the site ignores them). Dansk and English are
edited in place: there is no correction column.

### Sådan bruger du arket (for the owner)

1. Find teksten, du vil ændre (brug Ctrl+F / ⌘F i Google Sheets).
2. Skriv den nye tekst direkte i **Dansk** eller **English**. Ret begge, hvis begge sprog skal
   ændres.
3. Det er det. Hjemmesiden er opdateret inden for ca. et kvarter.

Godt at vide:

- **Priser** skrives kun som hele tal i **Dansk**-kolonnen, fx `199` (ikke `199 kr.` eller
  `1.000`), fra 0 til 5000. "Anden reparation" har altid `aftale`.
- **Ord i krøllede parenteser**, fx `{time}` eller `{price}`, udfylder hjemmesiden selv. Lad dem stå
  præcis som de er.
- **Links og fed skrift** i privatlivspolitikken og handelsbetingelserne: ret gerne ordene, men
  ikke selve link-teksten sammen med ordene omkring den i én ændring. Står der noget i **Hjælp**,
  så læs det først.
- Tilføj eller slet ikke rækker, og ret ikke i **Nøgle**. Mangler der en tekst, så skriv til Alec.
- Kan en ændring ikke bruges (fx en pris med bogstaver), sker der ingenting på hjemmesiden, og
  Alec får besked. Ret cellen, så kommer resten med ved næste kørsel.

In plain English: find the text, type the new words straight into the Dansk or English cell, and
the site follows within about a quarter of an hour. Prices are whole numbers in the Dansk column
only; keep anything in {curly braces}; don't add, delete or rename rows. A cell that cannot be
used stops that update (nothing half-done reaches the site) and Alec is told.

### Making the sheet (once)

1. `npm run sheet-export` writes [`sheet.csv`](sheet.csv) (and adds any new texts to
   `sheet-state.json`; commit both).
2. In Google Sheets: **File → Import → Upload** `sheet.csv`, "Replace spreadsheet", separator
   **comma**. Freeze the first row; narrow **Nøgle**, widen **Dansk** and **English**, and turn on
   text wrapping. Protecting the Hvor, Nøgle and Hjælp columns is a good idea.
3. **Share**: the owner as **Editor**; **General access: Anyone with the link → Viewer** (the job
   downloads the CSV without signing in).
4. Put the sheet's address where the job reads it (`~/.config/the-neighbor/sheet-url` on the
   machine that runs it).

The sheet does not change when texts are changed in the code; those rows keep the old text, which
the job ignores (see docs/operations.md). To bring the sheet up to date, export again and paste
the new Dansk/English values over the old rows, or make a fresh sheet.

### What the sheet cannot change

Opening hours, travel price per km, distances, closed days, the booking address and phone
(`CONFIG` in `web/js/booking-rules.js`), the repairs' durations, adding or removing a repair, adding
or removing paragraphs on the legal pages, links' addresses, and the footer's address and CVR line in
`web/index.html`. Those still need a developer.

