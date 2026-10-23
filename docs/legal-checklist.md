# Privacy policy and terms: what the owner needs to provide

Drafts: [`web/privacy.html`](../web/privacy.html) and [`web/terms.html`](../web/terms.html), each in
Danish and English, rewritten 2026-10-23 for the email-only site (repairs for private customers; no
accounts, subscriptions, photos or stored data). Everything highlighted in yellow on those pages
(`<mark class="todo">`) is a placeholder. They were written by an AI assistant, not a lawyer: they
follow the Danish rules listed at the end as closely as possible, but **have them checked before
launch**, the terms especially, and have a native speaker proofread the Danish.

## Why the site is so simple (decided 2026-10-23)

The owner is not ready to take on GDPR work for accounts and stored customer data. So the site keeps
nothing: a booking is an email the customer sends from their own mail program, and the owner
replies. What remains is what any business that takes bookings by email has: the emails themselves,
the payments and the accounting records. The privacy policy covers exactly that.

## 1. Business details (required on the website by law)

- [ ] Legal name of the business, and its type (e.g. enkeltmandsvirksomhed / sole proprietorship)
- [ ] CVR number
- [ ] Business address. The site says *Rørsangervej 45, København* as the base for travel. If that
      is a home address, it will be public; the law requires the address where the business is
      established.
- [ ] Email address for booking requests (goes in `CONFIG.contact.email` in
      `web/js/booking-rules.js`), and a phone number if it should be shown
- [ ] Is the business VAT (moms) registered? Prices on the site are written as "incl. VAT".

## 2. Choices for the terms

- [ ] Free cancellation until how long before the visit? (draft: 24 hours)
- [ ] Fee for later cancellation, or when the bike cannot be reached? (draft: open)
- [x] Payment: on the spot, with Vipps or by bank transfer (the owner, 2026-10-23; in the FAQ, the
      terms section 6 and the privacy policy). Still open: the deadline for a bank transfer (draft:
      8 days after the visit). Danish customers know the app as **MobilePay** (Vipps MobilePay since
      the 2024 merger): check whether the site should say "MobilePay" or "Vipps / MobilePay".
- [ ] Must customers be 18 or older? (draft: marked as a question)
- [ ] English version: does the Danish version apply if they differ? (draft: yes)

## 3. Choices for the privacy policy

- [ ] How long to keep booking emails after the visit (draft: 12 months; invoices must be kept 5
      years under the Bookkeeping Act regardless)
- [ ] Which email provider holds the booking emails (named in the policy)
- [ ] An accountant or bookkeeper who receives invoice data, if any
- [ ] Hosting at launch: the policy says the site is delivered through Cloudflare and that the
      server keeps no visitor log (true for the home server's nginx). If the site moves elsewhere,
      check that both still hold.

## 4. In the owner's reply to a request

- [ ] **The withdrawal information and the standard withdrawal form must reach the customer on a
      durable medium** (Forbrugerombudsmanden): a link is not enough. The simplest way is a reply
      template the owner uses to confirm a booking, with the withdrawal information and the form
      (both are on `/terms.html`, section 5) pasted in, or attached as a PDF.
- [ ] The reply confirms the time and the final price (travel is only estimated on the site).

## 5. Before launch

- [ ] Native-speaker proofreading of the Danish; legal review of the terms. The sheet for the
      proofreader is [`docs/review/proofreading.csv`](review/proofreading.csv); see
      [`docs/review/README.md`](review/README.md). The request email the customer sends is in it
      (the `mail.*` rows), as are the two checkboxes (`co.acceptTerms`, `co.earlyStart`).

## Rules checked (2026-10-17)

- **Forbrugeraftaleloven** (LBK 1184 of 28/09/2025; two later amendments are in force, so check the
  current text): 14-day right of withdrawal for services bought at a distance (a booking by email
  is one), running from when the agreement is made. § 18(2)(2): the right ends when the service is
  *fully performed* only if the work started with the consumer's **prior express consent and
  acknowledgement** that the right ends then; the general terms alone are not enough, the customer
  must actively accept it. The site asks for it with a checkbox, and the sentence is written into
  the customer's own request email. § 25: if the customer withdraws after work has started at their
  request, they pay a reasonable share.
- **E-handelsloven § 7** and forbrugeraftaleloven § 8: the site must show legal name and form,
  address, email (and e.g. phone) and CVR number.
- **EU Online Dispute Resolution platform**: closed on 20 July 2025 (Regulation (EU) 2024/3228), so
  no link to it is required. Danish consumer complaints go to Nævnenes Hus.
- **GDPR**: the details in a booking email are processed to make and perform the agreement (Article
  6(1)(b)), not on consent; invoices are kept under the Bookkeeping Act (Article 6(1)(c)). The site
  itself sets no cookies and keeps only the language choice in the visitor's browser, which needs
  no consent.
