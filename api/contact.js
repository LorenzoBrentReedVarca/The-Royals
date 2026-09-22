/**
 * POST /api/contact — the contact form's delivery route.
 *
 * Vercel runs any file under api/ as a serverless function; there is no build
 * step and no dependency to install, because Node's global fetch is all this
 * needs. CommonJS on purpose: without a package.json declaring modules, a .js
 * file here is CommonJS, and adding one only to change that would be a build
 * system the rest of the site does not have.
 *
 * Two environment variables, set on the Vercel project, never in this repo:
 *
 *   RESEND_API_KEY   the same Resend key Supabase sends through. A key with
 *                    Sending access is enough; see docs/SETUP.md.
 *   CONTACT_INBOX    where enquiries land. Any real mailbox — the domain has
 *                    no MX records, so it cannot be an @theroyalseminentlounge.com
 *                    address. Comma-separate to reach several people.
 *
 * The domain is verified with Resend for sending, which is why From can be
 * no-reply@theroyalseminentlounge.com while Reply-To is the guest: the host
 * team answers by hitting reply, and the guest sees their own thread.
 */

'use strict';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SENDER = 'The Royals <no-reply@theroyalseminentlounge.com>';

/* The subjects offered by the <select> on contact.html. Anything else is a
   request that did not come from the form. */
const SUBJECTS = [
  'Table reservation',
  'Private or corporate event',
  'Guest list enquiry',
  'Feedback about a visit',
  'Lost property',
  'Press & partnerships',
  'Careers',
  'Something else'
];

const LIMITS = { name: 120, email: 254, phone: 40, message: 4000 };

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};

  /* A field no person can see, filled in. Answer exactly as a success would
     look: a bot told it failed just comes back wearing something else. */
  if (clean(body.company, 100)) return res.status(200).json({ ok: true });

  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email);
  const phone = clean(body.phone, LIMITS.phone);
  const message = clean(body.message, LIMITS.message);
  const subject = clean(body.subject, 80);

  if (!name || !message || !EMAIL_RX.test(email)) {
    return res.status(400).json({ error: 'Please check the highlighted fields.' });
  }
  if (!body.consent) {
    return res.status(400).json({ error: 'We need your permission to reply.' });
  }

  const topic = SUBJECTS.includes(subject) ? subject : 'Something else';

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: 'That is a lot of messages. Please try again a little later.' });
  }

  const key = process.env.RESEND_API_KEY;
  const inbox = process.env.CONTACT_INBOX;

  /* Misconfiguration must never read to the guest as "message sent". Better
     they see a failure and reach for WhatsApp than write into a void. */
  if (!key || !inbox) {
    console.error('contact: missing RESEND_API_KEY or CONTACT_INBOX');
    return res.status(500).json({ error: 'The message could not be sent.' });
  }

  const rows = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone || '—'],
    ['Subject', topic]
  ];

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9a7722">
        The Royals — website enquiry
      </p>
      <h2 style="margin:0 0 18px;font-size:19px">${esc(topic)}</h2>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 18px;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:3px 16px 3px 0;color:#666">${k}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`
          )
          .join('')}
      </table>
      <div style="padding:14px 16px;background:#f6f5f2;border-left:3px solid #d4af37;white-space:pre-wrap">${esc(message)}</div>
      <p style="margin:18px 0 0;font-size:12px;color:#888">
        Reply to this email and it goes straight to ${esc(email)}.
      </p>
    </div>`;

  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${message}\n\nReply to reach ${email}.`;

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
        subject: `${topic} — ${name}`,
        html,
        text
      })
    });

    if (!resend.ok) {
      /* Resend's own words are the only reliable account of what went wrong.
         They go to the Vercel log, never to the guest. */
      console.error('contact: resend %s %s', resend.status, await resend.text());
      return res.status(502).json({ error: 'The message could not be sent.' });
    }
  } catch (err) {
    console.error('contact: resend unreachable', err);
    return res.status(502).json({ error: 'The message could not be sent.' });
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
