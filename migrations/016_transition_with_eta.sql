-- ---------------------------------------------------------------------------
-- 016 · transition_order accepts the preparation estimate
--
-- Redefines the lifecycle function from 003 with one extra argument rather than
-- editing 003 in place: an applied migration is a historical fact, and a
-- database that already ran it would never see a quiet edit.
--
-- Why the ETA belongs here: the owner sets the estimate *when accepting*. Doing
-- that as two statements would allow an order to become `accepted` with no
-- promise attached — the guest's page would sit on "waiting for restaurant
-- confirmation" forever. One statement, one outcome.
--
-- Everything else is unchanged: the same transition table, the same role
-- checks, the same immutable history row.
-- ---------------------------------------------------------------------------

create or replace function public.transition_order(
  p_order_id    uuid,
  p_next        text,
  p_reason      text    default null,
  p_eta_minutes integer default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_order   public.orders%rowtype;
  v_uid     uuid := public.mp_uid();
  v_role    text;
  v_allowed text[];
  v_now     timestamptz := now();
begin
  if v_uid is null then
    raise exception 'MP:NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'MP:ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_role := public.mp_role(v_order.restaurant_id);
  if v_role is null then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  -- permitted transitions per current status and acting role
  case v_order.status
    when 'pending' then
      if p_next in ('accepted', 'rejected') then
        v_allowed := array['owner', 'manager'];
      end if;
    when 'accepted' then
      if p_next = 'preparing' then v_allowed := array['owner', 'manager', 'kitchen']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    when 'preparing' then
      if p_next = 'ready' then v_allowed := array['owner', 'manager', 'kitchen']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    when 'ready' then
      if p_next = 'served' then v_allowed := array['owner', 'manager', 'kitchen', 'waiter']; end if;
      if p_next = 'cancelled' then v_allowed := array['owner', 'manager']; end if;
    else
      v_allowed := null;
  end case;

  if v_allowed is null then
    raise exception 'MP:INVALID_TRANSITION:%->%', v_order.status, p_next using errcode = 'P0001';
  end if;
  if not (v_role = any (v_allowed)) then
    raise exception 'MP:FORBIDDEN_TRANSITION:%->%', v_role, p_next using errcode = '42501';
  end if;

  if p_eta_minutes is not null then
    if p_next <> 'accepted' then
      raise exception 'MP:ETA_NOT_ALLOWED:%', p_next using errcode = 'P0001';
    end if;
    if p_eta_minutes < 1 or p_eta_minutes > 240 then
      raise exception 'MP:INVALID_ETA' using errcode = '22023';
    end if;
  end if;

  update public.orders set
    status = p_next,
    accepted_at  = case when p_next = 'accepted'  then v_now else accepted_at end,
    accepted_by  = case when p_next = 'accepted'  then v_uid else accepted_by end,
    preparing_at = case when p_next = 'preparing' then v_now else preparing_at end,
    ready_at     = case when p_next = 'ready'     then v_now else ready_at end,
    served_at    = case when p_next = 'served'    then v_now else served_at end,
    rejected_at  = case when p_next = 'rejected'  then v_now else rejected_at end,
    rejected_by  = case when p_next = 'rejected'  then v_uid else rejected_by end,
    cancelled_at = case when p_next = 'cancelled' then v_now else cancelled_at end,
    eta_minutes   = case when p_eta_minutes is not null then p_eta_minutes else eta_minutes end,
    eta_set_at    = case when p_eta_minutes is not null then v_now else eta_set_at end,
    eta_set_by    = case when p_eta_minutes is not null then v_uid else eta_set_by end,
    eta_revisions = case when p_eta_minutes is not null then eta_revisions + 1 else eta_revisions end,
    revision      = revision + 1,
    updated_at    = v_now,
    rejection_reason = case when p_next = 'rejected'
      then nullif(btrim(coalesce(p_reason, '')), '') else rejection_reason end
  where id = v_order.id;

  insert into public.order_status_history (order_id, restaurant_id, from_status, to_status, changed_by, actor_role, note)
  values (v_order.id, v_order.restaurant_id, v_order.status, p_next, v_uid, v_role, nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', p_next,
    'previous_status', v_order.status,
    'eta_minutes', coalesce(p_eta_minutes, v_order.eta_minutes)
  );
end $$;

grant execute on function public.transition_order(uuid, text, text, integer) to authenticated;
