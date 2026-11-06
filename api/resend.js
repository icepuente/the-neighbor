// Sending an email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// One POST per email, with an Idempotency-Key, so a retry (here, or the visitor's) never sends the
// same email twice: Resend answers a repeated key with the first result for 24 hours.
//
// Returns { ok, status, name } and never throws. `name` is Resend's error code (e.g.
// "validation_error"), reduced to [a-z_]: Resend's error *messages* can quote an email address, so
// they are never read, and nothing about the email is ever logged.
export const RESEND_URL = 'https://api.resend.com/emails';

const retryable = (r) => r.status === 0 || r.status === 429 || r.status >= 500 || r.name === 'concurrent_idempotent_requests';

export function resendTransport({ apiKey, fetch = globalThis.fetch, url = RESEND_URL, timeoutMs = 10_000, retryDelayMs = 1000 }) {
  if (!apiKey) throw new Error('resendTransport needs an API key');
  async function once(email, idempotencyKey) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': 'the-neighbor-api',
        },
        body: JSON.stringify(email),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let name = '';
      try {
        const data = await res.json();
        name = res.ok ? '' : String(data?.name || '');
      } catch { /* no JSON body */ }
      return { ok: res.ok, status: res.status, name: name.toLowerCase().replace(/[^a-z_]/g, '').slice(0, 40) };
    } catch (e) {
      return { ok: false, status: 0, name: e?.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
  }
  // One retry, after a pause, for a network error, a timeout, a rate limit or a server error.
  return async function send(email, idempotencyKey) {
    const first = await once(email, idempotencyKey);
    if (first.ok || !retryable(first)) return first;
    await new Promise((r) => setTimeout(r, retryDelayMs));
    return once(email, idempotencyKey);
  };
}
