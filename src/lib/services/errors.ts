/**
 * One place that turns a thrown error into an HTTP status plus safe copy.
 *
 * Route handlers must not echo `error.message` to the browser: PostgreSQL errors
 * carry policy names and table names, and driver errors carry connection strings.
 * This module keeps the coded `MP:*` vocabulary (which our own functions raise on
 * purpose) and collapses everything else into a generic message.
 */

export interface ServiceError {
  status: number;
  message: string;
  /** The original code, for server-side logging only. */
  code: string;
}

const COPY: Record<string, { status: number; message: string }> = {
  "MP:FORBIDDEN": { status: 403, message: "You do not have access to that." },
  "MP:FORBIDDEN_TRANSITION": { status: 403, message: "Your role cannot perform that action." },
  "MP:NOT_AUTHENTICATED": { status: 401, message: "Your session has expired. Sign in again." },
  "MP:ORDER_NOT_FOUND": { status: 404, message: "That order no longer exists." },
  "MP:INVALID_QR": { status: 404, message: "That QR code is no longer valid." },
  "MP:INVALID_ITEM": { status: 422, message: "One of the dishes is no longer on the menu." },
  "MP:ITEM_UNAVAILABLE": { status: 422, message: "One of the dishes sold out. Please pick another." },
  "MP:TABLE_INACTIVE": { status: 422, message: "That table is not available for ordering." },
  "MP:RESTAURANT_UNAVAILABLE": { status: 422, message: "This restaurant is not accepting orders right now." },
  "MP:ORDERING_DISABLED": { status: 422, message: "Ordering is paused for a moment. Please try again shortly." },
  "MP:EMPTY_CART": { status: 422, message: "Your cart is empty." },
  "MP:CART_TOO_LARGE": { status: 422, message: "That is too many items for one order." },
  "MP:DUPLICATE_ITEM": { status: 422, message: "The same dish appears twice in your cart." },
  "MP:INVALID_TRANSITION": { status: 422, message: "That status change is not allowed." },
  "MP:LAST_OWNER": { status: 409, message: "A restaurant must keep at least one owner." },
  "MP:IMMUTABLE_ORDER_FIELD": { status: 409, message: "Prices on a placed order cannot be edited." },
  "MP:INVALID_RANGE": { status: 422, message: "That date range is not valid." },
};

export function mapServiceError(error: unknown): ServiceError {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const parts = message.split(":");
  const key = parts.slice(0, 2).join(":");
  const known = COPY[key];
  if (known) {
    return {
      status: known.status,
      message:
        key === "MP:INVALID_TRANSITION" && parts[2]?.includes("->")
          ? `An order cannot move from ${parts[2].split("->")[0]} to ${parts[2].split("->")[1]}.`
          : known.message,
      code: key,
    };
  }
  return {
    status: 500,
    message: "Something went wrong on our side. Please try again.",
    code: key || "UNKNOWN",
  };
}

/** Convenience for route handlers: log the real cause, return the safe shape. */
export function errorResponseBody(error: unknown, scope: string): ServiceError {
  const mapped = mapServiceError(error);
  if (mapped.status >= 500) console.error(`[${scope}]`, error);
  return mapped;
}
