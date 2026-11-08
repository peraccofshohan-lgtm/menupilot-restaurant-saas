
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function flag(name: string): boolean {
  return (process.env[name] ?? "").toLowerCase() === "true";
}

export const serverEnv = {
  get sessionSecret(): string {
    return process.env.SESSION_SECRET || required("SESSION_SECRET");
  },
  get appUrl(): string {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get storageDriver(): "local" | "supabase" {
    return process.env.STORAGE_DRIVER === "supabase" ? "supabase" : "local";
  },

  /**
   * Supabase project settings. Only the public anon key may ever reach the
   * browser; `serviceRoleKey` is read exclusively by server modules.
   */
  get supabase() {
    const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
    return {
      url,
      anonKey: process.env.SUPABASE_ANON_KEY ?? "",
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      configured: Boolean(url && process.env.SUPABASE_ANON_KEY),
    };
  },

  /** Realtime is opt-in: when off (or unconfigured) the UI keeps polling. */
  get realtimeEnabled(): boolean {
    const explicit = process.env.NEXT_PUBLIC_REALTIME_ENABLED;
    if (explicit !== undefined) return flag("NEXT_PUBLIC_REALTIME_ENABLED");
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  },

  /**
   * Email delivery. `null` means "no provider configured" — callers must record
   * the message as not sent rather than claiming it was delivered.
   */
  get email(): { provider: "resend"; apiKey: string; from: string } | null {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) return null;
    return { provider: "resend", apiKey, from };
  },
};

export type ServerEnv = typeof serverEnv;
