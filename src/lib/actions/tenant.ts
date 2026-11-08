"use server";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { asAuthed, getCurrentUser, RESTAURANT_COOKIE } from "@/lib/auth/server";
import { makeSlug, Validator, isUuid } from "@/lib/validation";
import { formToObject, type ActionState } from "./types";

/* ==========================================================================
   Tenant lifecycle: onboarding, settings, tables, QR codes, staff.
   Every mutation re-resolves the caller's membership server-side; a browser
   can never nominate its own restaurant id.
   ========================================================================== */

async function requireOwnerOf(restaurantId: string, roles: string[] = ["owner", "manager"]) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "Your session has expired. Sign in again." };
  const role = await asAuthed(user, async (tx) => {
    const res = await tx.query<{ role: string }>("select public.mp_role($1) as role", [restaurantId]);
    return res.rows[0]?.role ?? null;
  });
  if (!role || !roles.includes(role)) {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  return { ok: true as const, user, role };
}

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SGD", "MYR"] as const;
const TIME_ZONES = [
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;

export async function createWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Your session has expired. Sign in again." };

  const input = formToObject(formData);
  const v = new Validator(input);
  const name = v.string("name", { min: 2, max: 120, label: "Restaurant name" });
  const rawSlug = String(input.slug ?? "").trim();
  const slug = v.slug("slug", { min: 3, max: 60, label: "Menu link" });
  const phone = v.phone("phone", { required: true });
  const email = v.email("email", { required: false });
  const address = v.string("address", { required: false, max: 200, label: "Address" });
  const city = v.string("city", { required: false, max: 80, label: "City" });
  const tagline = v.string("tagline", { required: false, max: 160, label: "Tagline" });
  const description = v.string("description", { required: false, max: 1200, label: "Description" });
  const currency = v.oneOf("currency", CURRENCIES, "BDT");
  const timeZone = v.oneOf("time_zone", TIME_ZONES, "Asia/Dhaka");
  const tableCount = v.integer("table_count", { min: 1, max: 60, fallback: 10, label: "Tables" });
  const taxRate = v.money("tax_rate", { required: false, min: 0, max: 100, label: "Tax rate" });
  const serviceRate = v.money("service_charge_rate", { required: false, min: 0, max: 100, label: "Service charge" });

  if (!slug) v.fail("slug", "Choose a menu link.");
  if (rawSlug && makeSlug(rawSlug) !== rawSlug) v.fail("slug", "Use lowercase letters, numbers and single dashes only.");
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  const db = await getDb();
  const taken = await db.query<{ id: string }>("select id from public.restaurants where lower(slug) = lower($1)", [slug]);
  if (taken.rows.length > 0) {
    return { status: "error", errors: { slug: "That menu link is already in use. Try another." } };
  }

  try {
    const restaurantId = await db.transaction(async (tx) => {
      const rest = await tx.query<{ id: string }>(
        `insert into public.restaurants
           (name, slug, tagline, description, phone, email, address, city, currency, time_zone, status, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
         returning id`,
        [
          name,
          slug,
          tagline || null,
          description || null,
          phone,
          email || null,
          address || null,
          city || null,
          currency,
          timeZone,
          user.id,
        ],
      );
      const id = rest.rows[0]!.id;

      await tx.query(
        `insert into public.restaurant_settings
           (restaurant_id, tax_rate, tax_label, service_charge_rate, service_charge_label, accept_orders, order_prefix)
         values ($1, $2, $3, $4, $5, true, $6)`,
        [
          id,
          taxRate,
          currency === "BDT" ? "VAT" : "Tax",
          serviceRate,
          "Service charge",
          makeSlug(name).toUpperCase().replace(/-/g, "").slice(0, 4) || "MP",
        ],
      );

      await tx.query(
        "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'owner')",
        [id, user.id],
      );

      // Starter categories so the menu screen is never an empty void.
      const starters = [
        { name: "Starters", description: "Small plates to open the meal." },
        { name: "Mains", description: "The dishes you are known for." },
        { name: "Drinks", description: "Hot, cold and everything between." },
        { name: "Desserts", description: "The last impression." },
      ];
      for (const [index, category] of starters.entries()) {
        await tx.query(
          "insert into public.categories (restaurant_id, name, description, sort_order, is_active) values ($1, $2, $3, $4, true)",
          [id, category.name, category.description, index],
        );
      }

      // Tables + cryptographically random QR tokens.
      for (let i = 1; i <= tableCount; i += 1) {
        const label = `Table ${String(i).padStart(2, "0")}`;
        const table = await tx.query<{ id: string }>(
          "insert into public.dining_tables (restaurant_id, label, seats, sort_order) values ($1, $2, 4, $3) returning id",
          [id, label, i],
        );
        const token = randomBytes(24).toString("hex");
        await tx.query(
          `insert into public.qr_tokens (restaurant_id, table_id, token, token_sha256)
           values ($1, $2, $3, public.mp_sha256($3))`,
          [id, table.rows[0]!.id, token],
        );
      }

      await tx.query(
        `insert into public.audit_logs (restaurant_id, actor_user_id, action, entity, entity_id, metadata)
         values ($1, $2, 'restaurant.created', 'restaurant', $1, $3)`,
        [id, user.id, JSON.stringify({ name, slug, tables: tableCount })],
      );

      return id;
    });

    const store = await cookies();
    store.set(RESTAURANT_COOKIE, restaurantId, { httpOnly: true, sameSite: "lax", path: "/" });

    return { status: "success", redirectTo: `/onboarding/complete?r=${restaurantId}` };
  } catch (error) {
    console.error("[tenant] workspace creation failed", error);
    return { status: "error", message: "We could not create your restaurant workspace. Please try again." };
  }
}

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = formToObject(formData);
  const restaurantId = String(input.restaurant_id ?? "");
  if (!isUuid(restaurantId)) return { status: "error", message: "Unknown restaurant." };
  const guard = await requireOwnerOf(restaurantId);
  if (!guard.ok) return { status: "error", message: guard.error };

  const v = new Validator(input);
  const name = v.string("name", { min: 2, max: 120, label: "Restaurant name" });
  const tagline = v.string("tagline", { required: false, max: 160, label: "Tagline" });
  const description = v.string("description", { required: false, max: 1200, label: "Description" });
  const phone = v.phone("phone", { required: false });
  const email = v.email("email", { required: false });
  const address = v.string("address", { required: false, max: 200, label: "Address" });
  const city = v.string("city", { required: false, max: 80, label: "City" });
  const currency = v.oneOf("currency", CURRENCIES, "BDT");
  const timeZone = v.oneOf("time_zone", TIME_ZONES, "Asia/Dhaka");
  const taxRate = v.money("tax_rate", { required: false, min: 0, max: 100, label: "Tax rate" });
  const taxLabel = v.string("tax_label", { required: false, max: 24, label: "Tax label" });
  const serviceRate = v.money("service_charge_rate", { required: false, min: 0, max: 100, label: "Service charge" });
  const serviceLabel = v.string("service_charge_label", { required: false, max: 32, label: "Service charge label" });
  const orderPrefix = v.string("order_prefix", { required: false, max: 4, label: "Order prefix", pattern: /^[A-Za-z0-9]{0,4}$/ });
  const receiptNote = v.string("receipt_note", { required: false, max: 200, label: "Receipt note" });
  const acceptOrders = v.boolean("accept_orders");
  const autoAccept = v.boolean("auto_accept_orders");
  const requireName = v.boolean("require_customer_name");
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  // Operating hours arrive as one open/close pair per weekday.
  const hours: Record<string, { open: string; close: string } | null> = {};
  for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
    const open = String(input[`hours_${day}_open`] ?? "").trim();
    const close = String(input[`hours_${day}_close`] ?? "").trim();
    if (open && close && /^\d{2}:\d{2}$/.test(open) && /^\d{2}:\d{2}$/.test(close)) {
      hours[day] = { open, close };
    } else {
      hours[day] = null;
    }
  }

  try {
    return await asAuthed(guard.user, async (tx) => {
      await tx.query(
        `update public.restaurants set
           name = $2, tagline = $3, description = $4, phone = $5, email = $6,
           address = $7, city = $8, currency = $9, time_zone = $10
         where id = $1`,
        [
          restaurantId,
          name,
          tagline || null,
          description || null,
          phone || null,
          email || null,
          address || null,
          city || null,
          currency,
          timeZone,
        ],
      );
      await tx.query(
        `insert into public.restaurant_settings
           (restaurant_id, tax_rate, tax_label, service_charge_rate, service_charge_label,
            accept_orders, auto_accept_orders, require_customer_name, order_prefix, operating_hours, receipt_note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (restaurant_id) do update set
           tax_rate = excluded.tax_rate,
           tax_label = excluded.tax_label,
           service_charge_rate = excluded.service_charge_rate,
           service_charge_label = excluded.service_charge_label,
           accept_orders = excluded.accept_orders,
           auto_accept_orders = excluded.auto_accept_orders,
           require_customer_name = excluded.require_customer_name,
           order_prefix = excluded.order_prefix,
           operating_hours = excluded.operating_hours,
           receipt_note = excluded.receipt_note`,
        [
          restaurantId,
          taxRate,
          taxLabel || "Tax",
          serviceRate,
          serviceLabel || "Service charge",
          acceptOrders,
          autoAccept,
          requireName,
          (orderPrefix || "MP").toUpperCase(),
          JSON.stringify(hours),
          receiptNote || null,
        ],
      );
      await tx.query(
        `insert into public.audit_logs (restaurant_id, actor_user_id, action, entity, entity_id)
         values ($1, $2, 'settings.updated', 'restaurant_settings', $1)`,
        [restaurantId, guard.user.id],
      );
      return { status: "success" as const, message: "Settings saved." };
    });
  } catch (error) {
    console.error("[tenant] settings save failed", error);
    return { status: "error", message: "Could not save settings. Please try again." };
  }
}

export async function createTableAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = formToObject(formData);
  const restaurantId = String(input.restaurant_id ?? "");
  if (!isUuid(restaurantId)) return { status: "error", message: "Unknown restaurant." };
  const guard = await requireOwnerOf(restaurantId);
  if (!guard.ok) return { status: "error", message: guard.error };

  const v = new Validator(input);
  const label = v.string("label", { min: 1, max: 40, label: "Table label" });
  const zone = v.string("zone", { required: false, max: 40, label: "Zone" });
  const seats = v.integer("seats", { min: 1, max: 40, fallback: 4, label: "Seats" });
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  try {
    return await asAuthed(guard.user, async (tx) => {
      const dup = await tx.query<{ id: string }>(
        "select id from dining_tables where restaurant_id = $1 and lower(btrim(label)) = lower(btrim($2))",
        [restaurantId, label],
      );
      if (dup.rows.length > 0) return { status: "error" as const, errors: { label: "A table with that label exists." } };

      const table = await tx.query<{ id: string }>(
        `insert into public.dining_tables (restaurant_id, label, zone, seats,
           sort_order)
         values ($1, $2, $3, $4,
           coalesce((select max(sort_order) + 1 from public.dining_tables where restaurant_id = $1), 1))
         returning id`,
        [restaurantId, label, zone || null, seats],
      );
      const token = randomBytes(24).toString("hex");
      await tx.query(
        `insert into public.qr_tokens (restaurant_id, table_id, token, token_sha256)
         values ($1, $2, $3, public.mp_sha256($3))`,
        [restaurantId, table.rows[0]!.id, token],
      );
      return { status: "success" as const, message: `${label} added with a fresh QR code.` };
    });
  } catch (error) {
    console.error("[tenant] table creation failed", error);
    return { status: "error", message: "Could not add the table." };
  }
}

export async function toggleTableAction(restaurantId: string, tableId: string, isActive: boolean): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(tableId)) return { status: "error", message: "Unknown table." };
  return asAuthed(guard.user, async (tx) => {
    await tx.query("update dining_tables set is_active = $3 where id = $1 and restaurant_id = $2", [
      tableId,
      restaurantId,
      isActive,
    ]);
    // A deactivated table's QR must stop working immediately.
    await tx.query(
      `update qr_tokens set is_active = $2, revoked_at = case when $2 then null else now() end
        where table_id = $1 and restaurant_id = $3`,
      [tableId, isActive, restaurantId],
    );
    return { status: "success" as const, message: isActive ? "Table reactivated." : "Table deactivated. Its QR no longer works." };
  });
}

export async function regenerateQrAction(restaurantId: string, tableId: string): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(tableId)) return { status: "error", message: "Unknown table." };
  return asAuthed(guard.user, async (tx) => {
    await tx.query(
      `update qr_tokens set is_active = false, revoked_at = now(), rotated_at = now()
        where table_id = $1 and restaurant_id = $2 and is_active`,
      [tableId, restaurantId],
    );
    const token = randomBytes(24).toString("hex");
    await tx.query(
      `insert into qr_tokens (restaurant_id, table_id, token, token_sha256, rotated_at)
       values ($1, $2, $3, public.mp_sha256($3), now())`,
      [restaurantId, tableId, token],
    );
    return { status: "success" as const, message: "New QR code generated. Reprint and replace the old one." };
  });
}

export async function deleteTableAction(restaurantId: string, tableId: string): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(tableId)) return { status: "error", message: "Unknown table." };
  return asAuthed(guard.user, async (tx) => {
    const open = await tx.query<{ count: string }>(
      "select count(*)::text as count from orders where table_id = $1 and status in ('pending','accepted','preparing','ready')",
      [tableId],
    );
    if (Number(open.rows[0]?.count ?? 0) > 0) {
      return { status: "error" as const, message: "This table has open orders. Close them before deleting it." };
    }
    await tx.query("delete from dining_tables where id = $1 and restaurant_id = $2", [tableId, restaurantId]);
    return { status: "success" as const, message: "Table removed." };
  });
}

const STAFF_ROLES = ["manager", "kitchen", "waiter"] as const;

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const input = formToObject(formData);
  const restaurantId = String(input.restaurant_id ?? "");
  if (!isUuid(restaurantId)) return { status: "error", message: "Unknown restaurant." };
  const guard = await requireOwnerOf(restaurantId, ["owner"]);
  if (!guard.ok) return { status: "error", message: guard.error };

  const v = new Validator(input);
  const email = v.email("email");
  const role = v.oneOf("role", STAFF_ROLES, "kitchen");
  if (!v.result(null).ok) return { status: "error", errors: v.fieldErrors };

  const db = await getDb();
  try {
    const token = randomBytes(24).toString("hex");
    const { createHash } = await import("node:crypto");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Already a member? Update the role instead of stacking duplicate invites.
    const existing = await db.query<{ id: string | null }>(
      "select public.member_id_by_email($1, $2) as id",
      [restaurantId, email],
    );
    if (existing.rows[0]?.id) {
      await db.query("update public.restaurant_members set role = $2, is_active = true where id = $1", [
        existing.rows[0].id,
        role,
      ]);
      return { status: "success", message: "Existing team member updated to the new role." };
    }

    const pending = await db.query<{ id: string }>(
      `select id from public.staff_invitations
        where restaurant_id = $1 and lower(email) = $2 and status = 'pending'`,
      [restaurantId, email],
    );
    if (pending.rows[0]) {
      await db.query("update public.staff_invitations set role = $2, expires_at = now() + interval '7 days' where id = $1", [
        pending.rows[0].id,
        role,
      ]);
    } else {
      await db.query(
        `insert into public.staff_invitations (restaurant_id, email, role, token_hash, invited_by)
         values ($1, $2, $3, $4, $5)`,
        [restaurantId, email, role, tokenHash, guard.user.id],
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.info(`[staff] invite link (dev): /register?invite=${token}`);
    }
    return {
      status: "success",
      message: `Invitation ready for ${email}. They can create an account with this email and will join as ${role}.`,
    };
  } catch (error) {
    console.error("[tenant] invite failed", error);
    return { status: "error", message: "Could not create the invitation." };
  }
}

export async function updateMemberRoleAction(restaurantId: string, memberId: string, role: string): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId, ["owner"]);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(memberId) || !["manager", "kitchen", "waiter"].includes(role)) {
    return { status: "error", message: "Invalid request." };
  }
  return asAuthed(guard.user, async (tx) => {
    const target = await tx.query<{ role: string; user_id: string }>(
      "select role, user_id from restaurant_members where id = $1 and restaurant_id = $2",
      [memberId, restaurantId],
    );
    const row = target.rows[0];
    if (!row) return { status: "error" as const, message: "Team member not found." };
    if (row.role === "owner") return { status: "error" as const, message: "The owner's role cannot be changed." };
    await tx.query("update restaurant_members set role = $2 where id = $1", [memberId, role]);
    return { status: "success" as const, message: "Role updated." };
  });
}

export async function removeMemberAction(restaurantId: string, memberId: string): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId, ["owner"]);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(memberId)) return { status: "error", message: "Invalid request." };
  return asAuthed(guard.user, async (tx) => {
    const target = await tx.query<{ role: string; user_id: string }>(
      "select role, user_id from restaurant_members where id = $1 and restaurant_id = $2",
      [memberId, restaurantId],
    );
    const row = target.rows[0];
    if (!row) return { status: "error" as const, message: "Team member not found." };
    if (row.role === "owner") return { status: "error" as const, message: "You cannot remove the owner." };
    if (row.user_id === guard.user.id) return { status: "error" as const, message: "You cannot remove yourself." };
    await tx.query("delete from restaurant_members where id = $1 and restaurant_id = $2", [memberId, restaurantId]);
    return { status: "success" as const, message: "Access removed." };
  });
}

export async function revokeInvitationAction(restaurantId: string, invitationId: string): Promise<ActionState> {
  const guard = await requireOwnerOf(restaurantId, ["owner"]);
  if (!guard.ok) return { status: "error", message: guard.error };
  if (!isUuid(invitationId)) return { status: "error", message: "Invalid request." };
  return asAuthed(guard.user, async (tx) => {
    await tx.query(
      "update staff_invitations set status = 'revoked' where id = $1 and restaurant_id = $2 and status = 'pending'",
      [invitationId, restaurantId],
    );
    return { status: "success" as const, message: "Invitation revoked." };
  });
}
