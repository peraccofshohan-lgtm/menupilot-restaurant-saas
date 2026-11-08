import { asAuthed, getMemberships, type AppUser } from "./server";

/**
 * Resolves the restaurant id a request is allowed to see, WITHOUT reading cookies.
 * Used by API routes (which cannot rely on the dashboard cookie) so realtime feeds
 * always re-derive tenancy from membership rather than trusting a query parameter.
 */
export async function resolveAuthorizedRestaurant(user: AppUser, requested?: string | null): Promise<string | null> {
  const memberships = await getMemberships(user);
  if (memberships.length === 0) return null;
  if (requested) {
    const match = memberships.find((m) => m.restaurant_id === requested);
    return match?.restaurant_id ?? null;
  }
  return memberships[0]?.restaurant_id ?? null;
}

export async function roleFor(user: AppUser, restaurantId: string): Promise<string | null> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ role: string | null }>("select public.mp_role($1) as role", [restaurantId]);
    return res.rows[0]?.role ?? null;
  });
}
