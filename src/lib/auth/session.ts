import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "./password";

/**
 * Session + identity layer.
 *
 * Contract (identical to what a Supabase Auth integration provides):
 *   signUp → signIn → session cookie → getSession() on every request → signOut
 *
 * Sessions are opaque 256-bit random tokens stored as SHA-256 hashes, so a database
 * leak cannot be replayed as a valid cookie. The cookie is httpOnly, SameSite=Lax,
 * Secure in production. CSRF is handled by SameSite + origin checks on mutations.
 */

export const SESSION_COOKIE = "mp_session";
const SESSION_TTL_DAYS = 30;

export interface AppUser {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
}

export interface AuthResult {
  user: AppUser;
  token: string;
  expiresAt: Date;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function sha256(value: string): string {
  return createHmac("sha256", "menupilot-session").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signUp(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const db = await getDb();

  const existing = await db.query<{ id: string }>(
    "select id from auth.users where lower(email) = $1",
    [email],
  );
  if (existing.rows.length > 0) {
    throw new AuthError("An account with this email already exists.", "EMAIL_TAKEN");
  }

  const passwordHash = await hashPassword(input.password);
  const fullName = input.fullName.trim();
  const phone = input.phone?.trim() || null;

  // `auth.users` is the identity anchor (GoTrue owns it on Supabase); the hash
  // lives in `user_credentials` so this works identically on both engines.
  const created = await db.query<{ id: string; email: string }>(
    `insert into auth.users (email, email_confirmed_at)
     values ($1, now())
     returning id, email`,
    [email],
  );
  const row = created.rows[0];
  if (!row) throw new AuthError("Could not create the account.", "CREATE_FAILED");

  await db.query(
    "insert into public.user_credentials (user_id, password_hash, full_name, phone) values ($1, $2, $3, $4)",
    [row.id, passwordHash, fullName, phone],
  );
  await db.query("insert into public.profiles (id, full_name, phone) values ($1, $2, $3)", [
    row.id,
    fullName,
    phone,
  ]);

  return createSession({ id: row.id, email: row.email, fullName, phone });
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const db = await getDb();
  const res = await db.query<{
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    password_hash: string | null;
  }>(
    `select u.id, u.email, c.full_name, c.phone, c.password_hash
       from auth.users u
       left join public.user_credentials c on c.user_id = u.id
      where lower(u.email) = $1`,
    [normalizeEmail(email)],
  );

  const row = res.rows[0];
  // Always run the KDF so timing does not reveal whether the email exists.
  const stored = row?.password_hash ?? "scrypt$00$00";
  const valid = await verifyPassword(password, stored);
  if (!row || !valid) {
    throw new AuthError("Email or password is incorrect.", "INVALID_CREDENTIALS");
  }

  await db.query("update auth.users set last_sign_in_at = now() where id = $1", [row.id]);
  return createSession({ id: row.id, email: row.email, fullName: row.full_name, phone: row.phone });
}

async function createSession(user: AppUser): Promise<AuthResult> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.query(
    `insert into public.app_sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [user.id, sha256(token), expiresAt],
  );
  return { user, token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<AppUser | null> {
  if (!token || token.length < 20) return null;
  const db = await getDb();
  const res = await db.query<{ id: string; email: string; full_name: string | null; phone: string | null }>(
    `select u.id, u.email, u.full_name, u.phone
       from public.app_sessions s
       join auth.users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)],
  );
  const row = res.rows[0];
  if (!row) return null;
  void db.query("update public.app_sessions set last_used_at = now() where token_hash = $1", [sha256(token)]).catch(
    () => undefined,
  );
  return { id: row.id, email: row.email, fullName: row.full_name, phone: row.phone };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = await getDb();
  await db.query("delete from public.app_sessions where token_hash = $1", [sha256(token)]);
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
