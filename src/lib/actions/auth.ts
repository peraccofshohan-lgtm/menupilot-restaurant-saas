"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { asAuthed, getMemberships, RESTAURANT_COOKIE } from "@/lib/auth/server";
import { AuthError, SESSION_COOKIE, signIn, signUp, getSessionUser } from "@/lib/auth/session";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { Validator } from "@/lib/validation";
import { formToObject, type ActionState } from "./types";
import { emailDeliveryConfigured, passwordResetEmail, sendEmail } from "@/lib/services/email";
import { serverEnv } from "@/lib/env";

/**
 * Authentication server actions.
 * These are the only places that write session cookies, and every one of them
 * re-validates input on the server regardless of what the form sent.
 */

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = formToObject(formData);
  const v = new Validator(input);
  const fullName = v.string("full_name", { min: 2, max: 80, label: "Full name" });
  const email = v.email("email");
  const password = String(input.password ?? "");
  const confirm = String(input.confirm_password ?? "");

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) v.fail("password", policy.message ?? "Choose a stronger password.");
  if (password !== confirm) v.fail("confirm_password", "Passwords do not match.");
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  try {
    const { user, token, expiresAt } = await signUp({ email, password, fullName });

    // If the invite lands them in an existing restaurant, they skip onboarding.
    await acceptPendingInvitation(user.id, user.email, String(input.invite ?? "") || undefined);

    const memberships = await getMemberships(user);
    const store = await cookies();
    if (memberships[0]?.restaurant_id) {
      store.set(RESTAURANT_COOKIE, memberships[0].restaurant_id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
    await setSessionOnCookies(token, expiresAt);

    return {
      status: "success",
      redirectTo: memberships.length > 0 ? "/dashboard" : "/onboarding",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "EMAIL_TAKEN") return { status: "error", errors: { email: error.message } };
      return { status: "error", message: error.message };
    }
    console.error("[auth] registration failed", error);
    return { status: "error", message: "We could not create the account. Please try again." };
  }
}

async function setSessionOnCookies(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Claims a pending staff invitation matching the new account's email. */
async function acceptPendingInvitation(userId: string, email: string, inviteToken?: string): Promise<void> {
  const db = await getDb();
  const { createHash } = await import("node:crypto");
  const tokenHash = inviteToken ? createHash("sha256").update(inviteToken).digest("hex") : null;
  const invites = await db.query<{ id: string; restaurant_id: string; role: string }>(
    tokenHash
      ? `select id, restaurant_id, role from public.staff_invitations
          where lower(email) = lower($1) and status = 'pending' and expires_at > now() and token_hash = $2`
      : `select id, restaurant_id, role from public.staff_invitations
          where lower(email) = lower($1) and status = 'pending' and expires_at > now()`,
    tokenHash ? [email, tokenHash] : [email],
  );
  for (const invite of invites.rows) {
    await db.query(
      `insert into public.restaurant_members (restaurant_id, user_id, role)
       values ($1, $2, $3) on conflict (restaurant_id, user_id) do update set role = excluded.role, is_active = true`,
      [invite.restaurant_id, userId, invite.role],
    );
    await db.query("update public.staff_invitations set status = 'accepted', accepted_at = now() where id = $1", [
      invite.id,
    ]);
  }
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = formToObject(formData);
  const email = String(input.email ?? "").trim();
  const password = String(input.password ?? "");
  const next = String(input.next ?? "");

  if (!email || !password) {
    return { status: "error", errors: { email: !email ? "Enter your email." : "", password: !password ? "Enter your password." : "" } };
  }

  try {
    const { user, token, expiresAt } = await signIn(email, password);
    await setSessionOnCookies(token, expiresAt);
    const memberships = await getMemberships(user);
    const isAdmin = await asAuthed(user, async (tx) => {
      const res = await tx.query<{ ok: boolean }>("select public.mp_is_platform_admin() as ok");
      return Boolean(res.rows[0]?.ok);
    });
    if (memberships[0]) {
      const store = await cookies();
      store.set(RESTAURANT_COOKIE, memberships[0].restaurant_id, { httpOnly: true, sameSite: "lax", path: "/" });
    }
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : null;
    return {
      status: "success",
      redirectTo: safeNext ?? (memberships.length > 0 ? "/dashboard" : isAdmin ? "/platform" : "/onboarding"),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: "error", message: error.message };
    }
    console.error("[auth] login failed", error);
    return { status: "error", message: "Sign-in is unavailable right now. Please try again." };
  }
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const { destroySession } = await import("@/lib/auth/session");
    await destroySession(token);
  }
  store.delete(SESSION_COOKIE);
  store.delete(RESTAURANT_COOKIE);
  redirect("/login");
}

export async function switchRestaurantAction(restaurantId: string): Promise<ActionState> {
  const store = await cookies();
  const user = await getSessionUser(store.get(SESSION_COOKIE)?.value);
  if (!user) return { status: "error", message: "Your session has expired." };
  const memberships = await getMemberships(user);
  if (!memberships.some((m) => m.restaurant_id === restaurantId)) {
    return { status: "error", message: "You do not have access to that restaurant." };
  }
  store.set(RESTAURANT_COOKIE, restaurantId, { httpOnly: true, sameSite: "lax", path: "/" });
  return { status: "success", redirectTo: "/dashboard" };
}

/**
 * Password reset.
 *
 * A real deployment sends this link by email through Supabase Auth. Without an
 * outbound mail provider configured, the token is stored hashed and surfaced
 * through an owner-only admin view — never in a public response, and the
 * response to the requester is always identical so accounts cannot be probed.
 */
export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    return { status: "error", errors: { email: "Enter a valid email address." } };
  }

  const db = await getDb();
  const user = await db.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  const row = user.rows[0];
  if (row) {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = await hashResetToken(token);
    await db.query(
      `insert into public.password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '60 minutes')`,
      [row.id, tokenHash],
    );
    // The link is emailed and the attempt is recorded. The response below is
    // deliberately identical whether or not the account exists, so addresses
    // cannot be probed; `deliveryConfigured` only describes the installation.
    const template = passwordResetEmail({
      resetUrl: `${serverEnv.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
      minutes: 60,
    });
    await sendEmail({ ...template, to: email, kind: "password_reset" });
  }
  return {
    status: "success",
    message: emailDeliveryConfigured()
      ? "If an account exists for that address, a reset link has been sent."
      : "If an account exists for that address, a reset link has been created. Email delivery is not configured on this installation, so contact your administrator for the link.",
  };
}

async function hashResetToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  const v = new Validator({});
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) v.fail("password", policy.message ?? "Choose a stronger password.");
  if (password !== confirm) v.fail("confirm_password", "Passwords do not match.");
  if (!token) v.fail("token", "This reset link is incomplete.");
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  const db = await getDb();
  const tokenHash = await hashResetToken(token);
  const res = await db.query<{ user_id: string }>(
    `update public.password_reset_tokens set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [tokenHash],
  );
  const row = res.rows[0];
  if (!row) {
    return { status: "error", message: "This reset link has expired or was already used. Request a new one." };
  }
  const passwordHash = await hashPassword(password);
  await db.query(
    `insert into public.user_credentials (user_id, password_hash)
     values ($1, $2)
     on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
    [row.user_id, passwordHash],
  );
  // Any other device signed in as this user is signed out by the reset.
  await db.query("delete from public.app_sessions where user_id = $1", [row.user_id]);
  return { status: "success", message: "Your password has been changed. You can sign in now." };
}
