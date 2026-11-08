import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/server";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "নতুন রেস্টুরেন্ট অ্যাকাউন্ট" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your account</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-500">
        One account per owner. You will set up your restaurant in the next step — it takes about five minutes.
      </p>
      <div className="mt-7">
        <RegisterForm />
      </div>
      <p className="mt-6 text-[13px] text-ink-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-clay-700 hover:text-clay-800">
          Sign in
        </Link>
      </p>
    </div>
  );
}
