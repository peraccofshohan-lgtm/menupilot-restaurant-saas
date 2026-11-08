"use client";

import { useFormStatus } from "react-dom";
import { registerAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Button, Field, Input } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} size="lg">
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}

export function RegisterForm() {
  return (
    <ActionForm action={registerAction} className="space-y-4">
      {(state) => (
        <>
          <Field label="Full name" htmlFor="full_name" required error={state.errors?.full_name}>
            <Input id="full_name" name="full_name" autoComplete="name" required placeholder="Ayesha Rahman" invalid={Boolean(state.errors?.full_name)} />
          </Field>
          <Field label="Work email" htmlFor="email" required error={state.errors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@restaurant.com" invalid={Boolean(state.errors?.email)} />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            required
            error={state.errors?.password}
            hint="At least 8 characters, with a letter and a number."
          >
            <Input id="password" name="password" type="password" autoComplete="new-password" required invalid={Boolean(state.errors?.password)} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm_password" required error={state.errors?.confirm_password}>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              invalid={Boolean(state.errors?.confirm_password)}
            />
          </Field>
          <SubmitButton />
          <p className="text-[11.5px] leading-relaxed text-ink-400">
            By creating an account you agree to operate MenuPilot responsibly: guests' contact details stay inside
            your restaurant's workspace and are never shared with other tenants.
          </p>
        </>
      )}
    </ActionForm>
  );
}
