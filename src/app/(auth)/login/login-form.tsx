"use client";

import { useFormStatus } from "react-dom";
import { loginAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Button, Field, Input } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} size="lg">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="Email" htmlFor="email" required error={state.errors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@restaurant.com" invalid={Boolean(state.errors?.email)} />
          </Field>
          <Field label="Password" htmlFor="password" required error={state.errors?.password}>
            <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" invalid={Boolean(state.errors?.password)} />
          </Field>
          <div className="flex justify-end">
            <a href="/forgot-password" className="text-[12.5px] font-medium text-clay-700 hover:text-clay-800">
              Forgot your password?
            </a>
          </div>
          <SubmitButton />
        </>
      )}
    </ActionForm>
  );
}
