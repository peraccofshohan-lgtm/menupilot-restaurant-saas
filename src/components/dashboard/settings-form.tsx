"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Save } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { saveSettingsAction } from "@/lib/actions/tenant";
import { initialActionState, type ActionState } from "@/lib/actions/types";

interface Settings {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  time_zone: string;
  logo_path: string | null;
  cover_path: string | null;
  tax_rate: string | null;
  tax_label: string | null;
  service_charge_rate: string | null;
  service_charge_label: string | null;
  accept_orders: boolean | null;
  auto_accept_orders: boolean | null;
  require_customer_name: boolean | null;
  order_prefix: string | null;
  operating_hours: Record<string, { open: string; close: string } | null> | null;
  receipt_note: string | null;
}

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "AED", "SGD", "MYR"];
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

export function SettingsForm({
  restaurantId,
  initial,
  readOnly,
}: {
  restaurantId: string;
  initial: Settings;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState({
    name: initial.name,
    tagline: initial.tagline ?? "",
    description: initial.description ?? "",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    address: initial.address ?? "",
    city: initial.city ?? "",
    currency: initial.currency,
    time_zone: initial.time_zone,
    tax_rate: initial.tax_rate ?? "0",
    tax_label: initial.tax_label ?? "VAT",
    service_charge_rate: initial.service_charge_rate ?? "0",
    service_charge_label: initial.service_charge_label ?? "Service charge",
    order_prefix: initial.order_prefix ?? "MP",
    receipt_note: initial.receipt_note ?? "",
  });
  const [acceptOrders, setAcceptOrders] = React.useState(initial.accept_orders ?? true);
  const [autoAccept, setAutoAccept] = React.useState(initial.auto_accept_orders ?? false);
  const [requireName, setRequireName] = React.useState(initial.require_customer_name ?? false);
  const [hours, setHours] = React.useState(() =>
    Object.fromEntries(
      DAYS.map((day) => {
        const value = initial.operating_hours?.[day.key];
        return [day.key, { open: value?.open ?? "", close: value?.close ?? "" }];
      }),
    ),
  );
  const [state, setState] = React.useState<ActionState>(initialActionState);
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (state.status !== "success") return;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 3000);
    router.refresh();
    return () => clearTimeout(timer);
  }, [state, router]);

  function update(field: keyof typeof values, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("restaurant_id", restaurantId);
    formData.set("accept_orders", acceptOrders ? "true" : "false");
    formData.set("auto_accept_orders", autoAccept ? "true" : "false");
    formData.set("require_customer_name", requireName ? "true" : "false");
    for (const day of DAYS) {
      formData.set(`hours_${day.key}_open`, hours[day.key]?.open ?? "");
      formData.set(`hours_${day.key}_close`, hours[day.key]?.close ?? "");
    }
    setPending(true);
    const result = await saveSettingsAction(initialActionState, formData);
    setPending(false);
    setState(result);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert tone="error" title="Settings not saved">{state.message}</Alert>
      ) : null}

      <Card>
        <CardHeader title="Restaurant identity" description="This is what guests see at the top of your menu." />
        <CardBody className="grid gap-3.5 pt-0 sm:grid-cols-2">
          <Field label="Restaurant name" htmlFor="set-name" required error={state.errors?.name}>
            <Input id="set-name" name="name" value={values.name} onChange={(e) => update("name", e.target.value)} disabled={readOnly} required />
          </Field>
          <Field label="Menu link" htmlFor="set-slug" hint="Changing this breaks printed QR codes that point at the old link.">
            <Input id="set-slug" value={`/menu/${initial.slug}`} disabled readOnly className="bg-ink-50 font-mono text-[12px]" />
          </Field>
          <Field label="Tagline" htmlFor="set-tagline" className="sm:col-span-2">
            <Input id="set-tagline" name="tagline" value={values.tagline} onChange={(e) => update("tagline", e.target.value)} maxLength={160} />
          </Field>
          <Field label="Description" htmlFor="set-description" className="sm:col-span-2">
            <Textarea id="set-description" name="description" value={values.description} onChange={(e) => update("description", e.target.value)} maxLength={1200} />
          </Field>
          <BrandingUploader restaurantId={restaurantId} kind="logo" current={initial.logo_path} />
          <BrandingUploader restaurantId={restaurantId} kind="cover" current={initial.cover_path} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contact" description="Shown to guests who need to reach you." />
        <CardBody className="grid gap-3.5 pt-0 sm:grid-cols-2">
          <Field label="Phone" htmlFor="set-phone" error={state.errors?.phone}>
            <Input id="set-phone" name="phone" value={values.phone} onChange={(e) => update("phone", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="set-email" error={state.errors?.email}>
            <Input id="set-email" name="email" type="email" value={values.email} onChange={(e) => update("email", e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="set-address">
            <Input id="set-address" name="address" value={values.address} onChange={(e) => update("address", e.target.value)} />
          </Field>
          <Field label="City" htmlFor="set-city">
            <Input id="set-city" name="city" value={values.city} onChange={(e) => update("city", e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Money" description="Applied on top of dish prices and recalculated on every order." />
        <CardBody className="grid gap-3.5 pt-0 sm:grid-cols-2">
          <Field label="Currency" htmlFor="set-currency">
            <Select id="set-currency" name="currency" value={values.currency} onChange={(e) => update("currency", e.target.value)}>
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </Field>
          <Field label="Time zone" htmlFor="set-timezone" hint="Business days and reports follow this zone.">
            <Select id="set-timezone" name="time_zone" value={values.time_zone} onChange={(e) => update("time_zone", e.target.value)}>
              {TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </Select>
          </Field>
          <Field label="Tax label" htmlFor="set-tax-label">
            <Input id="set-tax-label" name="tax_label" value={values.tax_label} onChange={(e) => update("tax_label", e.target.value)} maxLength={24} />
          </Field>
          <Field label="Tax rate %" htmlFor="set-tax-rate" error={state.errors?.tax_rate}>
            <Input id="set-tax-rate" name="tax_rate" type="number" min={0} max={100} step="0.5" value={values.tax_rate} onChange={(e) => update("tax_rate", e.target.value)} />
          </Field>
          <Field label="Service charge label" htmlFor="set-service-label">
            <Input id="set-service-label" name="service_charge_label" value={values.service_charge_label} onChange={(e) => update("service_charge_label", e.target.value)} maxLength={32} />
          </Field>
          <Field label="Service charge %" htmlFor="set-service-rate" error={state.errors?.service_charge_rate}>
            <Input id="set-service-rate" name="service_charge_rate" type="number" min={0} max={100} step="0.5" value={values.service_charge_rate} onChange={(e) => update("service_charge_rate", e.target.value)} />
          </Field>
          <Field label="Order prefix" htmlFor="set-prefix" hint="Up to 4 characters, e.g. MATI-261108-1000.">
            <Input id="set-prefix" name="order_prefix" value={values.order_prefix} onChange={(e) => update("order_prefix", e.target.value.toUpperCase())} maxLength={4} />
          </Field>
          <Field label="Receipt note" htmlFor="set-receipt" hint="Printed on the guest's receipt.">
            <Input id="set-receipt" name="receipt_note" value={values.receipt_note} onChange={(e) => update("receipt_note", e.target.value)} maxLength={200} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Ordering rules" description="Who approves orders, and what guests must provide." />
        <CardBody className="divide-y divide-ink-100 pt-0">
          <Switch
            label="Accept guest orders"
            description="Turn off to pause QR ordering (for example between services) without hiding your menu."
            checked={acceptOrders}
            onChange={setAcceptOrders}
          />
          <Switch
            label="Auto-accept approved tables"
            description="Skip manual approval and send orders straight to the kitchen. Only enable this if your floor can absorb it."
            checked={autoAccept}
            onChange={setAutoAccept}
          />
          <Switch
            label="Require a guest name"
            description="Guests must enter a name before submitting an order."
            checked={requireName}
            onChange={setRequireName}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Operating hours" description="Shown for information; they do not block orders automatically." />
        <CardBody className="space-y-1.5 pt-0">
          {DAYS.map((day) => (
            <div key={day.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[12.5px] text-ink-600">{day.label}</span>
              <input
                type="time"
                value={hours[day.key]?.open ?? ""}
                onChange={(event) =>
                  setHours((prev) => ({ ...prev, [day.key]: { open: event.target.value, close: prev[day.key]?.close ?? "" } }))
                }
                aria-label={`${day.label} opening time`}
                className="h-8 rounded-lg border border-ink-200 px-2 text-[12.5px]"
              />
              <span className="text-[11px] text-ink-400">to</span>
              <input
                type="time"
                value={hours[day.key]?.close ?? ""}
                onChange={(event) =>
                  setHours((prev) => ({ ...prev, [day.key]: { open: prev[day.key]?.open ?? "", close: event.target.value } }))
                }
                aria-label={`${day.label} closing time`}
                className="h-8 rounded-lg border border-ink-200 px-2 text-[12.5px]"
              />
              <button
                type="button"
                onClick={() => setHours((prev) => ({ ...prev, [day.key]: { open: "", close: "" } }))}
                className="text-[11.5px] text-ink-400 hover:text-red-600"
              >
                Clear
              </button>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white/95 px-3.5 py-2.5 backdrop-blur-sm">
        <p className="text-[11.5px] text-ink-500">
          {saved ? (
            <span className="inline-flex items-center gap-1 font-medium text-moss-700"><Check className="size-3.5" aria-hidden /> Saved</span>
          ) : (
            "Changes are validated on the server before they are saved."
          )}
        </p>
        <Button type="submit" loading={pending} disabled={readOnly}>
          <Save className="size-4" aria-hidden /> Save settings
        </Button>
      </div>
    </form>
  );
}

function BrandingUploader({
  restaurantId,
  kind,
  current,
}: {
  restaurantId: string;
  kind: "logo" | "cover";
  current: string | null;
}) {
  const [path, setPath] = React.useState(current ?? "");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch(`/api/uploads/branding?kind=${kind}`, { method: "POST", body });
      const data = (await res.json()) as { ok: boolean; path?: string; error?: string };
      if (!data.ok) setError(data.error ?? "Upload failed.");
      else setPath(data.path ?? "");
    } catch {
      setError("Network problem during upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink-700">{kind === "logo" ? "Logo" : "Cover image"}</p>
      <input type="hidden" name={kind === "logo" ? "logo_path" : "cover_path"} value={path} />
      <div className="flex items-center gap-3">
        <div className={`overflow-hidden rounded-lg border border-ink-200 bg-ink-50 ${kind === "logo" ? "size-16" : "h-16 w-28"}`}>
          {path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/branding/${path}`} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-ink-300"><ImagePlus className="size-4" aria-hidden /></span>
          )}
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button type="button" size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
            {path ? "Replace" : "Upload"}
          </Button>
          {error ? <p className="mt-1 text-[11.5px] text-red-600" role="alert">{error}</p> : null}
          <p className="mt-1 text-[11px] text-ink-400">
            {kind === "logo" ? "Square works best." : "Wide, at least 1200px."}
          </p>
        </div>
      </div>
    </div>
  );
}
