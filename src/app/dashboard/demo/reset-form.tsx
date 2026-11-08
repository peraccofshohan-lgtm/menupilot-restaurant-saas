"use client";

import * as React from "react";

import { resetDemoAction } from "@/lib/actions/demo";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui";

/**
 * Two-step confirmation: the button stays disabled until the operator types
 * RESET, so a stray click cannot clear the queue while a demo is running.
 */
export function ResetDemoForm({
  expectedOrders,
  disabled,
}: {
  expectedOrders: number;
  disabled: boolean;
}) {
  const [phrase, setPhrase] = React.useState("");
  const armed = phrase.trim().toUpperCase() === "RESET";

  return (
    <ActionForm action={resetDemoAction} className="mt-4 space-y-3" successMessage="Demo orders cleared.">
      {(state, pending) => (
        <>
          <input type="hidden" name="expectedOrders" value={expectedOrders} />
          <label className="block">
            <span className="text-[12px] font-medium text-ink-700">
              Type RESET to confirm ({expectedOrders} order{expectedOrders === 1 ? "" : "s"} will be deleted)
            </span>
            <input
              name="confirm"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              disabled={disabled || pending}
              autoComplete="off"
              spellCheck={false}
              placeholder="RESET"
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 font-mono text-[13px] uppercase tracking-widest text-ink-900 placeholder:text-ink-300 focus:border-ink-500 focus:outline-none disabled:bg-ink-50"
            />
          </label>

          <button
            type="submit"
            disabled={disabled || pending || !armed}
            className="inline-flex items-center rounded-lg bg-red-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
          >
            {pending ? "Clearing…" : "Clear demo orders"}
          </button>

          {disabled ? (
            <p className="text-[11.5px] text-ink-400">
              {expectedOrders === 0
                ? "There are no orders to clear."
                : "Reset is disabled for this restaurant."}
            </p>
          ) : null}

          {state.status === "error" ? (
            <Alert tone="error">{state.message ?? "The reset failed."}</Alert>
          ) : null}
          {state.status === "success" ? <Alert tone="success">{state.message}</Alert> : null}
        </>
      )}
    </ActionForm>
  );
}
