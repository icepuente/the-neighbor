# Review pack: getting the content right before launch

Three reviews, which can run at the same time. None of them needs a developer until the
corrections come back.

| Review | Who | What they get | What comes back |
|---|---|---|---|
| 1. Try the demo | the owner | [the demo guide](#1-demo-guide-for-the-owner) below | notes on what is wrong or missing |
| 2. Proofread the Danish | a native Danish speaker | [`proofreading.csv`](proofreading.csv) | the same file, with corrections |
| 3. Legal review | a lawyer, or someone who knows Danish consumer law | `/privacy.html`, `/terms.html` and [the checklist](../legal-checklist.md) | the business details, the choices, and corrections |

## 1. Demo guide (for the owner)

The demo is at **https://book.icepuente.com**. It is a full copy of the site with made-up data.
Nothing you do there reaches a real customer, and no email is sent. The data is reset every day,
so you can't break anything. Emails appear in the dashboard's **Outbox**, so you can read them
there.

Try it on your phone as well as a computer: customers will mostly book on a phone.

**As a private customer** (the site opens in Danish; EN at the top switches to English):

1. Book a service on the front page: pick services, a day in the calendar and a time, enter an
   address (suggestions come from the Danish address register), and attach a photo of a bike.
   Tick **Opret en konto** and choose a password. On the price page, accept the terms and confirm.
2. Follow the link to **Min konto**: the booking is there, and can be cancelled online until 24
   hours before.
3. Log out, and log in as the demo customer **anna@demo.dk / neighbor-demo**. Look at
   **Historik** (a visit that was logged), **Mine cykler** (add a bike with photos) and
   **Anbefalinger** (what the mechanic recommended).
4. Send a business request with the form under **For virksomheder**.

**As the owner:** open **https://book.icepuente.com/admin.html** and log in as
**owner@demo.dk / neighbor-demo**.

1. **Bookings:** your booking from step 1 has arrived. Confirm it, reschedule it, write a private
   note and a message to the customer. Then open **Log the visit**: write what you did, add parts,
   a photo and a recommendation, and save. The customer's account now shows it (step 3 above, if
   you booked as Anna).
2. **Requests:** your business request is there. Choose a plan and **Create business account**.
3. **Companies:** add a few bikes to the company's fleet (with photos), then fill in this month's
   report and save it.
4. **Outbox:** read the emails the customers would have received.
5. Log in on **/account.html** as the business you created (its email, with password
   `neighbor-demo`), or as **hotel@demo.dk / neighbor-demo**: the monthly report, the fleet and
   the plan. The report can be printed or saved as a PDF.

**What to look for:** prices, services and opening hours that are wrong; anything a customer
would not understand; anything you would do differently in your work (the visit form, the fleet
report); and anything missing. Write it down in any form: a list, voice notes, screenshots.

## 2. Proofreading the Danish

[`proofreading.csv`](proofreading.csv) opens in Excel. It has one row per text: the site's
buttons and messages, every email the customers receive (rendered with sample values; the
words in parentheses are examples), and the privacy policy and terms paragraph by paragraph.

- **Dansk** is the text now; **English** is there for context. For the terms, the English
  column is empty because the two versions are not split into the same paragraphs; the English
  page is `/terms.html`, further down.
- Write a correction in **Rettelse** (the whole corrected text, not just the changed word), and
  anything else in **Kommentar**. Leave rows that are fine empty.
- Words in curly braces, such as `{ref}` or `{name}`, are filled in by the site. Keep them as they
  are.
- Save as CSV (either "CSV UTF-8" or plain CSV works) and send the file back.

The site texts are applied with `npm run import-texts -- <file>`; the script lists the email and
legal rows, which are applied by hand. After changes, run `npm run export-texts` to make a fresh
sheet.

The texts were written by an AI assistant. They are understandable, but they will not always
sound the way a Dane would write them. The **legal pages and the early-start checkbox**
(`co.earlyStart`) matter most, then the emails and the booking form.

## 3. Legal review

See [`docs/legal-checklist.md`](../legal-checklist.md): what the owner must provide (business
details, CVR, choices for the terms), the questions for the reviewer, and the rules that were
checked. The privacy policy now also covers customer accounts, saved bikes, service history and
business customers (added 2026-10-17).
