import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth/server";
import { getTables, buildQrPngDataUrl, buildQrSvg } from "@/lib/services/tables";
import { serverEnv } from "@/lib/env";

/**
 * QR download for a single table.
 *
 * Only owners/managers of the active tenant can read their own table tokens; the
 * lookup is scoped by restaurant_id so guessing a table id reveals nothing.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (tenant.role !== "owner" && tenant.role !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { tableId } = await params;
  const tables = await getTables(tenant.user, tenant.restaurantId);
  const table = tables.find((entry) => entry.id === tableId);
  if (!table || !table.qr_token) {
    return NextResponse.json({ error: "No active QR code for that table." }, { status: 404 });
  }

  const origin = serverEnv.appUrl || new URL(request.url).origin;
  const target = `${origin.replace(/\/$/, "")}/q/${table.qr_token}`;
  const format = new URL(request.url).searchParams.get("format") ?? "png";
  const slug = table.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  if (format === "svg") {
    const svg = await buildQrSvg(target, 512);
    return new NextResponse(svg, {
      headers: {
        "content-type": "image/svg+xml",
        "content-disposition": `inline; filename="menupilot-${slug}.svg"`,
        "cache-control": "no-store",
      },
    });
  }

  const png = await buildQrPngDataUrl(target, 1024);
  const base64 = png.split(",")[1] ?? "";
  return new NextResponse(new Uint8Array(Buffer.from(base64, "base64")), {
    headers: {
      "content-type": "image/png",
      "content-disposition": `attachment; filename="menupilot-${slug}.png"`,
      "cache-control": "no-store",
    },
  });
}
