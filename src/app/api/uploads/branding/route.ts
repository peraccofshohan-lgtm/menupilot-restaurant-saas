import { NextResponse } from "next/server";
import { asAuthed, getTenantContext } from "@/lib/auth/server";
import { MAX_UPLOAD_BYTES, storage, validateImageUpload } from "@/lib/services/storage";

/**
 * Branding upload (logo / cover).
 *
 * The storage path is derived from the session's tenant, and the database update is
 * performed through the user's RLS identity, so a manager of restaurant A cannot
 * write to restaurant B's branding or settings row.
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
  const sig = bytes.subarray(0, 12);
  const ok =
    (sig[0] === 0xff && sig[1] === 0xd8) ||
    (sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47) ||
    (sig.subarray(0, 4).toString("ascii") === "RIFF" && sig.subarray(8, 12).toString("ascii") === "WEBP");
  if (!ok) return NextResponse.json({ ok: false, error: "That file is not a valid image." }, { status: 422 });

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${tenant.restaurantId}/${kind}/${kind}-${Date.now().toString(36)}.${extension}`;

  try {
    await storage().put({ bucket: "branding", path, data: bytes, contentType: file.type, restaurantId: tenant.restaurantId });
    await asAuthed(tenant.user, (tx) =>
      tx.query(
        `update restaurants set ${kind === "logo" ? "logo_path" : "cover_path"} = $2 where id = $1`,
        [tenant.restaurantId, path],
      ),
    );
    return NextResponse.json({ ok: true, path, url: storage().url("branding", path) });
  } catch (error) {
    console.error("[upload] branding failed", error);
    return NextResponse.json({ ok: false, error: "The upload failed. Please try again." }, { status: 503 });
  }
}
