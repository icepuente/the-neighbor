# Privacy policy and terms: what the owner needs to provide

Drafts: [`web/privacy.html`](../web/privacy.html) and [`web/terms.html`](../web/terms.html), each in
Danish and English, rewritten 2026-10-23 for the email-only site (repairs for private customers; no
accounts, subscriptions, photos or stored data). Everything highlighted in yellow on those pages
(`<mark class="todo">`) is a placeholder. They were written by an AI assistant, not a lawyer: they
follow the Danish rules listed at the end as closely as possible, but **have them checked before
launch**, the terms especially, and have a native speaker proofread the Danish.

## Why the site is so simple (decided 2026-10-23, changed 2026-11-06)

On 2026-10-23 the owner chose a site that keeps nothing **and sends nothing**, for GDPR reasons: he
is not ready to take on GDPR work for accounts and stored customer data. A booking was an email the
customer sent from their own mail program, and the owner replied. What remained was what any
business that takes bookings by email has: the emails themselves, the payments and the accounting
records.

**On 2026-11-06 this changed** (branch `server-email`, chosen by Alec; the owner should agree to it,
below): the site's server now sends the request itself, through Resend, to the owner with a copy to
the customer, and asks for the customer's email address. The site still stores nothing, but it now
**transmits** personal data through a processor (Resend, a US company), which is new GDPR work:
a data processing agreement, a transfer to the US, and a processor that keeps the emails for 30
days. The mail program stays as the fallback. Section 4 lists what this needs.

## 1. Business details (required on the website by law)

- [x] Legal name and type: The Neighbor v/ Volodymyr Taran, enkeltmandsvirksomhed (CVR register).
- [x] CVR number: 46840291.
- [x] Business address: Rørsangervej 45, 2400 København NV (the CVR register adds 2. tv.).
- [x] Booking email and phone in `CONFIG.contact` (2026-11-06).
- [x] VAT: not registered yet (the terms say so, and no VAT is added). **When turnover passes 50,000 kr a year he must register, and the prices on the site must then include
      moms**: update terms section 2 (and the prices, if they change).

## 2. Choices for the terms

- [x] Free cancellation until 24 hours before the visit.
- [x] No fee for later cancellation, or when the bike cannot be reached (customers are asked to say so early).
- [x] Payment: on the spot, with Vipps MobilePay (#124895) or by bank transfer, due 5 days after the
      visit (the owner, 2026-11-06; in the FAQ, the terms section 6 and the privacy policy).
- [x] Customers must be 18 or older.
- [x] The Danish version applies if the two differ.

## 3. Choices for the privacy policy

- [x] Booking emails are deleted 12 months after the visit; accounting records are kept 5 years.
- [x] Email provider: Google (Gmail). A consumer Gmail account has no data processing agreement; the owner plans Google Workspace later (then the policy can stay as it is).
- [x] The owner keeps his own books: no accountant receives data.
- [ ] Hosting at launch: the policy says the site is delivered through Cloudflare and that the
      server keeps no visitor log (true for the home server's nginx, and for the API, which logs
      status lines only). If the site moves elsewhere, check that both still hold.

## 4. Before the API sends anything (Resend, 2026-11-06)

- [ ] **The owner agrees** to the site sending requests through Resend, given that he chose a site
      that sends nothing on 2026-10-23 (above). If he does not, the branch is simply not deployed.
- [ ] **Data processing agreement**: Resend's DPA (pre-signed, applies to every account; signed copy
      under Settings → Documents) is accepted in the business's name and kept with its papers
      (GDPR Art. 28). The controller is the business, so the account should be the business's.
- [ ] **Transfer to the US**: Resend says it is certified under the EU-U.S. Data Privacy Framework
      (legal entity Plus Five Five, Inc.) and its DPA includes the standard contractual clauses
      (module 2). Check the listing on https://www.dataprivacyframework.gov/list (it could not be
      checked automatically) and that the policy's wording still matches. Choosing the Ireland
      region decides where emails are **sent from**, not where they are **stored** (US, 30 days):
      the policy says so.
- [ ] **Retention**: the policy says Resend deletes the emails after 30 days (Resend's stated
      retention on the free, Pro and Scale plans). Check it still holds for the plan chosen.
- [ ] **Records of processing** (GDPR Art. 30), if the owner keeps them: add Resend as a processor.
- [ ] **IP addresses for the abuse limits**: held in memory only, as a keyed hash, for at most an
      hour, on the legitimate-interest basis (Art. 6(1)(f)); the policy says so. A reviewer may want
      that sentence checked.
- [ ] **Durable medium**: the customer's copy now carries both ticked statements (the terms, and
      the early start with the withdrawal acknowledgement), so the customer has them by email even
      when the site sends the request. This does **not** replace section 5 below: the withdrawal
      information and form must still go out with the owner's confirmation.
- [ ] The terms (section 3 and 5 of `terms.html`) now say a booking can be sent from the site, and
      that both statements are in the copy. Have the reviewer read the changed paragraphs.

## 5. In the owner's reply to a request

- [ ] **The withdrawal information and the standard withdrawal form must reach the customer on a
      durable medium** (Forbrugerombudsmanden): a link is not enough. The simplest way is a reply
      template the owner uses to confirm a booking, with the withdrawal information and the form
      (both are on `/terms.html`, section 5) pasted in, or attached as a PDF.
- [ ] The reply confirms the time and the final price (travel is only estimated on the site).

## 6. Before launch

- [ ] Native-speaker proofreading of the Danish; legal review of the terms. The sheet for the
      proofreader is [`docs/review/proofreading.csv`](review/proofreading.csv); see
      [`docs/review/README.md`](review/README.md). The request email and the customer's copy are in
      it (the `mail.*` rows), as are the two checkboxes (`co.acceptTerms`, `co.earlyStart`). Texts
      new or changed for sending from the site (2026-11-06) are flagged **Ny/ændret** in its Status
      column: the new privacy-policy paragraphs on Resend especially.

## Rules checked (2026-10-17)

- **Forbrugeraftaleloven** (LBK 1184 of 28/09/2025; two later amendments are in force, so check the
  current text): 14-day right of withdrawal for services bought at a distance (a booking by email
  is one), running from when the agreement is made. § 18(2)(2): the right ends when the service is
  *fully performed* only if the work started with the consumer's **prior express consent and
  acknowledgement** that the right ends then; the general terms alone are not enough, the customer
  must actively accept it. The site asks for it with a checkbox, and the sentence is written into
  the request email and into the copy the site sends the customer (or the customer's own email,
  in the mail-program fallback). § 25: if the customer withdraws after work has started at their
  request, they pay a reasonable share.
- **E-handelsloven § 7** and forbrugeraftaleloven § 8: the site must show legal name and form,
  address, email (and e.g. phone) and CVR number.
- **EU Online Dispute Resolution platform**: closed on 20 July 2025 (Regulation (EU) 2024/3228), so
  no link to it is required. Danish consumer complaints go to Nævnenes Hus.
- **GDPR**: the details in a booking email are processed to make and perform the agreement (Article
  6(1)(b)), not on consent; invoices are kept under the Bookkeeping Act (Article 6(1)(c)). The site
  itself sets no cookies and keeps only the language choice in the visitor's browser, which needs
  no consent. Since 2026-11-06 (not yet checked by a reviewer): Resend is a processor (Art. 28) in
  the US (Chapter V transfer: DPF adequacy decision, SCCs as a fallback); the short-lived IP
  counting for abuse limits rests on Art. 6(1)(f).
