# Review pack: getting the content right before launch

Three reviews, which can run at the same time. None of them needs a developer until the
corrections come back.

| Review | Who | What they get | What comes back |
|---|---|---|---|
| 1. Try the demo | the owner | [the demo guide](#1-demo-guide-for-the-owner) below | notes on what is wrong or missing |
| 2. Proofread the Danish | a native Danish speaker | [`proofreading.csv`](proofreading.csv) | the same file, with corrections |
| 3. Legal review | a lawyer, or someone who knows Danish consumer law | `/privacy.html`, `/terms.html` and [the checklist](../legal-checklist.md) | the business details, the choices, and corrections |

## 1. Demo guide (for the owner)

The demo is at **https://book.icepuente.com**. The yellow bar at the top says so: requests from the
demo go to a test address (`booking@example.com`), so nothing reaches anyone, and the site itself
stores nothing.

Try it on your phone as well as a computer: customers will mostly book on a phone.

1. On the front page, tap **Jeg er punkteret** (or pick repairs further down).
2. In the form, choose a day in the calendar and an arrival time, enter an address, postcode, name
   and phone, and tap **Se pris**.
3. On the price page, check the price, tick both boxes, and tap **Send forespørgsel på mail**. Your
   mail program opens with the request written out: this is exactly what you would receive. (Don't
   send it; it would go to the test address.)
4. The page then shows the same text to copy, for visitors whose phone or computer has no mail
   program set up.
5. Switch to **EN** at the top and look at the English version.

**What to look for:** prices, services, opening hours and travel that are wrong; anything a customer
would not understand; whether the request email tells you everything you need to plan the visit;
and anything missing.

## 2. Proofreading the Danish

[`proofreading.csv`](proofreading.csv) opens in Excel. It has one row per text: the site's
buttons and messages, the request email the customer sends (the `mail.*` rows), and the privacy
policy and terms paragraph by paragraph.

- **Dansk** is the text now; **English** is there for context. For the terms, the English column
  may be empty where the two versions are not split into the same paragraphs; the English page is
  `/terms.html`, further down.
- Write a correction in **Rettelse** (the whole corrected text, not just the changed word), and
  anything else in **Kommentar**. Leave rows that are fine empty.
- Words in curly braces, such as `{time}` or `{total}`, are filled in by the site. Keep them as they
  are.
- Save as CSV (either "CSV UTF-8" or plain CSV works) and send the file back.

The site texts are applied with `npm run import-texts -- <file>`; the script lists the legal rows,
which are applied by hand. After changes, run `npm run export-texts` to make a fresh sheet.

The texts were written by an AI assistant. They are understandable, but they will not always sound
the way a Dane would write them. The **legal pages and the early-start checkbox** (`co.earlyStart`)
matter most, then the request email and the booking form.

## 3. Legal review

See [`docs/legal-checklist.md`](../legal-checklist.md): what the owner must provide (business
details, CVR, choices for the terms), what the owner's reply to a request must contain, the
questions for the reviewer, and the rules that were checked.
