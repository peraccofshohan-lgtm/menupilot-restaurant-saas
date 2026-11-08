import { Alert, Badge, Card, CardBody, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { requireTenant } from "@/lib/auth/server";
import { asAuthed } from "@/lib/auth/server";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

interface SettingsRow {
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
  status: string;
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

export default async function SettingsPage() {
  const tenant = await requireTenant(["owner", "manager"]);

  let settings: SettingsRow | null = null;
  let failure = false;
  try {
    const rows = await asAuthed(tenant.user, (tx) =>
      tx.query<SettingsRow>(
        `select r.name, r.slug, r.tagline, r.description, r.phone, r.email, r.address, r.city,
                r.currency, r.time_zone, r.status, r.logo_path, r.cover_path,
                s.tax_rate, s.tax_label, s.service_charge_rate, s.service_charge_label,
                s.accept_orders, s.auto_accept_orders, s.require_customer_name, s.order_prefix,
                s.operating_hours, s.receipt_note
           from restaurants r
           left join restaurant_settings s on s.restaurant_id = r.id
          where r.id = $1`,
        [tenant.restaurantId],
      ),
    );
    settings = rows.rows[0] ?? null;
  } catch (error) {
    console.error("[settings] load failed", error);
    failure = true;
  }

  if (!settings || failure) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" />
        <Alert tone="error" title="Settings could not be loaded">
          The server did not return your restaurant configuration. Refresh the page to try again.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Identity, money, hours and ordering rules. Changes apply to the guest menu immediately."
        actions={
          <>
            <Badge tone={settings.status === "active" ? "moss" : "amber"} dot>
              {settings.status === "active" ? "Published" : settings.status}
            </Badge>
            <LinkButton href={`/menu/${settings.slug}`} variant="secondary" size="sm" target="_blank">
              <ExternalLink className="size-3.5" aria-hidden /> View menu
            </LinkButton>
          </>
        }
      />

      {settings.status !== "active" ? (
        <Alert tone="warning" title="Your restaurant is not published">
          Guests scanning a table code will see an unavailable message until the platform team activates the account.
        </Alert>
      ) : null}

      <SettingsForm restaurantId={tenant.restaurantId} initial={settings} readOnly={tenant.role === "manager" ? false : false} />

      <Card>
        <CardHeader title="Danger zone" description="These actions affect availability for guests immediately." />
        <CardBody className="pt-0">
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            Turning off ordering stops new guest orders but keeps your menu readable. Existing orders continue through
            the kitchen as normal. Suspending the whole restaurant is handled by MenuPilot support, not from here.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
