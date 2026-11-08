import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { storage } from "@/lib/services/storage";
import { serverEnv } from "@/lib/env";

/**
 * Deployment readiness probe.
 *
 * Answers three questions an operator actually needs before pointing traffic at a
 * new environment:
 *   1. does the database answer, and does its schema match what the app expects?
 *   2. is storage reachable and configured for this driver?
 *   3. is any required secret missing?
 *
 * It reports configuration *presence*, never values, and stays public so a load
 * balancer or uptime monitor can call it. Only aggregate counts are returned — no
 * tenant names, emails or order data.
 */
export const dynamic = "force-dynamic";

interface Check {
  status: "ok" | "warn" | "fail";
  detail: string;
}

export async function GET() {
  const checks: Record<string, Check> = {};
  let healthy = true;

  // ---- configuration -----------------------------------------------------
  const missing: string[] = [];
  if (!process.env.DATABASE_URL && !process.env.DATABASE_PGLITE_DIR) missing.push("DATABASE_URL");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (process.env.STORAGE_DRIVER === "supabase") {
    if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!process.env.NEXT_PUBLIC_SUPABASE_STORAGE_URL) missing.push("NEXT_PUBLIC_SUPABASE_STORAGE_URL");
  }
  checks.config = missing.length
    ? { status: "fail", detail: `missing ${missing.join(", ")}` }
    : { status: "ok", detail: "required variables present" };
  if (missing.length) healthy = false;

  // ---- database + schema -------------------------------------------------
  let engine = "unknown";
  try {
    const db = await getDb();
    engine = db.engine;

    const res = await db.query<{ result: { ok: boolean; missing: string[]; detail: Record<string, unknown> } }>(
      "select public.mp_check_schema() as result",
    );
    const schema = res.rows[0]?.result;
    if (!schema) {
      checks.database = { status: "fail", detail: "schema check returned nothing" };
      healthy = false;
    } else if (!schema.ok) {
      checks.database = { status: "fail", detail: `schema incomplete: ${schema.missing.join(", ")}` };
      healthy = false;
    } else {
      const disabled = (schema.detail.rls_disabled as string[] | undefined) ?? [];
      checks.database = {
        status: disabled.length ? "warn" : "ok",
        detail: disabled.length
          ? `connected; RLS disabled on ${disabled.join(", ")}`
          : `connected; schema complete; ${schema.detail.tenants ?? 0} tenant(s)`,
      };
      if (disabled.length) healthy = false;
    }
  } catch (error) {
    checks.database = {
      status: "fail",
      detail: error instanceof Error ? `unreachable: ${error.name}` : "unreachable",
    };
    healthy = false;
  }

  // ---- storage -----------------------------------------------------------
  const service = storage();
  if (service.driver === "supabase") {
    try {
      const res = await fetch(`${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/bucket`, {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const buckets = (await res.json()) as { name: string }[];
      const names = buckets.map((b) => b.name);
      const absent = ["menu", "branding"].filter((b) => !names.includes(b));
      checks.storage = absent.length
        ? { status: "fail", detail: `supabase reachable; missing bucket(s): ${absent.join(", ")}` }
        : { status: "ok", detail: "supabase storage reachable; buckets present" };
      if (absent.length) healthy = false;
    } catch {
      checks.storage = { status: "fail", detail: "supabase storage unreachable or key rejected" };
      healthy = false;
    }
  } else {
    checks.storage = { status: "ok", detail: "local driver (objects stored in the database)" };
  }

  // ---- environment -------------------------------------------------------
  checks.environment = {
    status: serverEnv.isProduction && !process.env.APP_URL ? "warn" : "ok",
    detail: `${process.env.NODE_ENV ?? "development"}${process.env.APP_URL ? ` · ${process.env.APP_URL}` : ""}`,
  };

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      engine,
      driver: service.driver,
      at: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
