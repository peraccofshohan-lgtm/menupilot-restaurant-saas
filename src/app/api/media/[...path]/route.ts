import { NextResponse } from "next/server";
import { storage, type Bucket } from "@/lib/services/storage";

/**
 * Serves stored media.
 *
 * Menu artwork and branding are public by design (they appear on the guest menu),
 * so this route is cacheable and unauthenticated. Everything else in storage lives
 * in buckets that are only ever read by authorized server code.
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

  try {
    const object = await storage().get(bucket, objectPath);
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
