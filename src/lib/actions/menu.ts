"use server";

import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth/server";
import {
  archiveMenuItem,
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  reorderCategories,
  reorderMenuItems,
  setCategoryActive,
  setMenuItemAvailability,
  updateCategory,
  updateMenuItem,
} from "@/lib/services/menu";
import { formToObject, type ActionState } from "./types";

/**
 * Menu server actions.
 * The tenant is resolved from the session on the server; the form never supplies
 * a restaurant id. Every branch re-checks the caller's role inside the service.
 */

async function tenantOrError() {
  const tenant = await getTenantContext();
  if (!tenant) return { ok: false as const, error: "Your session has expired. Sign in again." };
  if (tenant.role !== "owner" && tenant.role !== "manager") {
    return { ok: false as const, error: "Only owners and managers can change the menu." };
  }
  return { ok: true as const, tenant };
}

function refreshMenuSurfaces(slug: string) {
  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard/categories");
  revalidatePath("/dashboard");
  revalidatePath(`/menu/${slug}`);
}

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  const { tenant } = guard;

  const input = formToObject(formData);
  const id = String(input.id ?? "");
  const payload = {
    name: input.name,
    description: input.description ?? "",
    sort_order: input.sort_order ?? "0",
    is_active: input.is_active === "true" || input.is_active === "on" ? "true" : "false",
  };

  const result = id
    ? await updateCategory(tenant.user, tenant.restaurantId, tenant.role, id, payload)
    : await createCategory(tenant.user, tenant.restaurantId, tenant.role, payload);

  if (!result.ok) {
    return { status: "error", errors: result.errors, message: Object.values(result.errors)[0] };
  }
  refreshMenuSurfaces(tenant.restaurantSlug);
  return { status: "success", message: id ? "Category updated." : "Category created." };
}

export async function toggleCategoryAction(categoryId: string, isActive: boolean): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  await setCategoryActive(guard.tenant.user, guard.tenant.restaurantId, categoryId, isActive);
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: isActive ? "Category is visible on your menu." : "Category hidden from guests." };
}

export async function deleteCategoryAction(categoryId: string): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  const result = await deleteCategory(guard.tenant.user, guard.tenant.restaurantId, guard.tenant.role, categoryId);
  if (!result.ok) return { status: "error", message: Object.values(result.errors)[0] };
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: "Category deleted." };
}

export async function reorderCategoriesAction(ids: string[]): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  await reorderCategories(guard.tenant.user, guard.tenant.restaurantId, ids);
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: "Order saved." };
}

export async function saveMenuItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  const { tenant } = guard;

  const input = formToObject(formData);
  const id = String(input.id ?? "");
  const payload = {
    name: input.name,
    category_id: input.category_id,
    description: input.description ?? "",
    price: input.price,
    is_available: input.is_available === "true" || input.is_available === "on" ? "true" : "false",
    is_featured: input.is_featured === "true" || input.is_featured === "on" ? "true" : "false",
    prep_minutes: input.prep_minutes ?? "15",
    image_path: input.image_path ?? "",
  };

  const result = id
    ? await updateMenuItem(tenant.user, tenant.restaurantId, tenant.role, id, payload)
    : await createMenuItem(tenant.user, tenant.restaurantId, tenant.role, payload);

  if (!result.ok) {
    return { status: "error", errors: result.errors, message: Object.values(result.errors)[0] };
  }
  refreshMenuSurfaces(tenant.restaurantSlug);
  return { status: "success", message: id ? "Dish updated." : "Dish added to your menu." };
}

export async function toggleMenuItemAction(itemId: string, isAvailable: boolean): Promise<ActionState> {
  const tenant = await getTenantContext();
  if (!tenant) return { status: "error", message: "Your session has expired." };
  if (tenant.role !== "owner" && tenant.role !== "manager") {
    return { status: "error", message: "Only owners and managers can change availability." };
  }
  await setMenuItemAvailability(tenant.user, tenant.restaurantId, itemId, isAvailable);
  refreshMenuSurfaces(tenant.restaurantSlug);
  return {
    status: "success",
    message: isAvailable ? "Dish is available again." : "Dish marked unavailable — guests can no longer order it.",
  };
}

export async function archiveMenuItemAction(itemId: string, archived: boolean): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  await archiveMenuItem(guard.tenant.user, guard.tenant.restaurantId, guard.tenant.role, itemId, archived);
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: archived ? "Dish archived." : "Dish restored." };
}

export async function deleteMenuItemAction(itemId: string): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  const result = await deleteMenuItem(guard.tenant.user, guard.tenant.restaurantId, guard.tenant.role, itemId);
  if (!result.ok) return { status: "error", message: Object.values(result.errors)[0] };
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: "Dish removed. Past orders keep their own copy of the details." };
}

export async function reorderMenuItemsAction(ids: string[]): Promise<ActionState> {
  const guard = await tenantOrError();
  if (!guard.ok) return { status: "error", message: guard.error };
  await reorderMenuItems(guard.tenant.user, guard.tenant.restaurantId, ids);
  refreshMenuSurfaces(guard.tenant.restaurantSlug);
  return { status: "success", message: "Dish order saved." };
}
