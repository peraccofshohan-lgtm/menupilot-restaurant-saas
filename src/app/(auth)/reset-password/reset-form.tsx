"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { resetPasswordAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Button, Field, Input } from "@/components/ui";
import { useState } from "react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} size="lg">
      {pending ? "Saving…" : "Set new password"}
    </Button>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-600">Your password has been changed.</p>
        <Link href="/login" className="text-[13.5px] font-medium text-clay-700 hover:underline">Sign in with your new password</Link>
      </div>
    );
  }
  return (
    <ActionForm action={resetPasswordAction} className="space-y-4" onSuccess={() => setDone(true)}>
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="New password" htmlFor="password" required error={state.errors?.password} hint="At least 8 characters, with a letter and a number.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm_password" required error={state.errors?.confirm_password}>
            <Input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton />
        </>
      )}
    </ActionForm>
  );
}
