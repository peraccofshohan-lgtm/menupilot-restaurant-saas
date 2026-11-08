-- ===========================================================================
-- MenuPilot · Supabase Realtime authorization
--
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL → New query) after
-- applying the application migrations. It is safe to re-run.
--
-- How the security model works
-- ----------------------------
-- 1. `/api/realtime/token` mints a short-lived JWT for a signed-in user. The
--    `mp_topic` claim is derived server-side from the session's membership, e.g.
--        mp_topic: "restaurant:<their own restaurant id>"
--    A guest tracking one order receives
--        mp_topic: "order:<hmac of their tracking token>"
-- 2. The browser opens a *private* channel with that topic.
-- 3. Supabase Realtime calls `realtime.messages` RLS with the JWT's claims. The
--    policy below allows a subscription only when the requested topic equals the
--    claim, so a client that edits the topic is refused even though its client-side
--    code is fully under its control.
--
-- Nothing here reads application tables. Realtime only tells a client "something
-- changed on your channel"; the data itself always comes from an authorized API
-- route (`/api/orders/feed`, `/api/kitchen/feed`, `/api/realtime/order`), so
-- tenant isolation still rests on the RLS policies in the public schema.
-- ===========================================================================

-- The messages table is created by Supabase when Realtime Authorization is enabled
-- on the project (Dashboard → Realtime → Settings → "Enable Realtime Authorization").
-- If it does not exist yet, enable it there and re-run this file.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages does not exist yet — enable Realtime Authorization in the dashboard, then re-run this file';
    return;
  end if;

  -- Read: a client may receive events only on the topic its token names.
  execute $q$
    drop policy if exists menupilot_realtime_read on realtime.messages
  $q$;
  execute $q$
    create policy menupilot_realtime_read on realtime.messages
      for select to authenticated, anon
      using (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'mp_topic') = (select realtime.topic())
      )
  $q$;

  -- Write: broadcast/presence on the same terms. MenuPilot does not broadcast
  -- application data today, but leaving writes unscoped would let one tenant spam
  -- another tenant's channel if a feature is added later.
  execute $q$
    drop policy if exists menupilot_realtime_write on realtime.messages
  $q$;
  execute $q$
    create policy menupilot_realtime_write on realtime.messages
      for insert to authenticated, anon
      with check (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'mp_topic') = (select realtime.topic())
      )
  $q$;
end $$;

-- ---------------------------------------------------------------------------
-- Optional: publish order changes so Postgres CDC can be used instead of the
-- "something changed, re-read the feed" signal. Kept commented out deliberately —
-- enabling it sends row data to subscribed clients, and the current UI does not
-- need it. If you enable it, the read policy above still gates delivery.
-- ---------------------------------------------------------------------------
-- alter publication supabase_realtime add table public.orders;
