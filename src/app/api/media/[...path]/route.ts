import { NextResponse } from "next/server";
import { mediaUrl } from "@/lib/media";
import { storage, type Bucket } from "@/lib/services/storage";

/**
 * Serves stored media.
 *
 * Menu artwork and branding are public by design (they appear on the guest menu),
 * so this route is cacheable and unauthenticated.
 *
 * With the Supabase driver the bytes live in a public Storage bucket, so we answer
 * with a permanent redirect to the CDN object. That keeps every URL previously
 * printed, cached or embedded resolving — including QR sheets and emails — while
 * the service_role key stays server-side.
 */
const PUBLIC_BUCKETS: Bucket[] = ["menu", "branding"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const bucket = segments[0] as Bucket | undefined;
  const objectPath = segments.slice(1).join("/");

  if (!bucket || !PUBLIC_BUCKETS.includes(bucket) || !objectPath) {
    return new NextResponse("Not found", { status: 404 });
  }
  // Reject traversal attempts outright.
  if (objectPath.includes("..") || objectPath.startsWith("/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const service = storage();
  if (service.driver === "supabase") {
    const cdn = mediaUrl(bucket, objectPath);
    if (!cdn) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(cdn, 308);
  }

  try {
    const object = await service.get(bucket, objectPath);
    if (!object) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(new Uint8Array(object.data), {
      headers: {
        "content-type": object.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    console.error("[media] read failed", error);
    return new NextResponse("Unavailable", { status: 503 });
  }
}
