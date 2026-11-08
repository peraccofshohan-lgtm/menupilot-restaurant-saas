import Link from "next/link";
import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Choose a new password</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">Signing in again will end your other sessions.</p>
      <div className="mt-7">
        {token ? <ResetForm token={token} /> : (
          <p className="text-[13.5px] text-red-600">
            This link is missing its token. Request a new one from{" "}
            <Link href="/forgot-password" className="font-medium underline">forgot password</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
