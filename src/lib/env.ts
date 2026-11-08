
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const serverEnv = {
  get sessionSecret(): string {
    return process.env.SESSION_SECRET || required("SESSION_SECRET");
  },
  get appUrl(): string {
    return process.env.APP_URL || "http://localhost:3000";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get storageDriver(): "local" | "supabase" {
    return process.env.STORAGE_DRIVER === "supabase" ? "supabase" : "local";
  },
};
