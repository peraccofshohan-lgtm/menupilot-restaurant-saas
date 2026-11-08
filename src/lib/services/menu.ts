import { asAuthed, type AppUser, type TenantRole } from "@/lib/auth/server";
import type { Queryable } from "@/lib/db/types";
import { makeSlug, Validator, isUuid } from "@/lib/validation";

/* ==========================================================================
   Menu + category service
   All mutations run as the signed-in user, so RLS re-checks tenant membership
   even if the UI is compromised. The restaurant id comes from the server-resolved
   tenant context, never from the request body.
   ========================================================================== */

export interface Category {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  item_count: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  image_path: string | null;
  is_available: boolean;
  is_featured: boolean;
  is_archived: boolean;
  sort_order: number;
  prep_minutes: number;
}

export interface MenuData {
  categories: Category[];
  items: MenuItem[];
}

export async function getMenu(user: AppUser, restaurantId: string): Promise<MenuData> {
  return asAuthed(user, async (tx) => {
    const categories = await tx.query<Category>(
      `select c.id, c.name, c.description, c.sort_order, c.is_active,
              (select count(*) from menu_items mi
                where mi.category_id = c.id and not mi.is_archived)::int as item_count
         from categories c
        where c.restaurant_id = $1
        order by c.sort_order, c.name`,
      [restaurantId],
    );
    const items = await tx.query<MenuItem>(
      `select mi.id, mi.category_id, c.name as category_name, mi.name, mi.slug,
              mi.description, mi.price, mi.image_path, mi.is_available, mi.is_featured,
              mi.is_archived, mi.sort_order, mi.prep_minutes
         from menu_items mi
         join categories c on c.id = mi.category_id
        where mi.restaurant_id = $1
        order by c.sort_order, mi.sort_order, mi.name`,
      [restaurantId],
    );
    return { categories: categories.rows, items: items.rows };
  });
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; error?: undefined }
  | { ok: false; errors: Record<string, string>; data?: undefined };

export async function createCategory(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  input: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  const v = new Validator(input);
  const name = v.string("name", { min: 1, max: 80, label: "Category name" });
  const description = v.string("description", { required: false, max: 400, label: "Description" });
  const sortOrder = v.integer("sort_order", { min: 0, max: 9999, fallback: 0, label: "Display order" });
  if (!v.result(null).ok) return { ok: false, errors: v.fieldErrors };

  return asAuthed(user, async (tx) => {
    const dup = await tx.query<{ id: string }>(
      "select id from categories where restaurant_id = $1 and lower(btrim(name)) = lower(btrim($2))",
      [restaurantId, name],
    );
    if (dup.rows.length > 0)
      return { ok: false as const, errors: { name: "A category with this name already exists." } as Record<string, string> };

    const res = await tx.query<{ id: string }>(
      `insert into categories (restaurant_id, name, description, sort_order, is_active)
       values ($1, $2, $3, $4, true) returning id`,
      [restaurantId, name, description || null, sortOrder],
    );
    return { ok: true as const, data: { id: res.rows[0]!.id } };
  });
}

export async function updateCategory(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  categoryId: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  if (!isUuid(categoryId)) return { ok: false, errors: { _: "Unknown category." } };

  const v = new Validator(input);
  const name = v.string("name", { min: 1, max: 80, label: "Category name" });
  const description = v.string("description", { required: false, max: 400, label: "Description" });
  const sortOrder = v.integer("sort_order", { min: 0, max: 9999, fallback: 0, label: "Display order" });
  const isActive = v.boolean("is_active");
  if (!v.result(null).ok) return { ok: false, errors: v.fieldErrors };

  return asAuthed(user, async (tx) => {
    const dup = await tx.query<{ id: string }>(
      `select id from categories
        where restaurant_id = $1 and lower(btrim(name)) = lower(btrim($2)) and id <> $3`,
      [restaurantId, name, categoryId],
    );
    if (dup.rows.length > 0)
      return { ok: false as const, errors: { name: "A category with this name already exists." } as Record<string, string> };

    const res = await tx.query(
      `update categories set name = $3, description = $4, sort_order = $5, is_active = $6
        where id = $1 and restaurant_id = $2`,
      [categoryId, restaurantId, name, description || null, sortOrder, isActive],
    );
    if (res.rowCount === 0) return { ok: false as const, errors: { _: "Category not found." } };
    return { ok: true as const };
  });
}

export async function setCategoryActive(
  user: AppUser,
  restaurantId: string,
  categoryId: string,
  isActive: boolean,
): Promise<ActionResult> {
  return asAuthed(user, async (tx) => {
    await tx.query("update categories set is_active = $3 where id = $1 and restaurant_id = $2", [
      categoryId,
      restaurantId,
      isActive,
    ]);
    return { ok: true as const };
  });
}

export async function deleteCategory(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  categoryId: string,
): Promise<ActionResult> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  if (!isUuid(categoryId)) return { ok: false, errors: { _: "Unknown category." } };

  return asAuthed(user, async (tx) => {
    const count = await tx.query<{ count: string }>(
      "select count(*)::text as count from menu_items where category_id = $1 and restaurant_id = $2 and not is_archived",
      [categoryId, restaurantId],
    );
    const items = Number(count.rows[0]?.count ?? 0);
    if (items > 0) {
      return {
        ok: false as const,
        errors: {
          _: `This category still holds ${items} live dish${items === 1 ? "" : "es"}. Move or archive them first, or archive the category to hide it.`,
        },
      };
    }
    await tx.query("delete from categories where id = $1 and restaurant_id = $2", [categoryId, restaurantId]);
    return { ok: true as const };
  });
}

export async function reorderCategories(
  user: AppUser,
  restaurantId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  return asAuthed(user, async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      if (!isUuid(id)) continue;
      await tx.query("update categories set sort_order = $3 where id = $1 and restaurant_id = $2", [
        id,
        restaurantId,
        index,
      ]);
    }
    return { ok: true as const };
  });
}

const MENU_ITEM_FIELDS = ["name", "category_id", "description", "price", "is_available", "is_featured", "prep_minutes"];

export interface MenuItemInput {
  name: string;
  categoryId: string;
  description: string | null;
  price: number;
  isAvailable: boolean;
  isFeatured: boolean;
  prepMinutes: number;
  imagePath?: string | null;
}

async function assertCategoryBelongsToTenant(tx: Queryable, restaurantId: string, categoryId: string) {
  const res = await tx.query<{ id: string }>("select id from categories where id = $1 and restaurant_id = $2", [
    categoryId,
    restaurantId,
  ]);
  return res.rows.length > 0;
}

export async function createMenuItem(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  input: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  void MENU_ITEM_FIELDS;
  const v = new Validator(input);
  const name = v.string("name", { min: 1, max: 120, label: "Dish name" });
  const categoryId = v.string("category_id", { required: true, label: "Category" });
  const description = v.string("description", { required: false, max: 600, label: "Description" });
  const price = v.money("price", { min: 0, max: 1_000_000, label: "Price" });
  const isAvailable = v.boolean("is_available");
  const isFeatured = v.boolean("is_featured");
  const prepMinutes = v.integer("prep_minutes", { min: 0, max: 240, fallback: 15, label: "Prep time" });
  const imagePath = v.string("image_path", { required: false, max: 300 });
  if (!isUuid(categoryId)) v.fail("category_id", "Select a category.");
  if (!v.result(null).ok) return { ok: false, errors: v.fieldErrors };

  return asAuthed(user, async (tx) => {
    if (!(await assertCategoryBelongsToTenant(tx, restaurantId, categoryId))) {
      return { ok: false as const, errors: { category_id: "Select a category from this restaurant." } as Record<string, string> };
    }
    const slugBase = makeSlug(name);
    const existing = await tx.query<{ slug: string }>(
      "select slug from menu_items where restaurant_id = $1 and slug like $2",
      [restaurantId, `${slugBase}%`],
    );
    let slug = slugBase;
    let suffix = 2;
    const taken = new Set(existing.rows.map((r) => r.slug));
    while (taken.has(slug)) {
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }

    const res = await tx.query<{ id: string }>(
      `insert into menu_items
         (restaurant_id, category_id, name, slug, description, price, image_path,
          is_available, is_featured, sort_order, prep_minutes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
          coalesce((select max(sort_order) + 1 from menu_items where category_id = $2), 0), $10)
       returning id`,
      [restaurantId, categoryId, name, slug, description || null, price, imagePath || null, isAvailable, isFeatured, prepMinutes],
    );
    const itemId = res.rows[0]!.id;
    if (imagePath) {
      await tx.query(
        "insert into menu_item_images (restaurant_id, menu_item_id, storage_path) values ($1, $2, $3)",
        [restaurantId, itemId, imagePath],
      );
    }
    return { ok: true as const, data: { id: itemId } };
  });
}

export async function updateMenuItem(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  itemId: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  if (!isUuid(itemId)) return { ok: false, errors: { _: "Unknown dish." } };

  const v = new Validator(input);
  const name = v.string("name", { min: 1, max: 120, label: "Dish name" });
  const categoryId = v.string("category_id", { required: true, label: "Category" });
  const description = v.string("description", { required: false, max: 600, label: "Description" });
  const price = v.money("price", { min: 0, max: 1_000_000, label: "Price" });
  const isAvailable = v.boolean("is_available");
  const isFeatured = v.boolean("is_featured");
  const prepMinutes = v.integer("prep_minutes", { min: 0, max: 240, fallback: 15, label: "Prep time" });
  const imagePath = v.string("image_path", { required: false, max: 300 });
  if (!isUuid(categoryId)) v.fail("category_id", "Select a category.");
  if (!v.result(null).ok) return { ok: false, errors: v.fieldErrors };

  return asAuthed(user, async (tx) => {
    if (!(await assertCategoryBelongsToTenant(tx, restaurantId, categoryId))) {
      return { ok: false as const, errors: { category_id: "Select a category from this restaurant." } as Record<string, string> };
    }
    const res = await tx.query(
      `update menu_items set
         category_id = $3, name = $4, description = $5, price = $6,
         is_available = $7, is_featured = $8, prep_minutes = $9,
         image_path = coalesce($10, image_path)
       where id = $1 and restaurant_id = $2`,
      [
        itemId,
        restaurantId,
        categoryId,
        name,
        description || null,
        price,
        isAvailable,
        isFeatured,
        prepMinutes,
        imagePath || null,
      ],
    );
    if (res.rowCount === 0) return { ok: false as const, errors: { _: "Dish not found." } };
    return { ok: true as const };
  });
}

export async function setMenuItemAvailability(
  user: AppUser,
  restaurantId: string,
  itemId: string,
  isAvailable: boolean,
): Promise<ActionResult> {
  if (!isUuid(itemId)) return { ok: false, errors: { _: "Unknown dish." } };
  return asAuthed(user, async (tx) => {
    await tx.query("update menu_items set is_available = $3 where id = $1 and restaurant_id = $2", [
      itemId,
      restaurantId,
      isAvailable,
    ]);
    return { ok: true as const };
  });
}

export async function archiveMenuItem(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  itemId: string,
  archived: boolean,
): Promise<ActionResult> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  if (!isUuid(itemId)) return { ok: false, errors: { _: "Unknown dish." } };
  return asAuthed(user, async (tx) => {
    await tx.query("update menu_items set is_archived = $3 where id = $1 and restaurant_id = $2", [
      itemId,
      restaurantId,
      archived,
    ]);
    return { ok: true as const };
  });
}

export async function deleteMenuItem(
  user: AppUser,
  restaurantId: string,
  role: TenantRole,
  itemId: string,
): Promise<ActionResult> {
  if (role !== "owner" && role !== "manager") {
    return { ok: false, errors: { _: "You do not have permission to manage the menu." } };
  }
  if (!isUuid(itemId)) return { ok: false, errors: { _: "Unknown dish." } };
  return asAuthed(user, async (tx) => {
    // Historic orders keep their name/price snapshot, so a hard delete is safe
    // only for dishes that were never ordered. Otherwise we archive.
    const used = await tx.query<{ count: string }>(
      "select count(*)::text as count from order_items where menu_item_id = $1",
      [itemId],
    );
    if (Number(used.rows[0]?.count ?? 0) > 0) {
      await tx.query("update menu_items set is_archived = true, is_available = false where id = $1 and restaurant_id = $2", [
        itemId,
        restaurantId,
      ]);
      return { ok: true as const };
    }
    await tx.query("delete from menu_items where id = $1 and restaurant_id = $2", [itemId, restaurantId]);
    return { ok: true as const };
  });
}

export async function reorderMenuItems(
  user: AppUser,
  restaurantId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  return asAuthed(user, async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      if (!isUuid(id)) continue;
      await tx.query("update menu_items set sort_order = $3 where id = $1 and restaurant_id = $2", [
        id,
        restaurantId,
        index,
      ]);
    }
    return { ok: true as const };
  });
}

export async function setItemImage(
  user: AppUser,
  restaurantId: string,
  itemId: string,
  imagePath: string,
): Promise<ActionResult> {
  if (!isUuid(itemId)) return { ok: false, errors: { _: "Unknown dish." } };
  return asAuthed(user, async (tx) => {
    const res = await tx.query("update menu_items set image_path = $3 where id = $1 and restaurant_id = $2", [
      itemId,
      restaurantId,
      imagePath,
    ]);
    if (res.rowCount === 0) return { ok: false as const, errors: { _: "Dish not found." } };
    await tx.query(
      `insert into menu_item_images (restaurant_id, menu_item_id, storage_path)
       values ($1, $2, $3)`,
      [restaurantId, itemId, imagePath],
    );
    return { ok: true as const };
  });
}
