// The two emails for a booking request, as Resend API payloads (plain text):
// - to the owner, from the site's address, Reply-To the customer: the same request email the
//   mailto: link carried (web/js/booking-rules.js requestEmail), in the customer's language;
// - to the customer, a copy, Reply-To the owner: a few lines on what happens next, a link to the
//   terms, then the same request, with the two statements the customer ticked (the terms, and the
//   early start with the withdrawal acknowledgement), so the customer has them on a durable medium.
// Only the services, date and time go into a subject; nothing the visitor typed goes into a header
// except their email address, which validate.js has checked to be one plain address.
import * as R from '../web/js/booking-rules.js';

export const SITE_URL = 'https://theneighbor.dk';
export const DEFAULT_FROM = 'The Neighbor <booking@theneighbor.dk>';

export function buildEmails({ request, quote }, L, { from = DEFAULT_FROM, owner = R.CONFIG.contact.email } = {}) {
  const mail = R.requestEmail(request, quote, L);
  const copy = [
    L.t('mail.copyIntro'),
    '',
    L.t('mail.copyNext'),
    '',
    L.t('mail.copyTerms', { url: `${SITE_URL}/terms.html` }),
    '',
    `--- ${L.t('mail.copyHead')} ---`,
    '',
    mail.body,
  ].join('\r\n');
  return {
    owner: { from, to: [owner], reply_to: request.email, subject: mail.subject, text: mail.body },
    copy: { from, to: [request.email], reply_to: owner, subject: L.t('mail.copySubject', { subject: mail.subject }), text: copy },
  };
}
