import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, CreditCard, MessageSquare, Receipt, StickyNote, User } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  LinkButton,
  OrderStatusBadge,
  PageHeader,
  ORDER_STATUS_LABEL,
} from "@/components/ui";
import { OrderActions } from "@/components/dashboard/order-actions";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { requireTenant } from "@/lib/auth/server";
import { getOrder } from "@/lib/services/orders";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant(["owner", "manager", "waiter", "kitchen"]);
  const { id } = await params;

  const order = await getOrder(tenant.user, tenant.restaurantId, id);
  if (!order) notFound();

  const currency = order.currency || tenant.currency;

  const timeline = [
    { label: "Placed", at: order.created_at },
    { label: "Accepted", at: order.accepted_at },
    { label: "Preparing", at: order.preparing_at },
    { label: "Ready", at: order.ready_at },
    { label: "Served", at: order.served_at },
    { label: "Rejected", at: order.rejected_at },
  ].filter((entry) => entry.at);

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/orders" className="inline-flex items-center gap-1 hover:text-ink-700">
            <ArrowLeft className="size-3" aria-hidden /> All orders
          </Link>
        }
        title={`Order ${order.order_number}`}
        description={`${order.table_label ?? "Counter order"} · placed ${formatDateTime(order.created_at, tenant.timeZone)} (${timeAgo(order.created_at)})`}
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            {order.payment_status === "paid" ? <Badge tone="moss">Paid</Badge> : <Badge tone="neutral">Payment at counter</Badge>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Items" description={`${order.item_count} item${order.item_count === 1 ? "" : "s"} · prices captured when the order was placed`} />
            <CardBody className="pt-0">
              <ul className="divide-y divide-ink-100">
                {order.items.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink-800">
                        <span className="mr-1.5 inline-flex min-w-5 justify-center rounded bg-ink-100 px-1 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
                          {line.quantity}×
                        </span>
                        {line.name}
                      </p>
                      {line.note ? (
                        <p className="mt-0.5 flex items-start gap-1 text-[11.5px] text-clay-700">
                          <MessageSquare className="mt-0.5 size-3 shrink-0" aria-hidden /> {line.note}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-semibold tabular-nums text-ink-900">{formatMoney(line.line_total, currency)}</p>
                      <p className="text-[11px] text-ink-400">{formatMoney(line.unit_price, currency)} each</p>
                    </div>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-[12.5px]">
                <Row label="Subtotal" value={formatMoney(order.subtotal, currency)} />
                {Number(order.service_charge) > 0 ? <Row label="Service charge" value={formatMoney(order.service_charge, currency)} /> : null}
                {Number(order.tax_amount) > 0 ? <Row label="Tax" value={formatMoney(order.tax_amount, currency)} /> : null}
                <div className="flex items-center justify-between border-t border-ink-100 pt-1.5">
                  <dt className="text-[13px] font-semibold text-ink-900">Total</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-ink-900">{formatMoney(order.total, currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {order.note ? (
            <Card className="border-clay-200 bg-clay-50/50">
              <CardBody className="flex items-start gap-2.5">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-clay-600" aria-hidden />
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-clay-700">Guest note</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-800">{order.note}</p>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Audit trail" description="Every status change is recorded with the responsible role." />
            <CardBody className="pt-0">
              <ol className="relative space-y-3 border-l border-ink-200 pl-4">
                {order.history.map((entry, index) => (
                  <li key={`${entry.to_status}-${index}`} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-clay-400 ring-2 ring-white" aria-hidden />
                    <p className="text-[12.5px] font-medium text-ink-800">{ORDER_STATUS_LABEL[entry.to_status] ?? entry.to_status}</p>
                    <p className="text-[11.5px] text-ink-400">
                      {formatDateTime(entry.created_at, tenant.timeZone)}
                      {entry.actor_role ? ` · by ${entry.actor_role}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Next step" description="Only permitted transitions are shown." />
            <CardBody className="pt-0">
              <OrderActions
                orderId={order.id}
                restaurantId={tenant.restaurantId}
                status={order.status}
                role={tenant.role}
                fullWidth
              />
              {order.status === "rejected" && order.rejection_reason ? (
                <p className="mt-3 rounded-md bg-red-50 px-2.5 py-2 text-[12px] text-red-700 ring-1 ring-inset ring-red-200">
                  Rejected: {order.rejection_reason}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Guest" />
            <CardBody className="space-y-2.5 pt-0">
              <Detail icon={<User className="size-3.5" aria-hidden />} label="Name" value={order.customer_name ?? "Not provided"} />
              <Detail icon={<Receipt className="size-3.5" aria-hidden />} label="Phone" value={order.customer_phone ?? "Not provided"} />
              <Detail icon={<CreditCard className="size-3.5" aria-hidden />} label="Payment" value={order.payment_status === "paid" ? "Paid" : "Due at counter"} />
              <Detail icon={<Clock3 className="size-3.5" aria-hidden />} label="Table" value={order.table_label ?? "Counter"} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Session" description="Operator actions are attributable, not anonymous." />
            <CardBody className="pt-0">
              <dl className="space-y-1.5 text-[12px]">
                <Row label="Signed in as" value={tenant.user.email} />
                <Row label="Role" value={tenant.role} />
                <Row label="Restaurant" value={tenant.restaurantName} />
              </dl>
            </CardBody>
          </Card>

          <div className="flex gap-2">
            <LinkButton href="/dashboard/orders" variant="secondary" size="sm" fullWidth>Back to orders</LinkButton>
          </div>
        </div>
      </div>

      {timeline.length > 1 ? (
        <p className="text-[11.5px] text-ink-400">
          Lifecycle: {timeline.map((entry) => `${entry.label} ${new Date(entry.at!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tenant.timeZone })}`).join(" → ")}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-ink-400" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
        <p className="truncate text-[12.5px] font-medium text-ink-800">{value}</p>
      </div>
    </div>
  );
}
