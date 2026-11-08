/**
 * Media URL resolution — isomorphic (safe in client and server components).
 *
 * Two deployment shapes, one API:
 *
 *   local     objects live in the database and are streamed by `/api/media/...`
 *   supabase  objects live in a public Storage bucket and are served by the CDN
 *
 * Only the *public* base URL is ever exposed to the browser; the service_role key
 * stays server-side. In Supabase mode `/api/media/...` still works — it redirects
 * to the CDN — so links already printed, cached or emailed keep resolving.
 */

export type MediaBucket = "menu" | "branding";

const PUBLIC_BASE = (process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

/** True when images should be rendered straight from Supabase Storage. */
export const usesCdnMedia = PUBLIC_BASE.length > 0;

/**
 * URL for a stored object.
 *
 * `path` is the full storage path including the restaurant id
 * (`<restaurantId>/menu/<file>.jpg`), which is what the database stores.
 */
export function mediaUrl(bucket: MediaBucket, path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/^\/+/, "");
  if (!clean) return null;
  return `${PUBLIC_BASE || "/api/media"}/${bucket}/${clean}`;
}
