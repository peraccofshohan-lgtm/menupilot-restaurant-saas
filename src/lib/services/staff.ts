import { asAuthed, type AppUser } from "@/lib/auth/server";

export interface StaffMember {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  order_actions: number;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

export async function getStaff(user: AppUser, restaurantId: string) {
  return asAuthed(user, async (tx) => {
    // Emails live in the locked-down auth schema, so the team list comes from a
    // SECURITY DEFINER function that re-checks membership before returning rows.
    const members = await tx.query<{ directory: StaffMember[] }>(
      "select public.staff_directory($1) as directory",
      [restaurantId],
    );
    const invites = await tx.query<PendingInvitation>(
      `select id, email, role, created_at, expires_at from staff_invitations
        where restaurant_id = $1 and status = 'pending' and expires_at > now()
        order by created_at desc`,
      [restaurantId],
    );
    return { members: members.rows[0]?.directory ?? [], invitations: invites.rows };
  });
}

export interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  total_orders: number;
  total_spend: string;
  last_order_at: string | null;
  first_order_at: string | null;
}

export async function getCustomers(user: AppUser, restaurantId: string, search?: string) {
  return asAuthed(user, async (tx) => {
    const params: unknown[] = [restaurantId];
    let where = "restaurant_id = $1";
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` and (coalesce(name,'') ilike $2 or coalesce(phone,'') ilike $2 or coalesce(email,'') ilike $2)`;
    }
    const res = await tx.query<CustomerRow>(
      `select id, name, phone, email, total_orders, total_spend, last_order_at, first_order_at
         from customers where ${where}
        order by coalesce(last_order_at, created_at) desc
        limit 100`,
      params,
    );
    const totals = await tx.query<{ customers: string; repeat: string; spend: string }>(
      `select count(*)::text as customers,
              count(*) filter (where total_orders > 1)::text as repeat,
              coalesce(sum(total_spend), 0)::text as spend
         from customers where restaurant_id = $1`,
      [restaurantId],
    );
    return {
      customers: res.rows,
      summary: {
        total: Number(totals.rows[0]?.customers ?? 0),
        repeat: Number(totals.rows[0]?.repeat ?? 0),
        spend: totals.rows[0]?.spend ?? "0",
      },
    };
  });
}
