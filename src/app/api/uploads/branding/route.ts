import { NextResponse } from "next/server";
import { asAuthed, getTenantContext } from "@/lib/auth/server";
import {
  MAX_UPLOAD_BYTES,
  detectImageType,
  extensionFor,
  replaceObject,
  storage,
  validateImageUpload,
} from "@/lib/services/storage";

/**
 * Branding upload (logo / cover).
 *
 * The storage path is derived from the session's tenant, and the database update is
 * performed through the user's RLS identity, so a manager of restaurant A cannot
 * write to restaurant B's branding or settings row.
 *
 * The previous file is deleted after the new one is live, so the guest menu never
 * shows a broken logo during a swap.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });
  if (tenant.role !== "owner" && tenant.role !== "manager") {
    return NextResponse.json({ ok: false, error: "Only owners and managers can change branding." }, { status: 403 });
  }

  const kind = new URL(request.url).searchParams.get("kind") === "logo" ? "logo" : "cover";

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose an image." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, error: "Images must be 5 MB or smaller." }, { status: 413 });

  const validation = validateImageUpload({ type: file.type, size: file.size });
  if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 422 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(bytes)) {
    return NextResponse.json({ ok: false, error: "That file is not a valid image." }, { status: 422 });
  }

  // A logo stays transparent (PNG); covers are photographic and get flattened.
  let sanitized: Buffer;
  let contentType: "image/png" | "image/jpeg";
  try {
    const sharp = (await import("sharp")).default;
    const pipeline = sharp(bytes, { failOn: "error" }).rotate();
    if (kind === "logo") {
      sanitized = await pipeline
        .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      contentType = "image/png";
    } else {
      sanitized = await pipeline
        .resize({ width: 2000, height: 1200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      contentType = "image/jpeg";
    }
  } catch {
    return NextResponse.json({ ok: false, error: "That image could not be read. Try a different file." }, { status: 422 });
  }

  const column = kind === "logo" ? "logo_path" : "cover_path";
  const current = await asAuthed(tenant.user, (tx) =>
    tx.query<{ logo_path: string | null; cover_path: string | null }>(
      "select logo_path, cover_path from restaurants where id = $1",
      [tenant.restaurantId],
    ),
  );
  const previousPath = current.rows[0]?.[column] ?? null;

  const path = `${tenant.restaurantId}/${kind}/${kind}-${Date.now().toString(36)}.${extensionFor(contentType)}`;

  try {
    await replaceObject(
      { bucket: "branding", path, data: sanitized, contentType, restaurantId: tenant.restaurantId },
      previousPath,
      async () => {
        await asAuthed(tenant.user, (tx) =>
          tx.query(`update restaurants set ${column} = $2 where id = $1`, [tenant.restaurantId, path]),
        );
      },
    );
    return NextResponse.json({ ok: true, path, url: storage().url("branding", path) });
  } catch (error) {
    console.error("[upload] branding failed", error);
    return NextResponse.json({ ok: false, error: "The upload failed. Please try again." }, { status: 503 });
  }
}
