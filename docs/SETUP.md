# The Royals — how the site is wired

Everything outside the code: which services hold what, and what to do when
something breaks. No secrets live here. Where a credential is needed, this says
where to find it, not what it is.

---

## The short version

| thing | where it lives |
|---|---|
| Site hosting | **Hostinger** shared hosting — LiteSpeed and PHP |
| Code | GitHub, `LorenzoBrentReedVarca/The-Royals`, branch `main` |
| Domain registrar | **OnlyDomains** (back-end registrar shows as Instra) |
| DNS | **Hostinger** |
| Mailboxes | **Hostinger** email, on the domain itself |
| Guest accounts | Supabase, project ref `atzkuodhsooszjavlqgw`, named "Royals" |
| Outgoing email | Resend, sending as `no-reply@theroyalseminentlounge.com` |
| Contact form | `api/contact.php` → Resend → `CONTACT_INBOX` |
| Guest list | Supabase table `newsletter_subscribers`, insert-only |

There is no build step. The HTML, CSS and JS are served exactly as written, and
`api/contact.php` is the only thing that runs on the server.

**`.htaccess` is what makes the site behave.** Clean URLs, the canonical
hostname, the cache policy, the security headers and the 404 page all live in
it. It replaces `vercel.json`, which Hostinger does not read and never will.

---

## Moving off Vercel

The site ran on Vercel until this move, and until the nameservers actually
change, **Vercel is still serving the live site**. That is why `vercel.json` is
still in the repository: deleting it mid-flight would strip clean URLs and the
redirects from the deployment that visitors are currently using. It goes at the
end, not the beginning.

Do it in this order.

### 1. Put the site on Hostinger while Vercel still has the domain

hPanel → Websites → add `theroyalseminentlounge.com`. Then Git → connect the
GitHub repository, branch `main`, deploy path `public_html`.

Hostinger's git deploy copies **the whole repository** into `public_html`, which
is why `.htaccess` refuses to serve `docs/`, `supabase/`, and anything ending
`.md`, `.sql`, `.toml` or `.log`. Without those rules this file would be public.

Test on the temporary Hostinger URL before touching DNS.

### 2. Put the config where the web cannot reach it

`api/contact.php` reads its key from `royals-config.php`, which must sit **one
level above `public_html`** — outside everything git deploys:

```
domains/theroyalseminentlounge.com/
├── royals-config.php      <- the real one, with the key in it
└── public_html/           <- the git deploy lands here
```

Copy `royals-config.example.php`, fill it in, and upload it with the File
Manager or SFTP. Never with git. It is in `.gitignore` so a stray commit cannot
take it public by accident.

### 3. Recreate the Resend DNS records — miss this and all email stops

**This is the step that breaks things.** Resend's records currently live in
Vercel's DNS. The moment the nameservers move to Hostinger they are gone, and
Resend can no longer send as the domain. That takes out account confirmations,
password resets and the contact form together.

Recreate all three in Hostinger's DNS editor **before** changing nameservers, so
they are already in place when the new zone starts answering:

| name | type | value |
|---|---|---|
| `send` | TXT | `v=spf1 include:amazonses.com ~all` |
| `send` | MX | `feedback-smtp.ap-northeast-1.amazonses.com` — priority 10 |
| `resend._domainkey` | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCyEUFqORasgdyPFpiVQsTT8eeAJFXMU1UQr6+vd36HWoEvUUA6Cm+MjxtocjinO23N1QXnvzY/FUJBfwccXeTzokHFGCLpQUC0vOprITJbjYCh+auE3KmP3/jnDrMs7asztu39O+ymNeEqthHQgtmu9Qk/yWN2YeyFPj949tOfQIDAQAB` |

They live on the `send` subdomain, which is why they never collide with the
mailbox records on the root. Resend → Domains will confirm them as verified.

### 4. Create the mailboxes

hPanel → Emails → create `info@theroyalseminentlounge.com`. Hostinger adds the
root MX and its own SPF automatically. Put that address in `CONTACT_INBOX`.

Until this exists the domain cannot receive mail at all — it never could on
Vercel, which is why enquiries had nowhere of their own to land.

### 5. Change the nameservers

At **OnlyDomains**, under DNS Settings → "Delegate to Your Name Servers", to the
pair hPanel shows you. That panel has been known to report success without
submitting; the registry is the only thing worth believing:

```bash
curl -s "https://rdap.verisign.com/com/v1/domain/theroyalseminentlounge.com" | grep -i nameserver
```

### 6. Verify, then clean up

```bash
# the canonical host, clean URLs and the redirects
for u in / /about /about.html /menu /book /whatsapp /nope; do
  curl -s -o /dev/null -w "$u  %{http_code} -> %{redirect_url}
" "https://theroyalseminentlounge.com$u"
done

# www must still land on the apex
curl -sI https://www.theroyalseminentlounge.com/ | head -3
```

Then, and only then: delete `vercel.json` and `api/contact.js`, and remove the
Vercel project so nothing is left serving a stale copy.

---

## Domain and DNS

Registered at **OnlyDomains**, not Hostinger — only the nameservers point here.
DNS records are edited in hPanel → Domains → DNS Zone.

The site answers on two hostnames. `theroyalseminentlounge.com` is the real one;
`www` is redirected to it by `.htaccess` rather than by a DNS record, so the
redirect works regardless of how the visitor arrived.

The old `the-kings-seven.vercel.app` hostname stops mattering once the Vercel
project is removed. While the project still exists, it keeps redirecting to the
apex, so there is no rush.

---

## Deploying

Push to `main`, then trigger the pull in hPanel → Git. Nothing is built and
nothing is compiled; the files that land are the files that are served.

Two things are **not** in the repository and survive every deploy, because they
live outside `public_html`:

- `royals-config.php` — the Resend key and the inbox
- the mailboxes, which are Hostinger's own

If a deploy ever appears to do nothing, check that the pull actually ran: the
git panel shows the commit it last pulled, and it is easy to push and forget the
second half.

---

## Guest accounts (Supabase)

Project ref `atzkuodhsooszjavlqgw`. The publishable key sits in
`assets/js/auth.js` and is safe there — it is meant to be read by the browser
and grants only what Row Level Security allows. The **secret** key
(`sb_secret_…`) must never appear in any file the browser can load.

Configured state:

- **Confirm email**: on. New guests must click a link before they can sign in.
- **Site URL**: `https://theroyalseminentlounge.com` — no wildcard; the field
  rejects them.
- **Redirect URLs**: the domain and `www` with `/**`, plus the old Vercel
  hostname and localhost. The Vercel entry stays because confirmation links
  already sent still point at it.

`supabase/config.toml` mirrors all of this so it is reviewable in git, but
**Supabase does not read it**. Changing that file does nothing until:

```bash
supabase config push --project-ref atzkuodhsooszjavlqgw
```

---

## Email (Resend)

Domain `theroyalseminentlounge.com` is verified with Resend, region Tokyo
(`ap-northeast-1`). DKIM and the SPF records live on the `send` subdomain, which
is why they do not clash with any SPF record on the root domain.

Supabase sends through Resend over SMTP. The settings live at
Authentication → Emails → SMTP Settings:

| field | value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` — the literal word, not an email address |
| Password | a Resend API key |
| Sender email | `no-reply@theroyalseminentlounge.com` |
| Sender name | The Royals |

### The trap that will catch you

**Supabase blanks the password field every time that page is saved.** If you
edit the sender, the port, or anything else and do not re-paste the API key in
the same edit, sending breaks silently. The symptom is `535 "Authentication
credentials invalid"` in the auth logs. This has caused every email outage so
far.

### Reading the actual error

Guessing wastes hours. The real reason is always written down:

- **Supabase → Logs → Auth** — the mail server's own rejection string
- **Resend → Emails** — every send attempt Resend received. Empty means
  Supabase never authenticated.

Errors seen and what they meant:

| error | cause |
|---|---|
| `535 "Invalid username"` | username was an email address, not `resend` |
| `535 "Authentication credentials invalid"` | API key wrong, or blanked on save |
| `550 "You can only send testing emails…"` | sender was `onboarding@resend.dev`, which only ever reaches the account owner |

---

## Email templates

`supabase/templates/confirm-signup.html` and `reset-password.html` are the
source of truth, but **Supabase serves whatever is pasted into its dashboard**.
Editing the file changes nothing until it is pasted into
Authentication → Emails.

Subjects in use:

- Confirm signup — `Confirm your account at The Royals`
- Reset Password — `Reset your password — The Royals`

They are built as email rather than as web pages: tables for layout, colours
inlined on every cell, and a button that is a table cell with a background
rather than a styled link, because Outlook discards padding on anchors. Cinzel
and Cormorant load only where `@import` is honoured (Apple Mail, iOS); Gmail and
Outlook fall back to Georgia and Times New Roman.

Templates not yet branded: Magic Link, Invite user, Reauthentication, Change
Email Address. None of them fire today, because nothing in the site requests
them.

---

## What the account does, and does not, do

Working: sign up, confirm by email, sign in, sign out, forgotten-password
recovery, and the booking form filling itself in for a signed-in guest. The
phone number is not asked for at sign-up, so the first booking is where it is
learned and stored on the user.

**Still not built:** "Your past and upcoming tables in one place" was promised
on the account page and has now been taken off it. Reservations are not stored
anywhere — the booking form opens WhatsApp with the details written into a
message, and the host team confirms each one personally. Showing past tables
would need a `reservations` table with row-level security and a change to how
booking works. That is a decision about how the venue runs, not just a feature.

The account page now lists only what signing in actually does: details
remembered, and a password that can be recovered. The mailing list it used to
promise has gone from that page too — the guest list is gathered by the footer
form instead, which is described below.

---

## The contact form

The form on `contact.html` posts JSON to `/api/contact`. `.htaccess` maps that
to `api/contact.php`, which keeps the URL extensionless and meant the browser
code did not change when this moved off Vercel. It is the only server-side code
on the site; everything else is files served as written.

It validates the fields again server-side, then calls Resend:

- **From** `no-reply@theroyalseminentlounge.com`, which is allowed because the
  domain is verified with Resend for sending.
- **To** whatever `CONTACT_INBOX` is set to.
- **Reply-To** the guest's own address, so the host team answers by hitting
  reply and the guest sees their own thread.

### The two settings

Both live in `royals-config.php`, **one level above `public_html`** — see
"Moving off Vercel" above for why that location is not negotiable:

| name | value |
|---|---|
| `RESEND_API_KEY` | a Resend key. **Sending access** is enough. |
| `CONTACT_INBOX` | where enquiries land. Comma-separate for several people. |

```php
<?php
return [
    'RESEND_API_KEY' => 're_...',
    'CONTACT_INBOX'  => 'info@theroyalseminentlounge.com',
];
```

The script falls back to environment variables if that file is absent, so the
same code runs unchanged anywhere that sets them properly.

If either setting is missing the script returns a failure and the guest is told
plainly, with WhatsApp offered instead. **It never shows a thank-you for a
message it did not send**; that was the whole reason for building it.

### When it breaks

The reason is always written down. Look in this order:

1. **hPanel → Advanced → PHP error log** — carries Resend's own rejection
   string, logged by `error_log()` and never shown to the guest.
2. **Resend → Emails** — every send attempt Resend actually received. Empty
   means the request never got that far.

Checking the endpoint directly, which needs no browser:

```bash
curl -i -X POST https://theroyalseminentlounge.com/api/contact   -H "Content-Type: application/json"   -d '{"name":"Test","email":"you@example.com","subject":"Careers","message":"A test message, long enough to pass.","consent":true}'
```

`200` means Resend accepted it. `500` means the config file is missing or
unreadable. `502` means Resend refused — the log will say why. `429` means the
throttle below has already seen five from your address this hour.

### What keeps the bots out

A honeypot field (`name="company"`) that is off-screen, out of the tab order and
hidden from screen readers. Anything arriving with it filled in gets the same
success response and is quietly dropped.

There is also a per-IP throttle of five an hour, kept as files in the temp
directory because shared hosting gives PHP no shared memory between requests. If
that directory is ever unwritable the throttle lets messages through rather than
blocking them: a limiter that cannot record anything must not become a wall.

---

## The guest list (newsletter)

The footer form on every page writes to `public.newsletter_subscribers` in the
same Supabase project, straight from the browser with the publishable key.

The policy in `supabase/migrations/20260919021500_newsletter_subscribers.sql`
grants `insert` and nothing else. **There is deliberately no select policy**, so
the list cannot be read back through the API by anyone holding the publishable
key — which is everyone who loads the site. Read it in the dashboard, under
Table Editor, or export it there.

Applying the migration — it must be done **before** the form is live, or every
signup gets an error:

```bash
supabase db push --project-ref atzkuodhsooszjavlqgw
```

Or paste the file into the SQL Editor in the dashboard, which needs no local
link and no database password.

A repeat signup hits the unique index on `lower(email)` and comes back as
`409`. The browser treats that as success, because from the guest's side being
on the list twice and being on it once are the same thing.

Nothing sends to this list yet. It is a list being collected, not a mailing
system — that still needs deciding.

---

## Search engines

`robots.txt` and `sitemap.xml` sit at the root and are written by hand. The
sitemap lists the seven public pages with extensionless URLs, because
`.htaccess` redirects `/about.html` to `/about` and then serves `about.html`
without a second round trip. `/account` is in neither: it is a sign-in form, and
the password-reset link that lands there carries a token.

`404.html` is served for any unmatched path, via `ErrorDocument` in `.htaccess`.
It uses root-relative asset paths on purpose — it can be rendered at any depth,
and `assets/…` would break.

---

## Rotating the Resend key

The key in use has **Full access**, which can send as the venue, read the email
logs, and delete the verified domain. A **Sending access** key can only send.

1. Resend → API Keys → Create, permission **Sending access**
2. Paste into Supabase → Authentication → Emails → SMTP Settings → Password
3. Save — changing nothing else
4. Delete the old key in Resend

---

## Checking it works

```bash
# does signup send mail?
curl -s -X POST "https://atzkuodhsooszjavlqgw.supabase.co/auth/v1/signup" \
  -H "apikey: <publishable key from assets/js/auth.js>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-long-enough-password"}'

# where do confirmation links land?
curl -s -o /dev/null -w "%{redirect_url}\n" \
  "https://atzkuodhsooszjavlqgw.supabase.co/auth/v1/verify?token=probe&type=signup" \
  -H "apikey: <publishable key>"
```

A signup creates a real user. Remove test accounts afterwards at
Authentication → Users.
