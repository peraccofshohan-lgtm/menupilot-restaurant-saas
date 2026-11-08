import path from "node:path";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Database, Queryable } from "@/lib/db/types";
import { hashPassword } from "@/lib/auth/password";
import { storage } from "@/lib/services/storage";
import { DEMO_MENU, DEMO_RESTAURANT, DEMO_TABLE_COUNT } from "./menu-data";
import { BANGLA_CATEGORIES, BANGLA_MENU, BANGLA_RESTAURANT } from "./menu-bangla";

/**
 * Idempotent demo seed.
 *
 * Creates ONE demo tenant (MATI Kitchen) with 50 dishes, 20 QR tables, a small
 * customer book and four weeks of realistic order history so the dashboard,
 * analytics and kitchen screens show meaningful data.
 *
 * Safety properties:
 *  - The demo tenant is a normal tenant: newly registered restaurants get nothing
 *    from it, because every row carries its own restaurant_id.
 *  - Demo credentials are NEVER stored in the repository. The owner account is
 *    created with a password generated at seed time and written only to the local
 *    `.data/demo-credentials.txt` file (git-ignored), or supplied via
 *    DEMO_OWNER_PASSWORD.
 */
export interface SeedResult {
  restaurantId: string;
  slug: string;
  categories: number;
  items: number;
  missingPhotos?: string[];
  tables: number;
  orders: number;
  credentialsFile?: string;
  ownerEmail: string;
  adminEmail: string;
  generatedPassword?: string;
}

const IMAGE_DIR = path.join(process.cwd(), "public", "seed-images");

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function isSeeded(db: Database): Promise<boolean> {
  const res = await db.query<{ count: string }>(
    "select count(*)::text as count from public.restaurants where is_demo = true",
  );
  return Number(res.rows[0]?.count ?? 0) > 0;
}

/**
 * Creates (or repairs) a demo account.
 *
 * The identity row lives in `auth.users`; the scrypt hash lives in
 * `public.user_credentials` so seeding behaves the same on a self-managed
 * Postgres and on a Supabase project whose auth schema belongs to GoTrue.
 */
async function upsertDemoUser(
  q: Queryable,
  input: { email: string; passwordHash: string; fullName: string; phone?: string | null },
): Promise<string> {
  const existing = await q.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [
    input.email,
  ]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const created = await q.query<{ id: string }>(
      "insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id",
      [input.email],
    );
    userId = created.rows[0]!.id;
  }

  await q.query(
    `insert into public.user_credentials (user_id, password_hash, full_name, phone)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update
       set password_hash = excluded.password_hash,
           full_name = excluded.full_name,
           phone = excluded.phone,
           updated_at = now()`,
    [userId, input.passwordHash, input.fullName, input.phone ?? null],
  );
  await q.query(
    `insert into public.profiles (id, full_name, phone) values ($1, $2, $3)
     on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone`,
    [userId, input.fullName, input.phone ?? null],
  );
  return userId;
}

export async function seedDemo(options: { reset?: boolean } = {}): Promise<SeedResult> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();

  if (options.reset) {
    await db.query("delete from public.restaurants where is_demo = true");
  }
  if (await isSeeded(db)) {
    const existing = await db.query<{ id: string; slug: string }>(
      "select id, slug from public.restaurants where is_demo = true limit 1",
    );
    const row = existing.rows[0]!;
    const counts = await db.query<{ items: string; tables: string; orders: string }>(
      `select
         (select count(*) from public.menu_items where restaurant_id = $1)::text as items,
         (select count(*) from public.dining_tables where restaurant_id = $1)::text as tables,
         (select count(*) from public.orders where restaurant_id = $1)::text as orders`,
      [row.id],
    );
    const c = counts.rows[0]!;
    return {
      restaurantId: row.id,
      slug: row.slug,
      categories: 0,
      items: Number(c.items),
      tables: Number(c.tables),
      orders: Number(c.orders),
      ownerEmail: "owner@mati.demo",
      adminEmail: process.env.PLATFORM_ADMIN_EMAIL || "admin@menupilot.demo",
    };
  }

  const rand = mulberry32(20261108);

  // Read every demo photograph once, before the transaction, so the write phase
  // is a single short transaction instead of one durable commit per row.
  const imageCache = new Map<string, Buffer>();

  /** Reads one asset, remembering a miss so it is reported rather than retried. */
  const missingAssets = new Set<string>();
  async function loadAsset(relative: string): Promise<Buffer | null> {
    if (imageCache.has(relative)) return imageCache.get(relative)!;
    if (missingAssets.has(relative)) return null;
    try {
      const buffer = await readFile(path.join(IMAGE_DIR, relative));
      imageCache.set(relative, buffer);
      return buffer;
    } catch {
      missingAssets.add(relative);
      return null;
    }
  }

  // One photograph per dish. Every item names its own file; nothing is shared.
  for (const category of DEMO_MENU) {
    for (const item of category.items) {
      await loadAsset(path.join("menu", `${item.photo}.webp`));
    }
  }
  // Branding is optional and separate from the dish photography.
  await loadAsset("logo-mati.png");
  await loadAsset("cover-mati.jpg");
  for (const n of ["logo-mati.png", "cover-mati.jpg"]) {
    try {
      imageCache.set(n, await readFile(path.join(IMAGE_DIR, n)));
    } catch {
      /* optional branding asset */
    }
  }

  return db.transaction(async (tx) => {
  const q = tx;

  // ---- Demo owner ---------------------------------------------------------
  const ownerEmail = process.env.DEMO_OWNER_EMAIL || "owner@mati.demo";
  const generatedPassword =
    process.env.DEMO_OWNER_PASSWORD ||
    `Mati-${randomBytes(6).toString("base64url")}${Math.floor(rand() * 90 + 10)}`;
  const ownerPasswordHash = await hashPassword(generatedPassword);

  const ownerId = await upsertDemoUser(q, {
    email: ownerEmail,
    passwordHash: ownerPasswordHash,
    fullName: "MATI Kitchen Owner",
    phone: "+8801700000000",
  });

  // ---- Restaurant ---------------------------------------------------------
  const rest = await q.query<{ id: string }>(
    `insert into public.restaurants
       (name, slug, tagline, description, phone, email, address, city, currency, time_zone,
        status, is_demo, created_by, tagline_bn, description_bn, address_bn)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', true, $11, $12, $13, $14)
     returning id`,
    [
      DEMO_RESTAURANT.name,
      DEMO_RESTAURANT.slug,
      DEMO_RESTAURANT.tagline,
      DEMO_RESTAURANT.description,
      DEMO_RESTAURANT.phone,
      DEMO_RESTAURANT.email,
      DEMO_RESTAURANT.address,
      DEMO_RESTAURANT.city,
      DEMO_RESTAURANT.currency,
      DEMO_RESTAURANT.timeZone,
      BANGLA_RESTAURANT.tagline,
      BANGLA_RESTAURANT.description,
      BANGLA_RESTAURANT.address,
      ownerId,
    ],
  );
  const restaurantId = rest.rows[0]!.id;

  await q.query(
    `insert into public.restaurant_settings
       (restaurant_id, tax_rate, tax_label, service_charge_rate, service_charge_label,
        accept_orders, order_prefix, operating_hours, receipt_note)
     values ($1, $2, $3, $4, $5, true, $6, $7, $8)`,
    [
      restaurantId,
      DEMO_RESTAURANT.taxRate,
      DEMO_RESTAURANT.taxLabel,
      DEMO_RESTAURANT.serviceChargeRate,
      DEMO_RESTAURANT.serviceChargeLabel,
      DEMO_RESTAURANT.orderPrefix,
      JSON.stringify({
        mon: { open: "11:30", close: "23:00" },
        tue: { open: "11:30", close: "23:00" },
        wed: { open: "11:30", close: "23:00" },
        thu: { open: "11:30", close: "23:00" },
        fri: { open: "11:30", close: "23:30" },
        sat: { open: "11:30", close: "23:30" },
        sun: { open: "12:00", close: "22:30" },
      }),
      "Prices are inclusive of applicable VAT. Payment at the counter.",
    ],
  );

  await q.query(
    "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'owner')",
    [restaurantId, ownerId],
  );

  // ---- Branding images ----------------------------------------------------
  async function uploadSeedImage(file: string, bucket: "menu" | "branding", dir: string) {
    const data = imageCache.get(file);
    if (!data) return null;
    const ext = file.split(".").pop()?.toLowerCase() ?? "jpg";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const target = `${restaurantId}/${dir}/${file}`;
    await storage().put({ bucket, path: target, data, contentType, restaurantId }, q);
    return target;
  }

  const logoPath = await uploadSeedImage("logo-mati.png", "branding", "logo");
  const coverPath = await uploadSeedImage("cover-mati.jpg", "branding", "cover");
  if (logoPath || coverPath) {
    await q.query("update public.restaurants set logo_path = $2, cover_path = $3 where id = $1", [
      restaurantId,
      logoPath,
      coverPath,
    ]);
  }

  // ---- Categories & items -------------------------------------------------
  const missingPhotos: string[] = [];
  const categoryIds = new Map<string, string>();
  const itemRows: { id: string; price: number; category: string; name: string }[] = [];

  for (const [catIndex, category] of DEMO_MENU.entries()) {
    const inserted = await q.query<{ id: string }>(
      `insert into public.categories
         (restaurant_id, name, description, sort_order, is_active, name_bn, description_bn)
       values ($1, $2, $3, $4, true, $5, $6) returning id`,
      [
        restaurantId,
        category.name,
        category.description,
        catIndex,
        BANGLA_CATEGORIES[category.name]?.name ?? null,
        BANGLA_CATEGORIES[category.name]?.description ?? null,
      ],
    );
    const categoryId = inserted.rows[0]!.id;
    categoryIds.set(category.key, categoryId);

    for (const [itemIndex, item] of category.items.entries()) {
      // The dish's own photograph, named after the dish. If it is not present the
      // item is seeded with no image at all — never another dish's, because a wrong
      // picture is worse for a menu than a clean fallback.
      const photoPath = await uploadSeedImage(
        path.join("menu", `${item.photo}.webp`),
        "menu",
        "menu",
      );
      const imagePath = photoPath;
      if (!photoPath) missingPhotos.push(item.name);

      const row = await q.query<{ id: string }>(
        `insert into public.menu_items
           (restaurant_id, category_id, name, slug, description, price, image_path,
            is_available, is_featured, sort_order, prep_minutes, name_bn, description_bn)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning id`,
        [
          restaurantId,
          categoryId,
          item.name,
          slugify(item.name),
          item.description,
          item.price,
          imagePath,
          !item.unavailable,
          Boolean(item.featured),
          itemIndex,
          item.prep ?? 15,
          BANGLA_MENU[item.name]?.name ?? null,
          BANGLA_MENU[item.name]?.description ?? null,
        ],
      );
      const itemId = row.rows[0]!.id;
      itemRows.push({ id: itemId, price: item.price, category: category.key, name: item.name });
      if (imagePath) {
        await q.query(
          `insert into public.menu_item_images (restaurant_id, menu_item_id, storage_path, sort_order)
           values ($1, $2, $3, 0)`,
          [restaurantId, itemId, imagePath],
        );
      }
    }
  }

  // ---- 20 tables + QR tokens ---------------------------------------------
  const tables: { id: string; label: string; token: string }[] = [];
  for (let i = 1; i <= DEMO_TABLE_COUNT; i += 1) {
    const label = `Table ${String(i).padStart(2, "0")}`;
    const zone = i <= 8 ? "Ground floor" : i <= 14 ? "Mezzanine" : "Terrace";
    const tableRes = await q.query<{ id: string }>(
      `insert into public.dining_tables (restaurant_id, label, zone, seats, sort_order)
       values ($1, $2, $3, $4, $5) returning id`,
      [restaurantId, label, zone, i % 3 === 0 ? 6 : i % 2 === 0 ? 2 : 4, i],
    );
    const tableId = tableRes.rows[0]!.id;
    const token = randomBytes(24).toString("hex");
    await q.query(
      `insert into public.qr_tokens (restaurant_id, table_id, token, token_sha256)
       values ($1, $2, $3, public.mp_sha256($3))`,
      [restaurantId, tableId, token],
    );
    tables.push({ id: tableId, label, token });
  }

  // ---- Customers ----------------------------------------------------------
  const customerSeed = [
    { name: "Nusrat Jahan", phone: "+8801711000011" },
    { name: "Arif Hossain", phone: "+8801711000022" },
    { name: "Sadia Islam", phone: "+8801711000033" },
    { name: "Tanvir Ahmed", phone: "+8801711000044" },
    { name: "Farhana Rahman", phone: "+8801711000055" },
    { name: "Rifat Chowdhury", phone: "+8801711000066" },
    { name: "Mehedi Hasan", phone: "+8801711000077" },
    { name: "Ayesha Karim", phone: "+8801711000088" },
  ];
  const customerIds: string[] = [];
  for (const c of customerSeed) {
    const res = await q.query<{ id: string }>(
      `insert into public.customers (restaurant_id, name, phone, first_order_at, last_order_at)
       values ($1, $2, $3, now(), now()) returning id`,
      [restaurantId, c.name, c.phone],
    );
    customerIds.push(res.rows[0]!.id);
  }

  // ---- Order history ------------------------------------------------------
  const notesPool = [
    null,
    null,
    null,
    "Less oil, please.",
    "One portion extra spicy.",
    "No chilli on the kids' plate.",
    "Please serve the drinks first.",
    "Allergy note: no peanuts.",
  ];
  const itemNotesPool = [null, null, null, "Extra gravy on the side", "No onion", "Well done"];

  let orderCount = 0;
  const totalDays = 28;

  for (let dayOffset = totalDays; dayOffset >= 0; dayOffset -= 1) {
    const isToday = dayOffset === 0;
    // Weekends are busier.
    const weekday = new Date(Date.now() - dayOffset * 86_400_000).getDay();
    const weekendBoost = weekday === 5 || weekday === 6 ? 5 : 0;
    const ordersForDay = isToday ? 6 : Math.floor(rand() * 7) + 6 + weekendBoost;

    for (let o = 0; o < ordersForDay; o += 1) {
      const minutesAgo = isToday
        ? Math.floor(rand() * 300) + 10
        : dayOffset * 1440 - Math.floor(rand() * 480) - 120;
      const createdAt = new Date(Date.now() - minutesAgo * 60_000);

      const lineCount = Math.floor(rand() * 3) + 1;
      const chosen: { id: string; name: string; price: number; qty: number; note: string | null }[] = [];
      const used = new Set<string>();
      for (let l = 0; l < lineCount; l += 1) {
        const candidate = itemRows[Math.floor(rand() * itemRows.length)]!;
        if (used.has(candidate.id)) continue;
        used.add(candidate.id);
        chosen.push({
          id: candidate.id,
          name: candidate.name,
          price: candidate.price,
          qty: Math.floor(rand() * 3) + 1,
          note: itemNotesPool[Math.floor(rand() * itemNotesPool.length)] ?? null,
        });
      }
      if (chosen.length === 0) continue;

      const subtotal = chosen.reduce((sum, c) => sum + c.price * c.qty, 0);
      const service = Math.round(subtotal * 0.05 * 100) / 100;
      const tax = Math.round(subtotal * 0.05 * 100) / 100;
      const total = subtotal + service + tax;
      const itemCount = chosen.reduce((sum, c) => sum + c.qty, 0);

      // Realistic status distribution: most served, a few rejected/cancelled.
      let status: string;
      const roll = rand();
      if (isToday) {
        status = roll < 0.2 ? "pending" : roll < 0.4 ? "accepted" : roll < 0.6 ? "preparing" : roll < 0.75 ? "ready" : "served";
      } else if (roll < 0.035) {
        status = "rejected";
      } else if (roll < 0.06) {
        status = "cancelled";
      } else if (roll < 0.1 && dayOffset <= 1) {
        status = "ready";
      } else {
        status = "served";
      }

      const table = tables[Math.floor(rand() * tables.length)]!;
      const customerPick = rand();
      const withCustomer = customerPick < 0.55;
      const customerId = withCustomer ? customerIds[Math.floor(rand() * customerIds.length)]! : null;
      const customerName = withCustomer
        ? customerSeed[customerIds.indexOf(customerId!)]?.name ?? null
        : rand() < 0.4
          ? "Walk-in guest"
          : null;
      const customerPhone = withCustomer
        ? customerSeed[customerIds.indexOf(customerId!)]?.phone ?? null
        : null;

      const orderNumber = `MATI-${createdAt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(1000 + orderCount)}`;
      const tracking = randomBytes(24).toString("hex");

      const acceptedAt = ["accepted", "preparing", "ready", "served"].includes(status)
        ? new Date(createdAt.getTime() + 90_000)
        : null;
      const preparingAt = ["preparing", "ready", "served"].includes(status)
        ? new Date(createdAt.getTime() + 240_000)
        : null;
      const readyAt = ["ready", "served"].includes(status)
        ? new Date(createdAt.getTime() + 900_000)
        : null;
      const servedAt = status === "served" ? new Date(createdAt.getTime() + 1_500_000) : null;
      const rejectedAt = status === "rejected" ? new Date(createdAt.getTime() + 120_000) : null;
      const cancelledAt = status === "cancelled" ? new Date(createdAt.getTime() + 300_000) : null;

      const orderRes = await q.query<{ id: string }>(
        `insert into public.orders
           (restaurant_id, table_id, customer_id, order_number, status, subtotal, tax_amount,
            service_charge, total, currency, item_count, customer_name, customer_phone, note,
            source, tracking_token, accepted_at, preparing_at, ready_at, served_at,
            rejected_at, cancelled_at, rejection_reason, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'qr',$15,
                 $16,$17,$18,$19,$20,$21,$22,$23,$23)
         returning id`,
        [
          restaurantId,
          table.id,
          customerId,
          orderNumber,
          status,
          subtotal,
          tax,
          service,
          total,
          DEMO_RESTAURANT.currency,
          itemCount,
          customerName,
          customerPhone,
          notesPool[Math.floor(rand() * notesPool.length)] ?? null,
          tracking,
          acceptedAt,
          preparingAt,
          readyAt,
          servedAt,
          rejectedAt,
          cancelledAt,
          status === "rejected" ? "Table requested a change and placed a new order." : null,
          createdAt,
        ],
      );
      const orderId = orderRes.rows[0]!.id;

      for (const [index, line] of chosen.entries()) {
        await q.query(
          `insert into public.order_items
             (order_id, restaurant_id, menu_item_id, name_snapshot, unit_price, quantity,
              line_total, note, sort_order, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderId,
            restaurantId,
            line.id,
            line.name,
            line.price,
            line.qty,
            line.price * line.qty,
            line.note,
            index,
            createdAt,
          ],
        );
      }

      const history: { from: string | null; to: string; at: Date }[] = [
        { from: null, to: "pending", at: createdAt },
      ];
      if (acceptedAt) history.push({ from: "pending", to: "accepted", at: acceptedAt });
      if (preparingAt) history.push({ from: "accepted", to: "preparing", at: preparingAt });
      if (readyAt) history.push({ from: "preparing", to: "ready", at: readyAt });
      if (servedAt) history.push({ from: "ready", to: "served", at: servedAt });
      if (rejectedAt) history.push({ from: "pending", to: "rejected", at: rejectedAt });
      if (cancelledAt) history.push({ from: "pending", to: "cancelled", at: cancelledAt });

      for (const h of history) {
        await q.query(
          `insert into public.order_status_history
             (order_id, restaurant_id, from_status, to_status, actor_role, created_at)
           values ($1,$2,$3,$4,$5,$6)`,
          [orderId, restaurantId, h.from, h.to, h.from === null ? "customer" : "owner", h.at],
        );
      }

      if (customerId && ["ready", "served"].includes(status)) {
        await q.query(
          `update public.customers set
             total_orders = total_orders + 1,
             total_spend = total_spend + $2,
             last_order_at = greatest(coalesce(last_order_at, $3), $3),
             first_order_at = least(coalesce(first_order_at, $3), $3)
           where id = $1`,
          [customerId, total, createdAt],
        );
      }

      orderCount += 1;
    }
  }

  // ---- Platform administrator (operations console) -----------------------
  // Scoped to this installation only, never to a restaurant, and its password is
  // generated at seed time exactly like the demo owner's.
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || "admin@menupilot.demo";
  const adminId = await upsertDemoUser(q, {
    email: adminEmail,
    passwordHash: ownerPasswordHash,
    fullName: "Platform Operator",
  });
  await q.query("insert into public.platform_admins (user_id) values ($1) on conflict do nothing", [adminId]);

  // ---- A kitchen staff + manager account so role demoing is possible ------
  const kitchenEmail = process.env.DEMO_KITCHEN_EMAIL || "kitchen@mati.demo";
  const kitchenPassword = process.env.DEMO_KITCHEN_PASSWORD || generatedPassword;
  const kitchenHash = await hashPassword(kitchenPassword);
  const kitchenId = await upsertDemoUser(q, {
    email: kitchenEmail,
    passwordHash: kitchenHash,
    fullName: "Rakib (Kitchen)",
  });
  await q.query(
    "insert into public.restaurant_members (restaurant_id, user_id, role) values ($1, $2, 'kitchen')",
    [restaurantId, kitchenId],
  );

  return {
    restaurantId,
    slug: DEMO_RESTAURANT.slug,
    categories: DEMO_MENU.length,
    items: itemRows.length,
    /** Dishes whose photograph was not present, so a gap is never silent. */
    missingPhotos,
    tables: tables.length,
    orders: orderCount,
    ownerEmail,
    adminEmail,
    generatedPassword:
      process.env.DEMO_OWNER_PASSWORD || process.env.DEMO_KITCHEN_PASSWORD ? undefined : generatedPassword,
  };
  });
}
