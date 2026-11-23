<?php
/**
 * POST /api/booking — the event enquiry form on reservations.html.
 *
 * The PHP rewrite of api/booking.js, kept in step with it for the move to
 * Hostinger: LiteSpeed will not run a Node function, so the language changes
 * and the behaviour does not. The public URL is still /api/booking, mapped
 * here by .htaccess, so the browser code is untouched.
 *
 * Configuration lives OUTSIDE public_html, in royals-config.php, one level
 * above the web root — see api/contact.php for why, and docs/SETUP.md for
 * where to put it.
 *
 *   RESEND_API_KEY   the Resend key. Sending access is enough.
 *   BOOKING_INBOX    optional override of where event enquiries land.
 *
 * The recipient is NEVER read from the request. A form that posts its own
 * destination is an open relay with extra steps.
 *
 * Targets PHP 7.4 and upwards.
 */

declare(strict_types=1);

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/* Event enquiries are sent as marketing@ and land in marketing@: the thread
   sits in that mailbox under its own name rather than arriving from a
   no-reply nobody recognises. Reply-To is still the guest, so hitting reply
   reaches them and not this mailbox talking to itself. */
const SENDER          = 'The Royals Events <marketing@theroyalseminentlounge.com>';
const DEFAULT_INBOX   = 'marketing@theroyalseminentlounge.com';

/* The occasions offered by the <select> on reservations.html. Anything else
   is a request that did not come from the form. */
const OCCASIONS = [
    'Birthday',
    'Corporate event',
    'Wedding or engagement',
    'Private party',
    'Others',
];

const LIMIT_EMAIL   = 254;
const LIMIT_PHONE   = 40;
const LIMIT_MESSAGE = 4000;

const RATE_WINDOW = 3600;  // seconds
const RATE_MAX    = 5;     // per window, per IP

/* -------------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------------- */

function respond(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

function clean($value, int $max): string
{
    if (!is_scalar($value)) {
        return '';
    }
    return mb_substr(trim((string) $value), 0, $max);
}

function esc(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Enough digits to be a number someone can be reached on, in any shape. */
function digits_in(string $value): int
{
    return (int) preg_match_all('/\d/', $value);
}

/**
 * "2026-12-12" reads as "Saturday 12 December 2026" in the email. An events
 * team scanning an inbox should not have to decode a date, and the weekday
 * is half the answer on its own. Returns '' for anything that is not a real
 * calendar date, which is what the caller treats as a failed field.
 */
function readable_date(string $iso): string
{
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $iso) !== 1) {
        return '';
    }
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $iso, new DateTimeZone('UTC'));
    if ($d === false || $d->format('Y-m-d') !== $iso) {
        return '';
    }
    return $d->format('l j F Y');
}

/**
 * Reads a setting from royals-config.php, falling back to the environment so
 * the same file runs unchanged on a host where variables are set properly.
 */
function config(string $key): string
{
    static $settings = null;

    if ($settings === null) {
        $settings   = [];
        $candidates = [];

        if (!empty($_SERVER['DOCUMENT_ROOT'])) {
            $root         = rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\');
            $candidates[] = dirname($root) . '/royals-config.php';
        }
        $candidates[] = dirname(__DIR__, 2) . '/royals-config.php';

        foreach ($candidates as $path) {
            if (is_readable($path)) {
                $loaded = require $path;
                if (is_array($loaded)) {
                    $settings = $loaded;
                }
                break;
            }
        }
    }

    if (isset($settings[$key]) && $settings[$key] !== '') {
        return (string) $settings[$key];
    }

    $fromEnv = getenv($key);
    return is_string($fromEnv) ? $fromEnv : '';
}

/**
 * Per-IP throttle, kept in the temp directory because shared hosting gives
 * no shared memory between requests. If the directory cannot be written this
 * returns false and lets the enquiry through: a throttle that cannot record
 * anything must not become a wall that blocks everything.
 */
function rate_limited(string $ip): bool
{
    $dir = sys_get_temp_dir() . '/royals-booking';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        return false;
    }
    if (!is_writable($dir)) {
        return false;
    }

    if (random_int(1, 50) === 1) {
        foreach ((array) glob($dir . '/*.json') as $old) {
            if (is_string($old) && @filemtime($old) < time() - RATE_WINDOW) {
                @unlink($old);
            }
        }
    }

    $path   = $dir . '/' . hash('sha256', $ip) . '.json';
    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        return false;
    }

    $limited = false;
    if (flock($handle, LOCK_EX)) {
        $now  = time();
        $raw  = (string) stream_get_contents($handle);
        $hits = json_decode($raw !== '' ? $raw : '[]', true);
        if (!is_array($hits)) {
            $hits = [];
        }

        $recent = [];
        foreach ($hits as $stamp) {
            if (is_int($stamp) && $now - $stamp < RATE_WINDOW) {
                $recent[] = $stamp;
            }
        }

        $limited = count($recent) >= RATE_MAX;
        if (!$limited) {
            $recent[] = $now;
        }

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, (string) json_encode($recent));
        fflush($handle);
        flock($handle, LOCK_UN);
    }
    fclose($handle);

    return $limited;
}

/* -------------------------------------------------------------------------
   The request
   ------------------------------------------------------------------------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['error' => 'Method not allowed']);
}

$raw  = (string) file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    $body = $_POST;  // a plain form post still works, should JS ever be off
}

/* A field no person can see, filled in. Answer exactly as a success would
   look: a bot told it failed simply comes back wearing something else. */
if (clean($body['company'] ?? '', 100) !== '') {
    respond(200, ['ok' => true]);
}

$email   = clean($body['email'] ?? '', LIMIT_EMAIL);
$phone   = clean($body['phone'] ?? '', LIMIT_PHONE);
$details = clean($body['message'] ?? '', LIMIT_MESSAGE);
$subject = clean($body['subject'] ?? '', 80);
$when    = readable_date(clean($body['date'] ?? '', 10));
/* Newlines stripped before this ever reaches a Subject header: a header is
   line-delimited, and free text is the one field a stranger controls. */
$other   = trim((string) preg_replace('/[\r\n]+/', ' ', clean($body['occasionOther'] ?? '', 80)));

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || digits_in($phone) < 7 || $when === '') {
    respond(400, ['error' => 'Please check the highlighted fields.']);
}

/* Others is a prompt, not an answer. When the guest has typed what the
   night actually is, that is what the events team should read. */
$occasion = in_array($subject, OCCASIONS, true) ? $subject : 'Others';
if ($occasion === 'Others' && $other !== '') {
    $occasion = $other;
}

$forwarded = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
$parts     = explode(',', $forwarded);
$ip        = trim($parts[0]);
if ($ip === '') {
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

if (rate_limited($ip)) {
    respond(429, ['error' => 'That is a lot of enquiries. Please try again a little later.']);
}

$key   = config('RESEND_API_KEY');
$inbox = config('BOOKING_INBOX');
if ($inbox === '') {
    $inbox = DEFAULT_INBOX;
}

/* Misconfiguration must never read to the guest as "enquiry sent". Better
   they see a failure and reach for WhatsApp than write into a void. */
if ($key === '') {
    error_log('booking: missing RESEND_API_KEY');
    respond(500, ['error' => 'The enquiry could not be sent.']);
}

$rows = [
    'Occasion' => $occasion,
    'Date'     => $when,
    'Phone'    => $phone,
    'Email'    => $email,
];

$cells = '';
foreach ($rows as $label => $value) {
    $cells .= '<tr><td style="padding:3px 16px 3px 0;color:#666">' . esc($label)
            . '</td><td style="padding:3px 0"><b>' . esc($value) . '</b></td></tr>';
}

$detailBlock = $details !== ''
    ? '<div style="padding:14px 16px;background:#f6f5f2;border-left:3px solid #d4af37;white-space:pre-wrap">'
      . esc($details) . '</div>'
    : '<p style="margin:0;color:#888;font-style:italic">No further detail given &mdash; worth asking for the date and numbers.</p>';

$html = '
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9a7722">
        The Royals &mdash; event enquiry
      </p>
      <h2 style="margin:0 0 18px;font-size:19px">' . esc($occasion) . '</h2>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 18px;font-size:14px">' . $cells . '</table>
      ' . $detailBlock . '
      <p style="margin:18px 0 0;font-size:12px;color:#888">
        Reply to this email and it goes straight to ' . esc($email) . '.
      </p>
    </div>';

$lines = [];
foreach ($rows as $label => $value) {
    $lines[] = $label . ': ' . $value;
}
$text = implode("\n", $lines) . "\n\n"
      . ($details !== '' ? $details : 'No further detail given.')
      . "\n\nReply to reach " . $email . '.';

$recipients = [];
foreach (explode(',', $inbox) as $address) {
    $address = trim($address);
    if ($address !== '') {
        $recipients[] = $address;
    }
}

$payload = json_encode([
    'from'     => SENDER,
    'to'       => $recipients,
    'reply_to' => $email,
    'subject'  => 'Event enquiry — ' . $occasion . ', ' . $when,
    'html'     => $html,
    'text'     => $text,
]);

$ch = curl_init(RESEND_ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . $key,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS     => $payload,
]);

$response = curl_exec($ch);
$status   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($response === false || $status < 200 || $status >= 300) {
    /* Resend's own words are the only reliable account of what went wrong.
       They go to the error log, never to the guest. */
    error_log('booking: resend ' . $status . ' ' . ($curlErr !== '' ? $curlErr : (string) $response));
    respond(502, ['error' => 'The enquiry could not be sent.']);
}

respond(200, ['ok' => true]);
