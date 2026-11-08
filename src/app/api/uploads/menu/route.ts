import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth/server";
import { asAuthed } from "@/lib/auth/server";
import { MAX_UPLOAD_BYTES, slugifyFilename, storage, validateImageUpload } from "@/lib/services/storage";
import { setItemImage } from "@/lib/services/menu";

/**
 * Menu image upload.
 *
 * Authorization is resolved from the session (owner/manager of the active tenant).
 * The restaurant id in the storage path comes from that context — never the form —
 * so a client cannot write into another tenant's folder.
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
  // Verify the bytes actually are an image the browser declared, not a renamed file.
  const signature = bytes.subarray(0, 12);
  const isJpeg = signature[0] === 0xff && signature[1] === 0xd8;
  const isPng = signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47;
  const isWebp = signature.subarray(0, 4).toString("ascii") === "RIFF" && signature.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isJpeg && !isPng && !isWebp) {
    return NextResponse.json({ ok: false, error: "That file is not a valid JPEG, PNG or WebP image." }, { status: 422 });
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const filename = `${slugifyFilename(file.name)}-${Date.now().toString(36)}.${extension}`;
  const path = `${tenant.restaurantId}/menu/${filename}`;

  try {
    await storage().put({
      bucket: "menu",
      path,
      data: bytes,
      contentType: file.type,
      restaurantId: tenant.restaurantId,
    });

    if (itemId) {
      const linked = await setItemImage(tenant.user, tenant.restaurantId, itemId, path);
      if (!linked.ok) {
        return NextResponse.json({ ok: true, path, url: storage().url("menu", path), warning: "Image stored but not linked to a dish." });
      }
    }

    return NextResponse.json({ ok: true, path, url: storage().url("menu", path) });
  } catch (error) {
    console.error("[upload] menu image failed", error);
    return NextResponse.json({ ok: false, error: "The upload failed. Please try again." }, { status: 503 });
  }
}
