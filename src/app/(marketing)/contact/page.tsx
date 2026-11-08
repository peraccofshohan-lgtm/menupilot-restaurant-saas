import type { Metadata } from "next";
import { Mail, MapPin, Phone } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, LinkButton } from "@/components/ui";

export const metadata: Metadata = {
  title: "Contact",
  description: "Talk to the MenuPilot team about onboarding your restaurant.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <Badge tone="clay">Contact</Badge>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">Let's get your floor running</h1>
      <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-600">
        MenuPilot is onboarded by people, not by a checkout form. Tell us about your restaurant and we will set up your
        workspace with you.
      </p>

      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Reach the team" description="We reply within one business day." />
          <CardBody className="space-y-3 pt-0">
            <a href="mailto:hello@menupilot.app" className="flex items-center gap-2.5 text-[13px] text-ink-700 hover:text-clay-700">
              <Mail className="size-4 text-ink-400" aria-hidden /> hello@menupilot.app
            </a>
            <a href="tel:+8801700000000" className="flex items-center gap-2.5 text-[13px] text-ink-700 hover:text-clay-700">
              <Phone className="size-4 text-ink-400" aria-hidden /> +880 1700 000000
            </a>
            <p className="flex items-center gap-2.5 text-[13px] text-ink-700">
              <MapPin className="size-4 text-ink-400" aria-hidden /> Dhanmondi, Dhaka
            </p>
          </CardBody>
        </Card>

        <Card className="bg-ink-900">
          <CardBody className="flex h-full flex-col justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-white">Already have an account?</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-300">
                Sign in to manage your menu, tables and orders — or create a workspace in under ten minutes and place a
                test order yourself.
              </p>
            </div>
            <div className="flex gap-2">
              <LinkButton href="/login" variant="secondary" size="sm">Sign in</LinkButton>
              <LinkButton href="/register" size="sm">Create account</LinkButton>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="What to have ready" description="Onboarding is faster with these five things." />
        <CardBody className="pt-0">
          <ol className="grid gap-2 text-[13px] text-ink-600 sm:grid-cols-2">
            <li>1. Your restaurant name and a short description</li>
            <li>2. A logo (square) and a cover photo (wide)</li>
            <li>3. Your current menu with prices</li>
            <li>4. How many tables you run</li>
            <li>5. Whether orders need manager approval</li>
            <li>6. Your tax and service-charge rules</li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
