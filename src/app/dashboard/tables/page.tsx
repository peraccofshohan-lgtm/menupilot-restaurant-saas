import Link from "next/link";
import { QrCode, Users } from "lucide-react";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { AddTableButton, TablesManager } from "@/components/dashboard/tables-manager";
import { requireTenant } from "@/lib/auth/server";
import { getTables, buildQrSvg } from "@/lib/services/tables";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tables & QR" };

export default async function TablesPage() {
  const tenant = await requireTenant(["owner", "manager"]);

  let tables;
  try {
    tables = await getTables(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[tables] load failed", error);
    return (
      <div className="space-y-4">
        <PageHeader title="Tables & QR" />
        <Alert tone="error" title="Tables could not be loaded">
          The server did not return your floor plan. Refresh to try again.
        </Alert>
      </div>
    );
  }

  const origin = serverEnv.appUrl.replace(/\/$/, "");
  const activeTables = tables.filter((table) => table.is_active);
  const busyTables = tables.filter((table) => table.open_orders > 0);

  // Pre-render a QR for each table so the print sheet works without JS.
  const qrMap: Record<string, string> = {};
  await Promise.all(
    tables
      .filter((table) => table.qr_token)
      .map(async (table) => {
        qrMap[table.id] = await buildQrSvg(`${origin}/q/${table.qr_token}`, 220);
      }),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tables & QR codes"
        description="Each table has its own cryptographic token. Scanning it opens your menu with the correct table already attached — guests cannot change the table by editing the URL."
        actions={<AddTableButton restaurantId={tenant.restaurantId} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tables" value={tables.length} hint={`${activeTables.length} active`} icon={<QrCode className="size-4" aria-hidden />} />
        <Stat label="QR codes" value={Object.keys(qrMap).length} hint="One live token per table" icon={<QrCode className="size-4" aria-hidden />} tone="clay" />
        <Stat label="Occupied now" value={busyTables.length} hint="Tables with open orders" icon={<Users className="size-4" aria-hidden />} tone="amber" />
        <Stat label="Seats" value={tables.reduce((sum, table) => sum + table.seats, 0)} hint="Across all tables" tone="moss" />
      </div>

      {tables.length === 0 ? (
        <Card>
          <EmptyState
            icon={<QrCode className="size-4" aria-hidden />}
            title="No tables yet"
            description="Add your first table to generate a QR code you can print and place on it."
            action={<AddTableButton restaurantId={tenant.restaurantId} />}
          />
        </Card>
      ) : (
        <TablesManager
          restaurantId={tenant.restaurantId}
          restaurantName={tenant.restaurantName}
          tables={tables}
          qrMap={qrMap}
        />
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-800">Print everything at once</p>
            <p className="mt-0.5 text-[12.5px] text-ink-500">
              One A4 sheet per four tables, with your restaurant name and the table label.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{tables.length} tables</Badge>
            <Link
              href="/dashboard/tables/print"
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 text-[12.5px] font-medium text-white hover:bg-ink-800"
            >
              Open print sheet
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
