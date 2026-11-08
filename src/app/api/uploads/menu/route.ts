import { NextResponse } from "next/server";
import { asAuthed, getTenantContext } from "@/lib/auth/server";
import {
  MAX_UPLOAD_BYTES,
  detectImageType,
  extensionFor,
  replaceObject,
  slugifyFilename,
  storage,
  validateImageUpload,
} from "@/lib/services/storage";
import { setItemImage } from "@/lib/services/menu";

/**
 * Menu image upload.
 *
 * Authorization is resolved from the session (owner/manager of the active tenant).
 * The restaurant id in the storage path comes from that context — never the form —
 * so a client cannot write into another tenant's folder.
 *
 * Validation is layered: declared MIME + size, then the real file signature, then
 * a pixel-decode with sharp, then a re-encode that strips EXIF. Only the sanitized
 * bytes are stored, so an uploaded file can never carry an embedded payload.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tenant = await getTenantContext();
  if (!tenant) return NextResponse.json({ ok: false, error: "Your session has expired." }, { status: 401 });
  if (tenant.role !== "owner" && tenant.role !== "manager") {
    return NextResponse.json({ ok: false, error: "Only owners and managers can upload menu images." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed upload." }, { status: 400 });
  }

  const file = form.get("file");
  const itemId = String(form.get("itemId") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "Images must be 5 MB or smaller." }, { status: 413 });
  }

  const validation = validateImageUpload({ type: file.type, size: file.size });
  if (validation) return NextResponse.json({ ok: false, error: validation }, { status: 422 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const declared = detectImageType(bytes);
  if (!declared) {
    return NextResponse.json({ ok: false, error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 });
  }

  // Decode and re-encode: proves the file is a real image and drops metadata.
  let sanitized: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    sanitized = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return NextResponse.json({ ok: false, error: "That image could not be read. Try a different file." }, { status: 422 });
  }

  // The dish's current image is replaced, not stacked: the old object is deleted
  // only after the new one is stored and the row is updated.
  const current = await asAuthed(tenant.user, (tx) =>
    tx.query<{ image_path: string | null }>("select image_path from menu_items where id = $1 and restaurant_id = $2", [
      itemId || "00000000-0000-0000-0000-000000000000",
      tenant.restaurantId,
    ]),
  );
  const previousPath = current.rows[0]?.image_path ?? null;

  const path = `${tenant.restaurantId}/menu/${slugifyFilename(file.name)}-${Date.now().toString(36)}.${extensionFor("image/jpeg")}`;

  try {
    await replaceObject(
      { bucket: "menu", path, data: sanitized, contentType: "image/jpeg", restaurantId: tenant.restaurantId },
      previousPath,
      async () => {
        if (!itemId) return;
        const linked = await setItemImage(tenant.user, tenant.restaurantId, itemId, path);
        if (!linked.ok) throw new Error("MP:ITEM_IMAGE_NOT_LINKED");
      },
    );

    return NextResponse.json({ ok: true, path, url: storage().url("menu", path) });
  } catch (error) {
    if (error instanceof Error && error.message === "MP:ITEM_IMAGE_NOT_LINKED") {
      return NextResponse.json(
        { ok: true, path, url: storage().url("menu", path), warning: "Image stored but not linked to a dish." },
        { status: 200 },
      );
    }
    console.error("[upload] menu image failed", error);
    return NextResponse.json({ ok: false, error: "The upload failed. Please try again." }, { status: 503 });
  }
}
