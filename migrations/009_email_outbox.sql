-- ===========================================================================
-- 009_email_outbox.sql
--
-- Transactional email is attempted, not assumed. Every message the application
-- wants to send is written here with its real outcome:
--
--   sent     the provider accepted it (provider_id set)
--   failed   the provider rejected it or the call threw
--   skipped  no provider is configured, so nothing left the server
--
-- That makes "we sent you an invitation" auditable, and lets an operator see the
-- backlog after adding provider credentials to an environment.
--
-- No policies: reachable only by trusted server code. The table stores the
-- recipient and subject, never a message body (reset links are credentials).
-- ===========================================================================

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('staff_invitation', 'password_reset', 'order_notification')),
  recipient text not null,
  subject text not null,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  detail text,
  provider_id text,
  created_at timestamptz not null default now()
);

create index if not exists email_outbox_created_idx on public.email_outbox (created_at desc);
create index if not exists email_outbox_restaurant_idx on public.email_outbox (restaurant_id);

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;
