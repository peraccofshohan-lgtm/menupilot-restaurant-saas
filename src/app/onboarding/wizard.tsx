"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { createWorkspaceAction } from "@/lib/actions/tenant";
import { makeSlug } from "@/lib/validation";

const STEPS = [
  { key: "identity", title: "Restaurant", description: "The name guests will see." },
  { key: "contact", title: "Contact", description: "Where you can be reached." },
  { key: "operations", title: "Operations", description: "Money, time zone and tables." },
  { key: "review", title: "Create", description: "Confirm and open the workspace." },
] as const;

const CURRENCIES = [
  { code: "BDT", label: "BDT — Bangladeshi taka" },
  { code: "USD", label: "USD — US dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — Pound sterling" },
  { code: "INR", label: "INR — Indian rupee" },
  { code: "AED", label: "AED — UAE dirham" },
  { code: "SGD", label: "SGD — Singapore dollar" },
  { code: "MYR", label: "MYR — Malaysian ringgit" },
];

const TIME_ZONES = [
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending}>
      {pending ? "Creating workspace…" : "Create workspace"}
    </Button>
  );
}

export function OnboardingWizard({ ownerName, compact = false }: { ownerName: string; compact?: boolean }) {
  const [step, setStep] = React.useState(0);
  const [values, setValues] = React.useState({
    name: "",
    slug: "",
    tagline: "",
    description: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    currency: "BDT",
    time_zone: "Asia/Dhaka",
    table_count: "10",
    tax_rate: "5",
    service_charge_rate: "5",
  });
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [state, setState] = React.useState<{ status: string; message?: string }>({ status: "idle" });
  const [pending, setPending] = React.useState(false);

  function update(field: keyof typeof values, value: string) {
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "name" && !slugTouched) next.slug = makeSlug(value);
      return next;
    });
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const { [field]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function validateStep(index: number): boolean {
    const next: Record<string, string> = {};
    if (index === 0) {
      if (values.name.trim().length < 2) next.name = "Enter your restaurant name.";
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) next.slug = "Use lowercase letters, numbers and dashes.";
      if (values.slug.length < 3) next.slug = "At least 3 characters.";
    }
    if (index === 1) {
      if (!values.phone.trim()) next.phone = "A contact phone is required.";
      else if (!/^[+()\-\s0-9]{6,24}$/.test(values.phone.trim())) next.phone = "Enter a valid phone number.";
      if (values.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(values.email)) next.email = "Enter a valid email.";
    }
    if (index === 2) {
      const tables = Number(values.table_count);
      if (!Number.isInteger(tables) || tables < 1 || tables > 60) next.table_count = "Between 1 and 60 tables.";
      const tax = Number(values.tax_rate);
      if (!Number.isFinite(tax) || tax < 0 || tax > 100) next.tax_rate = "Between 0 and 100.";
      const service = Number(values.service_charge_rate);
      if (!Number.isFinite(service) || service < 0 || service > 100) next.service_charge_rate = "Between 0 and 100.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateStep(2)) {
      setStep(2);
      return;
    }
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const result = await createWorkspaceAction({ status: "idle" }, formData);
    if (result.status === "success" && result.redirectTo) {
      window.location.href = result.redirectTo;
      return;
    }
    setPending(false);
    setErrors(result.errors ?? {});
    setState({ status: result.status, message: result.message });
    if (result.errors) {
      const first = Object.keys(result.errors)[0];
      if (first === "name" || first === "slug") setStep(0);
      else if (first === "phone" || first === "email") setStep(1);
      else if (first) setStep(2);
    }
  }

  return (
    <div className={cx("mx-auto w-full", compact ? "max-w-3xl" : "max-w-3xl px-5 py-10")}>
      <div className="mb-8">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-clay-600">Setup · step {step + 1} of {STEPS.length}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink-900">
          {compact ? "Create another workspace" : `Let's set up your restaurant, ${ownerName.split(" ")[0]}`}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          We create your menu categories and table QR codes automatically. You can change everything afterwards.
        </p>
      </div>

      <ol className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li
              key={s.key}
              className={cx(
                "rounded-lg border px-3 py-2.5",
                active ? "border-clay-300 bg-clay-50" : done ? "border-moss-100 bg-moss-50" : "border-ink-200 bg-white",
              )}
            >
              <div className="flex items-center gap-1.5">
                {done ? (
                  <Check className="size-3.5 text-moss-600" aria-hidden />
                ) : (
                  <span className={cx("text-[11px] font-semibold", active ? "text-clay-700" : "text-ink-400")}>{index + 1}</span>
                )}
                <p className={cx("text-[12px] font-semibold", active ? "text-clay-800" : done ? "text-moss-700" : "text-ink-500")}>{s.title}</p>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-ink-400">{s.description}</p>
            </li>
          );
        })}
      </ol>

      <Card className="p-5 sm:p-6">
        <form onSubmit={handleSubmit} noValidate>
          {state.status === "error" && state.message ? (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">
              {state.message}
            </p>
          ) : null}

          <div className={step === 0 ? "space-y-4" : "hidden"}>
            <Field label="Restaurant name" htmlFor="name" required error={errors.name}>
              <Input
                id="name"
                name="name"
                value={values.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="MATI Kitchen"
                invalid={Boolean(errors.name)}
                autoFocus
              />
            </Field>
            <Field
              label="Menu link"
              htmlFor="slug"
              required
              error={errors.slug}
              hint={`Guests will open menupilot.app/menu/${values.slug || "your-restaurant"}`}
            >
              <div className="flex items-center gap-0">
                <span className="flex h-10 items-center rounded-l-lg border border-r-0 border-ink-200 bg-ink-50 px-2.5 text-[12.5px] text-ink-500">
                  /menu/
                </span>
                <Input
                  id="slug"
                  name="slug"
                  value={values.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update("slug", makeSlug(e.target.value));
                  }}
                  className="rounded-l-none"
                  invalid={Boolean(errors.slug)}
                />
              </div>
            </Field>
            <Field label="Tagline" htmlFor="tagline" hint="One line that sums up your kitchen.">
              <Input id="tagline" name="tagline" value={values.tagline} onChange={(e) => update("tagline", e.target.value)} placeholder="Slow-cooked Bengali comfort, served fast." />
            </Field>
            <Field label="Description" htmlFor="description" hint="Shown at the top of your public menu.">
              <Textarea id="description" name="description" value={values.description} onChange={(e) => update("description", e.target.value)} />
            </Field>
          </div>

          <div className={step === 1 ? "space-y-4" : "hidden"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" htmlFor="phone" required error={errors.phone}>
                <Input id="phone" name="phone" value={values.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+880 1700 000000" invalid={Boolean(errors.phone)} />
              </Field>
              <Field label="Email" htmlFor="email" error={errors.email}>
                <Input id="email" name="email" type="email" value={values.email} onChange={(e) => update("email", e.target.value)} placeholder="hello@restaurant.com" invalid={Boolean(errors.email)} />
              </Field>
            </div>
            <Field label="Address" htmlFor="address">
              <Input id="address" name="address" value={values.address} onChange={(e) => update("address", e.target.value)} placeholder="House 42, Road 27" />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" value={values.city} onChange={(e) => update("city", e.target.value)} placeholder="Dhaka" />
            </Field>
          </div>

          <div className={step === 2 ? "space-y-4" : "hidden"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" htmlFor="currency" required>
                <Select id="currency" name="currency" value={values.currency} onChange={(e) => update("currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Time zone" htmlFor="time_zone" required hint="Used for business-day reporting.">
                <Select id="time_zone" name="time_zone" value={values.time_zone} onChange={(e) => update("time_zone", e.target.value)}>
                  {TIME_ZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Dining tables" htmlFor="table_count" required error={errors.table_count} hint="We generate a QR for each.">
                <Input id="table_count" name="table_count" type="number" min={1} max={60} value={values.table_count} onChange={(e) => update("table_count", e.target.value)} invalid={Boolean(errors.table_count)} />
              </Field>
              <Field label="Tax rate %" htmlFor="tax_rate" error={errors.tax_rate}>
                <Input id="tax_rate" name="tax_rate" type="number" min={0} max={100} step="0.5" value={values.tax_rate} onChange={(e) => update("tax_rate", e.target.value)} invalid={Boolean(errors.tax_rate)} />
              </Field>
              <Field label="Service charge %" htmlFor="service_charge_rate" error={errors.service_charge_rate}>
                <Input id="service_charge_rate" name="service_charge_rate" type="number" min={0} max={100} step="0.5" value={values.service_charge_rate} onChange={(e) => update("service_charge_rate", e.target.value)} invalid={Boolean(errors.service_charge_rate)} />
              </Field>
            </div>
            <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-500 ring-1 ring-inset ring-ink-100">
              Tax and service charge are applied on top of dish prices and shown to guests before they confirm. You can
              switch to tax-inclusive pricing in Settings at any time.
            </p>
          </div>

          <div className={step === 3 ? "space-y-4" : "hidden"}>
            <dl className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {[
                ["Restaurant", values.name || "—"],
                ["Menu link", `/menu/${values.slug || "—"}`],
                ["Phone", values.phone || "—"],
                ["Email", values.email || "—"],
                ["Address", [values.address, values.city].filter(Boolean).join(", ") || "—"],
                ["Currency", values.currency],
                ["Time zone", values.time_zone],
                ["Tables", `${values.table_count} with QR codes`],
                ["Tax", `${values.tax_rate}%`],
                ["Service charge", `${values.service_charge_rate}%`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-[12.5px] text-ink-500">{label}</dt>
                  <dd className="max-w-[60%] text-right text-[12.5px] font-medium text-ink-800">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[12.5px] leading-relaxed text-ink-500">
              Creating the workspace will add four starter categories and {values.table_count} table QR codes. No demo
              data is copied into your restaurant.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || pending}
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={() => {
                  if (validateStep(step)) setStep((s) => Math.min(STEPS.length - 1, s + 1));
                }}
                disabled={pending}
              >
                Continue <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <SubmitButton />
            )}
          </div>
        </form>
      </Card>
      {pending ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-ink-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Creating your menu categories and QR codes…
        </p>
      ) : null}
    </div>
  );
}
