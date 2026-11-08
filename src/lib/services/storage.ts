import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";
import { mediaUrl, usesCdnMedia, type MediaBucket } from "@/lib/media";

/**
 * Storage abstraction.
 *
 * Two drivers, one contract:
 *   - `local`    → objects live in PostgreSQL (`storage_objects`) and are streamed
 *                  through `/api/media/...`. Works offline, in CI and in preview.
 *   - `supabase` → objects live in Supabase Storage, written with the service_role
 *                  key from trusted server code only.
 *
 * Path layout is identical on both drivers and always tenant-prefixed:
 *   <restaurantId>/menu/<slug>-<stamp>.<ext>
 *   <restaurantId>/logo/logo-<stamp>.<ext>
 *   <restaurantId>/cover/cover-<stamp>.<ext>
 *
 * Because the first path segment is the restaurant id, a bucket policy can pin
 * writes to the caller's own folder (see `scripts/storage-setup.ts`).
 */

export type Bucket = MediaBucket;

export interface PutObjectInput {
  bucket: Bucket;
  path: string;
  data: Buffer;
  contentType: string;
  restaurantId?: string | null;
}

export interface StoredObject {
  contentType: string;
  data: Buffer;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Buckets that exist in the Supabase project, plus the legacy local table. */
export const BUCKETS: Bucket[] = ["menu", "branding"];

export interface StorageService {
  readonly driver: "local" | "supabase";
  put(input: PutObjectInput, tx?: Queryable): Promise<string>;
  get(bucket: Bucket, path: string): Promise<StoredObject | null>;
  /** True when the object exists — used before deleting or replacing. */
  exists(bucket: Bucket, path: string): Promise<boolean>;
  remove(bucket: Bucket, path: string): Promise<void>;
  /** Deletes several objects, ignoring ones that are already gone. */
  removeMany(objects: { bucket: Bucket; path: string }[]): Promise<void>;
  /** URL the browser can render. */
  url(bucket: Bucket, path: string | null | undefined): string | null;
}

/* -------------------------------------------------------------------------- */
/* Local driver: bytes in Postgres                                            */
/* -------------------------------------------------------------------------- */

class LocalStorage implements StorageService {
  readonly driver = "local" as const;

  async put(input: PutObjectInput, tx?: Queryable): Promise<string> {
    const db = tx ?? (await getDb());
    await db.query(
      `insert into public.storage_objects (bucket, path, restaurant_id, mime_type, byte_size, content)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (bucket, path) do update
         set content = excluded.content,
             mime_type = excluded.mime_type,
             byte_size = excluded.byte_size`,
      [input.bucket, input.path, input.restaurantId ?? null, input.contentType, input.data.byteLength, input.data],
    );
    return input.path;
  }

  async get(bucket: Bucket, path: string): Promise<StoredObject | null> {
    const db = await getDb();
    const res = await db.query<{ mime_type: string; content: Buffer }>(
      "select mime_type, content from public.storage_objects where bucket = $1 and path = $2",
      [bucket, path],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { contentType: row.mime_type, data: Buffer.from(row.content) };
  }

  async exists(bucket: Bucket, path: string): Promise<boolean> {
    return (await this.get(bucket, path)) !== null;
  }

  async remove(bucket: Bucket, path: string): Promise<void> {
    const db = await getDb();
    await db.query("delete from public.storage_objects where bucket = $1 and path = $2", [bucket, path]);
  }

  async removeMany(objects: { bucket: Bucket; path: string }[]): Promise<void> {
    if (objects.length === 0) return;
    const db = await getDb();
    for (const object of objects) {
      await db.query("delete from public.storage_objects where bucket = $1 and path = $2", [
        object.bucket,
        object.path,
      ]);
    }
  }

  url(bucket: Bucket, path: string | null | undefined): string | null {
    return mediaUrl(bucket, path);
  }
}

/* -------------------------------------------------------------------------- */
/* Supabase driver: bytes in Storage                                          */
/* -------------------------------------------------------------------------- */

class SupabaseStorage implements StorageService {
  readonly driver = "supabase" as const;

  private get baseUrl(): string {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error("SUPABASE_URL is required for the supabase storage driver");
    return url.replace(/\/+$/, "");
  }

  /** service_role: server-only. Never referenced from a client component. */
  private get headers(): Record<string, string> {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the supabase storage driver");
    return { Authorization: `Bearer ${key}`, apikey: key };
  }

  async put(input: PutObjectInput): Promise<string> {
    const target = `${this.baseUrl}/storage/v1/object/${input.bucket}/${encodeURI(input.path)}`;
    const res = await fetch(target, {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": input.contentType,
        "cache-control": "max-age=31536000",
        "x-upsert": "true",
      },
      body: new Uint8Array(input.data),
    });
    if (!res.ok) {
      // The body can contain the bucket policy that rejected the write, which is
      // useful in logs but must never be returned to the browser verbatim.
      const detail = await res.text().catch(() => "");
      throw new Error(`Supabase storage upload failed (${res.status} ${input.bucket}/${input.path}): ${detail}`);
    }
    return input.path;
  }

  async get(bucket: Bucket, path: string): Promise<StoredObject | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
      headers: this.headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: Buffer.from(await res.arrayBuffer()),
    };
  }

  async exists(bucket: Bucket, path: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/info/${bucket}/${encodeURI(path)}`, {
      headers: this.headers,
      cache: "no-store",
    });
    return res.ok;
  }

  async remove(bucket: Bucket, path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { ...this.headers, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Supabase storage delete failed (${res.status} ${bucket}/${path})`);
    }
  }

  async removeMany(objects: { bucket: Bucket; path: string }[]): Promise<void> {
    const byBucket = new Map<Bucket, string[]>();
    for (const object of objects) {
      byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);
    }
    for (const [bucket, paths] of byBucket) {
      const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { ...this.headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Supabase storage bulk delete failed (${res.status} ${bucket})`);
      }
    }
  }

  url(bucket: Bucket, path: string | null | undefined): string | null {
    return mediaUrl(bucket, path);
  }
}

let instance: StorageService | null = null;

export function storage(): StorageService {
  if (!instance) {
    instance = process.env.STORAGE_DRIVER === "supabase" ? new SupabaseStorage() : new LocalStorage();
  }
  return instance;
}

/** True when menu images are served from the Supabase CDN rather than our route. */
export function servesFromCdn(): boolean {
  return usesCdnMedia && storage().driver === "supabase";
}

/**
 * Replaces a stored object and removes the previous file once the new one is in
 * place, so a menu never renders a broken image mid-swap.
 *
 * Deletion happens only after the database has been pointed at the new path —
 * callers pass `commit`, which performs the row update. If the update fails the
 * old object stays and the upload is rolled back by the caller.
 */
export async function replaceObject(
  input: PutObjectInput,
  previousPath: string | null | undefined,
  commit: () => Promise<void>,
): Promise<void> {
  await storage().put(input);
  try {
    await commit();
  } catch (error) {
    // The new object is orphaned; remove it so the bucket does not drift.
    await storage().remove(input.bucket, input.path).catch(() => undefined);
    throw error;
  }
  if (previousPath && previousPath !== input.path) {
    await storage().remove(input.bucket, previousPath).catch((error) => {
      // Orphaned media is cosmetic, never fatal for the user's action.
      console.error("[storage] previous object could not be removed", previousPath, error);
    });
  }
}

/** Validates an upload before any bytes are persisted. */
export function validateImageUpload(file: { type: string; size: number }): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return "Upload a JPEG, PNG or WebP image.";
  }
  if (file.size > MAX_UPLOAD_BYTES) return "Images must be 5 MB or smaller.";
  if (file.size === 0) return "The selected file is empty.";
  return null;
}

/**
 * Confirms the bytes are really an image of the declared type by reading the file
 * signature, so a renamed script or archive is rejected before it is stored.
 */
export function detectImageType(bytes: Buffer): (typeof ALLOWED_IMAGE_TYPES)[number] | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionFor(contentType: string): string {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

export function slugifyFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image"
  );
}
