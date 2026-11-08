import { getDb } from "@/lib/db";
import type { Queryable } from "@/lib/db/types";

/**
 * Storage abstraction.
 *
 * Two drivers, one contract:
 *   - `local`    → objects live in PostgreSQL (`storage_objects`) and are streamed
 *                  through `/api/media/...`. Works offline, in CI and in preview.
 *   - `supabase` → objects live in a Supabase Storage bucket, uploaded with the
 *                  service_role key from trusted server code only.
 *
 * Neither driver ever hands a private object to an anonymous caller: uploaded
 * menu media is public-by-design (it is menu artwork), everything else is served
 * through an authorized route.
 */

export type Bucket = "menu" | "branding";

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

export interface StorageService {
  put(input: PutObjectInput, tx?: Queryable): Promise<string>;
  get(bucket: Bucket, path: string): Promise<StoredObject | null>;
  remove(bucket: Bucket, path: string): Promise<void>;
  /** URL the browser can render. */
  url(bucket: Bucket, path: string | null | undefined): string | null;
}

class LocalStorage implements StorageService {
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

  async remove(bucket: Bucket, path: string): Promise<void> {
    const db = await getDb();
    await db.query("delete from public.storage_objects where bucket = $1 and path = $2", [bucket, path]);
  }

  url(bucket: Bucket, path: string | null | undefined): string | null {
    if (!path) return null;
    return `/api/media/${bucket}/${path.replace(/^\/+/, "")}`;
  }
}

class SupabaseStorage implements StorageService {
  private get baseUrl(): string {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error("SUPABASE_URL is required for the supabase storage driver");
    return url.replace(/\/$/, "");
  }

  private get headers(): Record<string, string> {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the supabase storage driver");
    return { Authorization: `Bearer ${key}`, apikey: key };
  }

  async put(input: PutObjectInput): Promise<string> {
    const target = `${this.baseUrl}/storage/v1/object/${input.bucket}/${input.path}`;
    const res = await fetch(target, {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": input.contentType,
        "x-upsert": "true",
        "cache-control": "public, max-age=31536000, immutable",
      },
      body: new Uint8Array(input.data),
    });
    if (!res.ok) {
      throw new Error(`Supabase storage upload failed (${res.status}): ${await res.text()}`);
    }
    return input.path;
  }

  async get(bucket: Bucket, path: string): Promise<StoredObject | null> {
    const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${path}`, {
      headers: this.headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: Buffer.from(await res.arrayBuffer()),
    };
  }

  async remove(bucket: Bucket, path: string): Promise<void> {
    await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${path}`, {
      method: "DELETE",
      headers: this.headers,
    });
  }

  url(bucket: Bucket, path: string | null | undefined): string | null {
    if (!path) return null;
    const publicBase = process.env.SUPABASE_STORAGE_PUBLIC_URL?.replace(/\/$/, "");
    if (publicBase) return `${publicBase}/${bucket}/${path}`;
    return `/api/media/${bucket}/${path}`;
  }
}

let instance: StorageService | null = null;

export function storage(): StorageService {
  if (!instance) {
    instance = process.env.STORAGE_DRIVER === "supabase" ? new SupabaseStorage() : new LocalStorage();
  }
  return instance;
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
