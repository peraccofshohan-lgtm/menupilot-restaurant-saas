"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/actions/types";
import { Alert } from "./index";

/**
 * Thin wrapper around `useActionState` that adds the two behaviours we need
 * everywhere: inline error/success messaging and post-success navigation.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  onSuccess,
  resetOnSuccess,
  ariaLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode | ((state: ActionState, pending: boolean) => React.ReactNode);
  className?: string;
  successMessage?: string;
  onSuccess?: (state: ActionState) => void;
  resetOnSuccess?: boolean;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ActionState);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state.status === "success") {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
      else router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={className} aria-label={ariaLabel} noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="error" className="mb-4">{state.message}</Alert>
      ) : null}
      {state.status === "success" && (state.message || successMessage) ? (
        <Alert tone="success" className="mb-4">{state.message ?? successMessage}</Alert>
      ) : null}
      {typeof children === "function" ? children(state, pending) : children}
    </form>
  );
}
