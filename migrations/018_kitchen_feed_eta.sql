-- ---------------------------------------------------------------------------
-- 018 · Kitchen feed carries the estimate and line-level prep state
--
-- Redefines `kitchen_feed()` from 003 (rather than editing it) so a ticket shows
-- the promise the guest was given — `eta_minutes` and when it was set — next to
-- the line states. The kitchen is where "are we on time?" is actually answered.
--
-- The audience check is unchanged: accepted tickets only. A pending order has no
-- business on this screen, and this function is one of the places that keeps it
-- that way.
-- ---------------------------------------------------------------------------

create or replace function public.kitchen_feed(p_restaurant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.mp_is_member(p_restaurant_id, array['owner', 'manager', 'kitchen', 'waiter']) then
    raise exception 'MP:FORBIDDEN' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(t order by (t ->> 'accepted_at')::timestamptz) from (
      select jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'table_label', d.label,
        'created_at', o.created_at,
        'accepted_at', coalesce(o.accepted_at, o.created_at),
        'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'eta_minutes', o.eta_minutes,
        'eta_set_at', o.eta_set_at,
        'note', o.note,
        'customer_name', o.customer_name,
        'item_count', o.item_count,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oi.id, 'name', oi.name_snapshot, 'quantity', oi.quantity,
            'note', oi.note, 'prep_status', oi.prep_status
          ) order by oi.sort_order)
          from public.order_items oi where oi.order_id = o.id
        ), '[]'::jsonb)
      ) as t
      from public.orders o
      left join public.dining_tables d on d.id = o.table_id
      where o.restaurant_id = p_restaurant_id and o.status in ('accepted', 'preparing', 'ready')
    ) s
  ), '[]'::jsonb);
end $$;

grant execute on function public.kitchen_feed(uuid) to authenticated;
