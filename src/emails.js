import { env, site, contactEmail, formatPrice } from './config.js';
import { formatDate, slotLabel } from './schedule.js';

const ACCENT = '#e8590c';
const INK = '#1c2321';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const paragraphs = (text) =>
  String(text ?? '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

const firstName = (b) => b.name.trim().split(/\s+/)[0];
const manageUrl = (b) => `${env.publicUrl}/b/${b.token}`;
const when = (b) => `${formatDate(b.date)}, ${slotLabel(b.slot)}`;
const fullAddress = (b) => [b.address, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const bike = (b) => [b.bike_type, b.bike_brand, b.bike_model].filter(Boolean).join(' · ');

function detailRows(b, { includeContact = false } = {}) {
  const rows = [
    ['Reference', b.ref],
    ['Service', `${b.service_name}${b.service_price != null ? ` (from ${formatPrice(b.service_price)})` : ''}`],
    ['When', when(b)],
    ['Where', fullAddress(b)],
    ['Bike', bike(b)],
    ['Access notes', b.access_notes],
    ['Problem', b.problem],
  ];
  if (includeContact) rows.splice(1, 0, ['Name', b.name], ['Email', b.email], ['Phone', b.phone]);
  return rows.filter(([, v]) => v);
}

function detailsHtml(b, opts) {
  const rows = detailRows(b, opts)
    .map(
      ([k, v]) => `<tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${esc(k)}</td>
        <td style="padding:6px 0;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-top:1px solid #eee;margin:8px 0 20px;padding-top:8px">${rows}</table>`;
}

const detailsText = (b, opts) =>
  detailRows(b, opts)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

function layout({ preheader = '', heading, bodyHtml, cta }) {
  const contact = [site.contactPhone, contactEmail].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:${INK};padding:18px 28px;color:#fff;font-weight:700;font-size:18px">
      <span style="color:${ACCENT}">&#9679;</span> ${esc(site.businessName)}
    </td></tr>
    <tr><td style="padding:28px;font-size:15px;line-height:1.55">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(heading)}</h1>
      ${bodyHtml}
      ${
        cta
          ? `<p style="margin:24px 0 8px"><a href="${esc(cta.url)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(cta.label)}</a></p>`
          : ''
      }
    </td></tr>
    <tr><td style="padding:16px 28px 24px;font-size:12px;color:#6b7280;border-top:1px solid #eee">
      ${esc(site.businessName)} · ${esc(site.tagline)}${contact ? `<br>${contact}` : ''}<br>
      You can reply to this email to reach us.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

function customerEmail(b, { subject, heading, intro, outro = '', showDetails = true }) {
  const text = [
    `Hi ${firstName(b)},`,
    '',
    intro,
    '',
    showDetails ? detailsText(b) : '',
    outro ? `\n${outro}` : '',
    '',
    `View or manage your booking: ${manageUrl(b)}`,
    '',
    `${site.businessName}`,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
  const html = layout({
    preheader: intro,
    heading,
    bodyHtml: `<p style="margin:0 0 14px">Hi ${esc(firstName(b))},</p>${paragraphs(intro)}${
      showDetails ? detailsHtml(b) : ''
    }${paragraphs(outro)}`,
    cta: { url: manageUrl(b), label: 'View or manage your booking' },
  });
  return { subject, text, html };
}

// --- Customer emails ---------------------------------------------------------

export const bookingReceived = (b) =>
  customerEmail(b, {
    subject: `Booking request received: ${b.ref}`,
    heading: 'Thanks, we got your booking request',
    intro: `We've received your request for a ${b.service_name.toLowerCase()} on ${when(b)}. We'll check the details and confirm by email shortly.`,
    outro: 'Need to add something? Reply to this email or send us a message from your booking page.',
  });

export const bookingConfirmed = (b) =>
  customerEmail(b, {
    subject: `Booking confirmed: ${formatDate(b.date, 'short')}, ${slotLabel(b.slot)}`,
    heading: "You're booked in",
    intro: `Your booking is confirmed. We'll come to ${fullAddress(b)} on ${when(b)}.`,
    outro:
      "Please make sure the bike is somewhere we can reach. If you won't be there, put the details in your access notes. A calendar invite is attached.",
  });

export const bookingRescheduled = (b) =>
  customerEmail(b, {
    subject: `New time for your booking: ${formatDate(b.date, 'short')}, ${slotLabel(b.slot)}`,
    heading: 'Your booking has a new time',
    intro: `Your booking ${b.ref} has moved to ${when(b)}. An updated calendar invite is attached.`,
    outro: "If the new time doesn't work for you, just reply and we'll sort it out.",
  });

export const bookingCancelled = (b, reason) =>
  customerEmail(b, {
    subject: `Booking cancelled: ${b.ref}`,
    heading: 'Your booking has been cancelled',
    intro: `Your booking for ${when(b)} has been cancelled.${reason ? `\n\nReason: ${reason}` : ''}`,
    outro: `Want to book another time? Visit ${env.publicUrl}/#book`,
    showDetails: false,
  });

export const bookingCompleted = (b) =>
  customerEmail(b, {
    subject: `Your bike is ready: ${b.ref}`,
    heading: 'All done, enjoy the ride',
    intro: `Your ${b.service_name.toLowerCase()} is complete. Thanks for choosing ${site.businessName}!`,
    outro: "If anything doesn't feel right on your next ride, reply to this email and we'll come back and fix it.",
    showDetails: false,
  });

export function customMessage(b, subject, body) {
  const text = `${body}\n\n---\nBooking ${b.ref}, ${when(b)}\nReply to this email or use your booking page: ${manageUrl(b)}`;
  const html = layout({
    preheader: body.slice(0, 120),
    heading: subject,
    bodyHtml: `${paragraphs(body)}<p style="margin:20px 0 0;font-size:13px;color:#6b7280">Booking ${esc(b.ref)} · ${esc(when(b))}</p>`,
    cta: { url: manageUrl(b), label: 'Open your booking' },
  });
  return { subject: `${subject} (${b.ref})`, text, html };
}

// --- Owner notifications -----------------------------------------------------

const adminUrl = (b) => `${env.publicUrl}/admin#booking-${b.id}`;

function ownerEmail(b, { subject, heading, intro, body = '' }) {
  const text = `${intro}\n\n${body ? `${body}\n\n` : ''}${detailsText(b, { includeContact: true })}\n\nOpen in admin: ${adminUrl(b)}`;
  const html = layout({
    preheader: intro,
    heading,
    bodyHtml: `${paragraphs(intro)}${
      body
        ? `<blockquote style="margin:0 0 16px;padding:10px 14px;background:#faf7f2;border-left:3px solid ${ACCENT}">${paragraphs(body)}</blockquote>`
        : ''
    }${detailsHtml(b, { includeContact: true })}`,
    cta: { url: adminUrl(b), label: 'Open in admin' },
  });
  return { subject, text, html };
}

export const ownerNewBooking = (b) =>
  ownerEmail(b, {
    subject: `New booking ${b.ref}: ${b.service_name}, ${formatDate(b.date, 'short')} ${slotLabel(b.slot)}`,
    heading: 'New booking',
    intro: `${b.name} booked a ${b.service_name.toLowerCase()} for ${when(b)}.${
      b.status === 'pending' ? ' It needs confirming.' : ''
    } Reply to this email to answer the customer directly.`,
  });

export const ownerCustomerMessage = (b, body) =>
  ownerEmail(b, {
    subject: `Message from ${b.name} (${b.ref})`,
    heading: `New message from ${b.name}`,
    intro: `${b.name} sent a message about booking ${b.ref}:`,
    body,
  });

export const ownerCustomerCancelled = (b, reason) =>
  ownerEmail(b, {
    subject: `Cancelled by customer: ${b.ref}, ${formatDate(b.date, 'short')} ${slotLabel(b.slot)}`,
    heading: 'Booking cancelled by customer',
    intro: `${b.name} cancelled their booking for ${when(b)}.`,
    body: reason ? `Reason: ${reason}` : '',
  });

// Fills {firstName}, {date}, {time}, {ref}, {price}, {service} in admin message templates.
export function fillTemplate(str, b) {
  const vars = {
    firstName: firstName(b),
    name: b.name,
    date: formatDate(b.date),
    time: slotLabel(b.slot),
    ref: b.ref,
    service: b.service_name,
    price: formatPrice(b.service_price),
  };
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
