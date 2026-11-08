import Link from "next/link";
import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Reset your password</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">
        Enter the email on your MenuPilot account and we will send a link to set a new password.
      </p>
      <div className="mt-7">
        <ForgotForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-500">
        <Link href="/login" className="font-medium text-clay-700 hover:text-clay-800">Back to sign in</Link>
      </p>
    </div>
  );
}
