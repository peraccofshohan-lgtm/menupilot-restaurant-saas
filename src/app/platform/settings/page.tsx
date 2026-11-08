import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/server";
import { asAuthed } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function PlatformSettingsPage() {
  const user = await requireUser("/platform/settings");

  const config = await asAuthed(user, async (tx) => {
    const res = await tx.query<{ storage: string; database: string; migrations: string; admin_count: string }>(
      `select
         (select count(*) from storage_objects)::text as storage,
         (select count(*) from restaurants)::text as database,
         (select count(*) from schema_migrations)::text as migrations,
         (select count(*) from platform_admins)::text as admin_count`,
    );
    return res.rows[0];
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Platform settings" description="Operator-level configuration for this MenuPilot installation." />

      <Card>
        <CardHeader title="Runtime" description="Read-only facts about the running instance." />
        <CardBody className="grid gap-3 pt-0 sm:grid-cols-2">
          <Fact label="Database engine" value={process.env.DATABASE_URL ? "External PostgreSQL (Supabase compatible)" : "Embedded PostgreSQL (PGlite)"} />
          <Fact label="Storage driver" value={process.env.STORAGE_DRIVER === "supabase" ? "Supabase Storage" : "Local (PostgreSQL objects)"} />
          <Fact label="Applied migrations" value={config?.migrations ?? "0"} />
          <Fact label="Stored media objects" value={config?.storage ?? "0"} />
          <Fact label="Tenants" value={config?.database ?? "0"} />
          <Fact label="Platform admins" value={config?.admin_count ?? "0"} />
        </CardBody>
      </Card>

      <Alert tone="info" title="Configuration lives in environment variables">
        Database, storage and session secrets are supplied through the environment (see <code>.env.example</code> and{" "}
        <code>DEPLOYMENT.md</code>). They are intentionally not editable from this screen, so a compromised operator
        session cannot rewrite the deployment&apos;s own security settings.
      </Alert>

      <Card>
        <CardHeader title="Trust boundaries" description="What a platform administrator can and cannot see." />
        <CardBody className="pt-0">
          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-600">
            <li>• Visible: tenant names, account status, membership counts, order counts and aggregate GMV.</li>
            <li>• Not visible: guest contact details, individual order contents, staff emails beyond the owner's.</li>
            <li>• Demo tenants cannot be suspended or renamed from this console.</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="text-[12.5px] font-medium text-ink-800">{value}</p>
    </div>
  );
}
