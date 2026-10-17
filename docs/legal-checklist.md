# Privacy policy and terms: what the owner needs to provide

Drafts: [`web/privacy.html`](../web/privacy.html) and [`web/terms.html`](../web/terms.html), each in
Danish and English (2026-10-17). Everything highlighted in yellow on those pages (`<mark class="todo">`)
is a placeholder. They were written by an AI assistant, not a lawyer: they follow the Danish rules
listed at the end as closely as possible, but **have them checked before launch**, the terms
especially, and have a native speaker proofread the Danish.

## 1. Business details (required on the website by law)

- [ ] Legal name of the business, and its type (e.g. enkeltmandsvirksomhed / sole proprietorship)
- [ ] CVR number
- [ ] Business address. The site currently says *Rørsangervej 45, København* as the base for travel.
      If that is a home address, it will be public; the law requires the address where the business
      is established.
- [ ] Email address and phone number for customers
- [ ] Is the business VAT (moms) registered? Prices on the site are written as "incl. VAT".

## 2. Choices for the terms

- [ ] Free cancellation until how long before the visit? (draft: 24 hours)
- [ ] Fee for later cancellation, or when the bike cannot be reached? (draft: open)
- [ ] Payment terms (draft: invoice by email after the visit, 8 days)
- [ ] How Care subscriptions are invoiced (draft: monthly in advance)
- [ ] Care cancellation after the 3-month minimum (draft: effective at the end of the month in which
      the customer cancels). Danish law allows the customer to cancel after 5 months at most anyway,
      so 3 months is fine.
- [ ] Must customers be 18 or older? (draft: marked as a question)
- [ ] English version: does the Danish version apply if they differ? (draft: yes)

## 3. Choices for the privacy policy

- [ ] How long to keep bookings after the visit (draft: 3 years; invoices must be kept 5 years under
      the Bookkeeping Act regardless)
- [ ] How long to keep business enquiries that do not lead to an agreement (draft: 12 months)
- [ ] Which email provider sends confirmations (chosen later, with the .dk domain)
- [ ] An accountant or bookkeeper who receives invoice data, if any

## 4. Actions before launch

- [ ] In the Firebase console, accept Google's data processing terms for the project (Project
      settings, privacy section), so Google is formally the data processor the policy describes.
- [ ] The booking confirmation **email** must contain the withdrawal information and the standard
      withdrawal form: a link is not enough (Forbrugerombudsmanden). To build with email sending.
- [x] A checkbox in the booking for the right of withdrawal (see below). *Done 2026-10-17:* the
      price page has two required boxes, "I accept the terms" and the early-start request with the
      acknowledgement; the booking records both, with the terms version and the time. The old consent
      popup is gone: booking data rests on the agreement, not on consent. Check the wording of the
      early-start box (`co.earlyStart` in `web/js/i18n.js`) with the rest.
- [ ] Native-speaker proofreading of the Danish text; legal review of the terms.

## Rules checked (2026-10-17)

- **Forbrugeraftaleloven** (LBK 1184 of 28/09/2025; two later amendments are in force, so check the
  current text): 14-day right of withdrawal for services bought online, running from when the
  agreement is made. § 18(2)(2): the right ends when the service is *fully performed* only if the
  work started with the consumer's **prior express consent and acknowledgement** that the right
  ends then; the general terms alone are not enough, the customer must actively accept it. § 25: if
  the customer withdraws after work has started at their request, they pay a reasonable share.
  § 28: continuing contracts can be cancelled after 5 months at most, with at most 1 month's notice.
- **E-handelsloven § 7** and forbrugeraftaleloven § 8: the site must show legal name and form,
  address, email (and e.g. phone) and CVR number.
- **EU Online Dispute Resolution platform**: closed on 20 July 2025 (Regulation (EU) 2024/3228), so
  no link to it is required. Danish consumer complaints go to Nævnenes Hus.
- **GDPR**: booking data is processed to perform the agreement (Article 6(1)(b)), not on consent.
