/**
 * POST /api/booking — the event enquiry form on reservations.html.
 *
 * A sibling of api/contact.js rather than a branch inside it. The two forms
 * ask for different things and answer to different people: contact wants a
 * name, a message and consent and lands in the general inbox; this one wants
 * a number, an address to reply to and an occasion, and lands with whoever
 * runs events. Folding them together would have meant a validator full of
 * "unless it is the other form", which is how one of them quietly breaks.
 *
 * Configuration:
 *   RESEND_API_KEY   the Resend key. Sending access is enough.
 *   BOOKING_INBOX    optional override of where event enquiries land.
 *
 * The recipient is NEVER read from the request. A form that posts its own
 * destination is an open relay with extra steps: anyone could point it at a
 * stranger and send mail signed by this domain. The address below is the
 * only one this route will ever write to.
 *
 * The domain is verified with Resend for sending, which is why From can be
 * no-reply@theroyalseminentlounge.com while Reply-To is the guest: the events
 * team answers by hitting reply, and the guest sees their own thread.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SENDER = 'The Royals <no-reply@theroyalseminentlounge.com>';
const DEFAULT_INBOX = 'marketing@theroyalseminentlounge.com';

/* The occasions offered by the <select> on reservations.html. Anything else
   is a request that did not come from the form. */
const OCCASIONS = [
  'Birthday',
  'Corporate event',
  'Wedding or engagement',
  'Private party',
  'Something else'
];

const LIMITS = { email: 254, phone: 40, message: 4000 };

/* Per-IP throttle. A serverless instance is short-lived and there may be
   several at once, so this is a speed bump rather than a lock: it stops one
   browser hammering one warm instance, and nothing more. The real protection
   is the honeypot below and Resend's own account limits. */
const RATE = { windowMs: 60 * 60 * 1000, max: 5 };
const seen = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  hits.push(now);
  seen.set(ip, hits);

  /* Keep the map from growing without bound on a long-lived instance. */
  if (seen.size > 500) {
    for (const [key, times] of seen) {
      if (!times.some((t) => now - t < RATE.windowMs)) seen.delete(key);
    }
  }
  return hits.length > RATE.max;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/* Enough digits to be a number someone can be reached on, in any of the
   shapes a guest might type: 050 123 4567, +971 50 123 4567, (050) 1234567. */
const digitsIn = (s) => (String(s).match(/\d/g) || []).length;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};

  /* A field no person can see, filled in. Answer exactly as a success would
     look: a bot told it failed just comes back wearing something else. */
  if (clean(body.company, 100)) return res.status(200).json({ ok: true });

  const email = clean(body.email, LIMITS.email);
  const phone = clean(body.phone, LIMITS.phone);
  const details = clean(body.message, LIMITS.message);
  const subject = clean(body.subject, 80);

  if (!EMAIL_RX.test(email) || digitsIn(phone) < 7) {
    return res.status(400).json({ error: 'Please check the highlighted fields.' });
  }

  const occasion = OCCASIONS.includes(subject) ? subject : 'Something else';

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: 'That is a lot of enquiries. Please try again a little later.' });
  }

  const key = process.env.RESEND_API_KEY;
  const inbox = process.env.BOOKING_INBOX || DEFAULT_INBOX;

  /* Misconfiguration must never read to the guest as "enquiry sent". Better
     they see a failure and reach for WhatsApp than write into a void. */
  if (!key) {
    console.error('booking: missing RESEND_API_KEY');
    return res.status(500).json({ error: 'The enquiry could not be sent.' });
  }

  const rows = [
    ['Occasion', occasion],
    ['Phone', phone],
    ['Email', email]
  ];

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9a7722">
        The Royals — event enquiry
      </p>
      <h2 style="margin:0 0 18px;font-size:19px">${esc(occasion)}</h2>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 18px;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:3px 16px 3px 0;color:#666">${k}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`
          )
          .join('')}
      </table>
      ${
        details
          ? `<div style="padding:14px 16px;background:#f6f5f2;border-left:3px solid #d4af37;white-space:pre-wrap">${esc(details)}</div>`
          : `<p style="margin:0;color:#888;font-style:italic">No further detail given — worth asking for the date and numbers.</p>`
      }
      <p style="margin:18px 0 0;font-size:12px;color:#888">
        Reply to this email and it goes straight to ${esc(email)}.
      </p>
    </div>`;

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\n${details || 'No further detail given.'}\n\nReply to reach ${email}.`;

  try {
    const resend = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: SENDER,
        to: inbox.split(',').map((a) => a.trim()).filter(Boolean),
        reply_to: email,
        subject: `Event enquiry — ${occasion}`,
        html,
        text
      })
    });

    if (!resend.ok) {
      /* Resend's own words are the only reliable account of what went wrong.
         They go to the Vercel log, never to the guest. */
      console.error('booking: resend %s %s', resend.status, await resend.text());
      return res.status(502).json({ error: 'The enquiry could not be sent.' });
    }
  } catch (err) {
    console.error('booking: resend unreachable', err);
    return res.status(502).json({ error: 'The enquiry could not be sent.' });
  }

  return res.status(200).json({ ok: true });
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
