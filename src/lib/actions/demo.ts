"use server";

import { revalidatePath } from "next/cache";
import { getTenantContext } from "@/lib/auth/server";
import { resetDemoOrders } from "@/lib/services/demo-reset";
import { formToObject, type ActionState } from "./types";

/**
 * Demo-reset server action.
 *
 * Owner-only. The tenant comes from the session, never from the form, and the
 * service re-checks both the role and the `is_demo` flag — so a manager, a
 * kitchen account, or any tenant that is not flagged as a demo cannot trigger a
 * reset even if they post the form by hand.
 */
export async function resetDemoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tenant = await getTenantContext();
  if (!tenant) return { status: "error", message: "Your session has expired. Sign in again." };
  if (tenant.role !== "owner") {
    return { status: "error", message: "Only the restaurant owner can reset demo data." };
  }

  const input = formToObject(formData);
  const expected = Number(input.expectedOrders ?? "-1");
  if (!Number.isInteger(expected) || expected < 0) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const result = await resetDemoOrders(
    tenant.user.id,
    tenant.restaurantId,
    expected,
    String(input.confirm ?? ""),
  );

  if (!result.ok) {
    switch (result.error) {
      case "not_demo":
        return { status: "error", message: "This restaurant is not a demo tenant. Nothing was deleted." };
      case "confirmation_mismatch":
        return {
          status: "error",
          message:
            "The confirmation did not match, or new orders arrived since you loaded the page. Nothing was deleted — review the counts and try again.",
        };
      default:
        return { status: "error", message: "The reset could not be completed. Nothing was deleted." };
    }
  }

  const d = result.result.deleted;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/kitchen");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/demo");

  return {
    status: "success",
    message:
      `Removed ${d.orders} order${d.orders === 1 ? "" : "s"}, ${d.orderItems} line item${d.orderItems === 1 ? "" : "s"} ` +
      `and ${d.customers} guest record${d.customers === 1 ? "" : "s"}. ` +
      `Kept ${result.result.kept.menuItems} dishes, ${result.result.kept.categories} categories and ` +
      `${result.result.kept.qrTokens} QR codes.`,
  };
}
