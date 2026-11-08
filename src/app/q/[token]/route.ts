import { NextResponse } from "next/server";
import { getMenuForQrToken } from "@/lib/services/orders";

/**
 * QR entry point: /q/<secure-token>
 *
 * The token is validated against the database (active, not revoked, table active,
 * restaurant active). Only then do we forward the guest to the menu with the table
 * context attached. An invalid token never reveals whether the restaurant exists.
 *
 * The redirect is absolute and built from the *public* origin rather than the
 * request origin. Behind a preview proxy or a reverse proxy the request origin is
 * the container's own binding (`http://localhost:3000`), and a relative
 * `redirect()` inherits exactly that — which hands the diner's phone a link it
 * cannot open. Origin resolution order:
 *
 *   1. `x-forwarded-proto` + `x-forwarded-host`, when a proxy sets them
 *   2. `APP_URL` — the configured public base
 *   3. the request's own host, as a last resort for plain local development
 */
export const dynamic = "force-dynamic";

function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost && forwardedProto) return `${forwardedProto}://${forwardedHost}`;

  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured && !configured.includes("localhost")) return configured;

  // Use the configured value when it is all we have; otherwise fall back to the
  // host the browser actually asked for.
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const origin = publicOrigin(request);
  const { token } = await params;
  const menu = await getMenuForQrToken(token);

  if (!menu) return NextResponse.redirect(`${origin}/q/invalid`, 307);
  return NextResponse.redirect(
    `${origin}/menu/${menu.restaurant.slug}?t=${encodeURIComponent(token)}`,
    307,
  );
}
