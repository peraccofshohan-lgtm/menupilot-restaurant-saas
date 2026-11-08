"use client";

import { useFormStatus } from "react-dom";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useState } from "react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} size="lg">
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <Alert tone="info" title="Check your inbox">
        If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.
      </Alert>
    );
  }
  return (
    <ActionForm action={requestPasswordResetAction} className="space-y-4" onSuccess={() => setSent(true)}>
      {(state) => (
        <>
          <Field label="Email" htmlFor="email" required error={state.errors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@restaurant.com" />
          </Field>
          <SubmitButton />
        </>
      )}
    </ActionForm>
  );
}
