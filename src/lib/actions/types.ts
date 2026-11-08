/** Shared shape for every server action, consumed by `useActionState`. */
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: Record<string, string>;
  redirectTo?: string;
  data?: Record<string, unknown>;
  /** Link the user can copy when email delivery is unavailable. */
  inviteUrl?: string;
}

export const initialActionState: ActionState = { status: "idle" };

export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
