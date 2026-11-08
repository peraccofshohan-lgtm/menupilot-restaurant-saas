import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * On a Supabase-backed deployment this module is replaced by GoTrue (the app calls
 * Supabase Auth and never stores passwords). For the self-hosted/embedded engine
 * we implement the same contract with scrypt — a memory-hard KDF from Node core,
 * so no third-party crypto dependency is introduced.
 *
 * Format: scrypt$<salt-hex>$<hash-hex>
 */
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

/** Shared by client and server so validation messages never diverge. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
  if (password.length > 200) return { ok: false, message: "Password is too long." };
  if (!/[a-zA-Z]/.test(password)) return { ok: false, message: "Include at least one letter." };
  if (!/[0-9]/.test(password)) return { ok: false, message: "Include at least one number." };
  return { ok: true };
}
