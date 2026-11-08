import { getDb } from "@/lib/db";

/**
 * Fixed-window rate limiting backed by PostgreSQL.
 *
 * Uses a single atomic function so concurrent requests cannot race past the limit.
 * Keys are hashed before storage: we never persist raw IP addresses.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(
  scope: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { createHash } = await import("node:crypto");
  const key = `${scope}:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
  try {
    const db = await getDb();
    const res = await db.query<{ result: { allowed: boolean; remaining: number; retry_after?: number } }>(
      "select public.consume_rate_limit($1, $2, $3) as result",
      [key, limit, windowSeconds],
    );
    const row = res.rows[0]?.result;
    if (!row) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    return {
      allowed: row.allowed,
      remaining: row.remaining ?? 0,
      retryAfterSeconds: row.retry_after ?? 0,
    };
  } catch (error) {
    // Never let the limiter take the ordering flow down; log and allow.
    console.error("[rate-limit] unavailable", error);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
