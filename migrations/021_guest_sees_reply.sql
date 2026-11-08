-- ---------------------------------------------------------------------------
-- 021 · The guest can see the restaurant's reply
--
-- 015 shipped replies that only the owner could read, which makes the feature
-- pointless: a reply nobody sees is a note to self. `get_order_tracking` now
-- returns the guest's own reviews with the reply attached, so the tracking page
-- can show "the restaurant replied" next to the stars.
--
-- Scope is unchanged: this only ever returns reviews belonging to the order the
-- tracking token already proved ownership of.
-- ---------------------------------------------------------------------------

create or replace function public.get_order_tracking(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_order record;
  v_rest  record;
  v_table record;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into v_order from public.orders
   where tracking_token = public.mp_sha256(p_token)
   limit 1;
  if v_order.id is null then
    return null;
  end if;

  select * into v_rest from public.restaurants where id = v_order.restaurant_id;
  select * into v_table from public.dining_tables where id = v_order.table_id;

  return jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'placed_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'revision', v_order.revision,
    'accepted_at', v_order.accepted_at,
    'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at,
    'served_at', v_order.served_at,
    'rejected_at', v_order.rejected_at,
    'rejection_reason', v_order.rejection_reason,
    'eta_minutes', v_order.eta_minutes,
    'eta_set_at', v_order.eta_set_at,
    'eta_revisions', v_order.eta_revisions,
    'subtotal', v_order.subtotal,
    'tax_amount', v_order.tax_amount,
    'service_charge', v_order.service_charge,
    'total', v_order.total,
    'currency', v_order.currency,
    'note', v_order.note,
    'customer_name', v_order.customer_name,
    'table_label', v_table.label,
    'restaurant', jsonb_build_object(
      'name', v_rest.name, 'slug', v_rest.slug,
      'phone', v_rest.phone, 'logo_path', v_rest.logo_path,
      'address', v_rest.address, 'city', v_rest.city
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', oi.menu_item_id,
        'name', oi.name_snapshot, 'quantity', oi.quantity,
        'unit_price', oi.unit_price, 'line_total', oi.line_total,
        'note', oi.note, 'prep_status', oi.prep_status
      ) order by oi.sort_order)
      from public.order_items oi where oi.order_id = v_order.id
    ), '[]'::jsonb),
    'reviews', jsonb_build_object(
      'visited', v_order.status = 'served',
      'item_reviewed', coalesce((
        select jsonb_agg(r.menu_item_id)
        from public.order_reviews r
        where r.order_id = v_order.id and r.target_kind = 'item'
      ), '[]'::jsonb),
      'restaurant_reviewed', exists (
        select 1 from public.order_reviews r
        where r.order_id = v_order.id and r.target_kind = 'restaurant'
      ),
      -- What the guest wrote, and what came back. A hidden review keeps its
      -- reply: moderation hides the rating from the public menu, it does not
      -- erase the conversation the guest had with the restaurant.
      'mine', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'kind', r.target_kind,
          'rating', r.rating,
          'comment', r.comment,
          'item_name', (
            select mi.name from public.menu_items mi where mi.id = r.menu_item_id
          ),
          'created_at', r.created_at,
          'reply', (
            select rr.body from public.review_replies rr where rr.review_id = r.id
          ),
          'reply_at', (
            select rr.updated_at from public.review_replies rr where rr.review_id = r.id
          )
        ) order by r.created_at)
        from public.order_reviews r
        where r.order_id = v_order.id
      ), '[]'::jsonb)
    ),
    'service_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind, 'status', s.status, 'created_at', s.created_at
      ) order by s.created_at desc)
      from public.service_requests s where s.order_id = v_order.id
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.get_order_tracking(text) to anon, authenticated;
