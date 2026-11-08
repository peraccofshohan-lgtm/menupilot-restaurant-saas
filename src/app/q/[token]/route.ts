import { redirect } from "next/navigation";
import { getMenuForQrToken } from "@/lib/services/orders";

/**
 * QR entry point: /q/<secure-token>
 *
 * The token is validated against the database (active, not revoked, table active,
 * restaurant active). Only then do we forward the guest to the menu with the table
 * context attached. An invalid token never reveals whether the restaurant exists.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const menu = await getMenuForQrToken(token);

  if (!menu) redirect("/q/invalid");
  redirect(`/menu/${menu.restaurant.slug}?t=${encodeURIComponent(token)}`);
}
