import { env } from './config.js';
import { sendMail } from './mailer.js';
import { addMessage, setEmailStatus } from './bookings.js';
import * as emails from './emails.js';
import { icsAttachment } from './ics.js';

// Sends an email to the customer and records it in the booking's message thread.
export async function emailCustomer(booking, email, { kind = 'auto', subject, body, attachments } = {}) {
  const messageId = addMessage({
    booking_id: booking.id,
    direction: 'out',
    kind,
    subject: subject ?? email.subject,
    body: body ?? email.text,
    email_status: 'sending',
  });
  const result = await sendMail({ to: booking.email, ...email, attachments });
  setEmailStatus(messageId, result.ok ? 'sent' : 'failed', result.error);
  return result;
}

export async function emailOwner(booking, email) {
  if (!env.ownerEmail) return { ok: false, error: 'OWNER_EMAIL not set' };
  return sendMail({ to: env.ownerEmail, replyTo: `"${booking.name}" <${booking.email}>`, ...email });
}

// Fire-and-forget helpers for request handlers: email failures are logged and
// recorded on the message, never surfaced as request errors.
const background = (p) => p.catch((err) => console.error('[notify]', err));

export function onBookingCreated(b) {
  background(
    b.status === 'confirmed'
      ? emailCustomer(b, emails.bookingConfirmed(b), { attachments: [icsAttachment(b)] })
      : emailCustomer(b, emails.bookingReceived(b)),
  );
  background(emailOwner(b, emails.ownerNewBooking(b)));
}

export function onStatusChanged(b, { reason } = {}) {
  if (b.status === 'confirmed') return emailCustomer(b, emails.bookingConfirmed(b), { attachments: [icsAttachment(b)] });
  if (b.status === 'cancelled') return emailCustomer(b, emails.bookingCancelled(b, reason));
  if (b.status === 'completed') return emailCustomer(b, emails.bookingCompleted(b));
  return Promise.resolve({ ok: true });
}

export const onRescheduled = (b) =>
  emailCustomer(b, emails.bookingRescheduled(b), { attachments: [icsAttachment(b)] });

export const sendCustomMessage = (b, subject, body) =>
  emailCustomer(b, emails.customMessage(b, subject, body), { kind: 'manual', subject, body });

export function onCustomerMessage(b, body) {
  background(emailOwner(b, emails.ownerCustomerMessage(b, body)));
}

export function onCustomerCancelled(b, reason) {
  background(emailCustomer(b, emails.bookingCancelled(b, reason)));
  background(emailOwner(b, emails.ownerCustomerCancelled(b, reason)));
}
