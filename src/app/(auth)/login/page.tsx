import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; registered?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Welcome back</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">
        Sign in to manage orders, your menu and your team.
      </p>
      <div className="mt-7">
        <LoginForm next={params.next ?? ""} />
      </div>
      <p className="mt-6 text-[13px] text-ink-500">
        New to MenuPilot?{" "}
        <Link href="/register" className="font-medium text-clay-700 hover:text-clay-800">
          Create a restaurant account
        </Link>
      </p>
    </div>
  );
}
