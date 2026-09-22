-- Guest-list signups from the footer form, which sits on every page.
--
-- The browser inserts straight into this table with the publishable key, so
-- the policy at the bottom is the only thing standing between that form and
-- the data. It grants INSERT and nothing else. There is deliberately no
-- SELECT policy: the list cannot be read back through the API by anyone
-- holding the publishable key, which is everyone who loads the site. Read it
-- in the dashboard, or with the secret key from somewhere the browser cannot
-- see.

create table if not exists public.newsletter_subscribers (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null
                          check (char_length(email) between 6 and 254)
                          check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  source      text,       -- the page the signup came from, e.g. /events
  created_at  timestamptz not null default now()
);

comment on table public.newsletter_subscribers is
  'Guest-list signups from the site footer. Insert-only from the browser.';

-- Case-insensitive, so Aisha@… and aisha@… are one person rather than two.
-- The client reads the 409 this produces as success, because from the guest's
-- side being on the list twice and being on it once are the same thing.
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

create index if not exists newsletter_subscribers_created_at_idx
  on public.newsletter_subscribers (created_at desc);

alter table public.newsletter_subscribers enable row level security;

grant insert on public.newsletter_subscribers to anon, authenticated;

drop policy if exists "anyone may join the guest list" on public.newsletter_subscribers;
create policy "anyone may join the guest list"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);
