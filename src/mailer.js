import nodemailer from 'nodemailer';
import { env, site } from './config.js';

const transport = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export const mailEnabled = !!transport;

export async function verifyMail() {
  if (!transport) {
    console.warn('[mail] SMTP_HOST not set: emails will be printed to the console instead of sent');
    return;
  }
  try {
    await transport.verify();
    console.log(`[mail] SMTP ready (${env.smtp.host}:${env.smtp.port})`);
  } catch (err) {
    console.error(`[mail] SMTP verification failed: ${err.message}`);
  }
}

// Never throws: returns { ok, error } so callers can record delivery status.
export async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const message = {
    from: { name: site.businessName, address: env.mailFromAddress },
    to,
    replyTo: replyTo || env.ownerEmail || undefined,
    subject,
    text,
    html,
    attachments,
  };
  if (!transport) {
    console.log(`\n[mail:dev] To: ${to}\n[mail:dev] Subject: ${subject}\n${text}\n`);
    return { ok: true };
  }
  try {
    await transport.sendMail(message);
    return { ok: true };
  } catch (err) {
    console.error(`[mail] send to ${to} failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
