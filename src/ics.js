import { env, site } from './config.js';
import { slotByStart, zonedTimeToUtc } from './schedule.js';

const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (t) =>
  String(t ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// RFC 5545 line folding (lines should not exceed 75 octets).
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let cut = 60;
    while (Buffer.byteLength(rest.slice(0, cut + 1)) <= 74 && cut < rest.length) cut++;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function bookingIcs(b) {
  const slot = slotByStart(b.slot) || { start: b.slot, end: b.slot };
  const location = [b.address, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bike-booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.ref}@${new URL(env.publicUrl).hostname}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(zonedTimeToUtc(b.date, slot.start))}`,
    `DTEND:${fmt(zonedTimeToUtc(b.date, slot.end))}`,
    `SUMMARY:${esc(`${site.businessName}: ${b.service_name}`)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(`Booking ${b.ref}\nManage your booking: ${env.publicUrl}/b/${b.token}`)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const icsAttachment = (b) => ({
  filename: `${b.ref}.ics`,
  content: bookingIcs(b),
  contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
});
