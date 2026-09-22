<?php
/**
 * Template for royals-config.php — the real file must live ONE LEVEL ABOVE
 * public_html and must never be committed.
 *
 * On Hostinger the layout ends up like this:
 *
 *   domains/theroyalseminentlounge.com/
 *   ├── royals-config.php      <- the real one, with the key in it
 *   └── public_html/           <- the git deploy lands here
 *       ├── index.html
 *       └── api/contact.php
 *
 * Anything inside public_html is served to the public, and Hostinger's git
 * deploy copies the whole repository there. A key kept in the repository is
 * a key published. This file is the example, safe to commit because it holds
 * nothing; copy it up one level, rename it, and fill it in.
 *
 * Upload it with the hPanel File Manager or SFTP — not with git.
 */

return [
    // Resend → API Keys. "Sending access" is enough; see docs/SETUP.md.
    'RESEND_API_KEY' => '',

    // Where contact enquiries land. Comma-separate to reach several people.
    'CONTACT_INBOX'  => 'info@theroyalseminentlounge.com',
];
