-- ---------------------------------------------------------------------------
-- 019 · Retire the three-argument transition_order
--
-- 016 added a fourth parameter with a default, which in Postgres creates a
-- *second* function rather than replacing the first. A three-argument call then
-- has two equally valid candidates and the server refuses it outright:
--   "function public.transition_order(unknown, unknown, unknown) is not unique"
--
-- The four-argument version already handles every existing call, because the
-- extra parameter defaults to null. Dropping the old signature leaves exactly
-- one way to change an order's status.
-- ---------------------------------------------------------------------------

drop function if exists public.transition_order(uuid, text, text);
