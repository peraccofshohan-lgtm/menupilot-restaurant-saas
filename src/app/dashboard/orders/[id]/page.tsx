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
  ORDER_STATUS_KEY,
} from "@/components/ui";
import { OrderActions } from "@/components/dashboard/order-actions";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { requireTenant } from "@/lib/auth/server";
import { getOrder } from "@/lib/services/orders";
import { formatDateTime, formatMoney, formatNumber, timeAgo } from "@/lib/format";
import { getTranslator } from "@/lib/i18n/server";
import { localizedTableLabel } from "@/lib/i18n/content";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getTranslator();
  return { title: `${t("nav.orders")} ${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant(["owner", "manager", "waiter", "kitchen"]);
  const { id } = await params;

  const order = await getOrder(tenant.user, tenant.restaurantId, id);
  if (!order) notFound();

  const { t } = await getTranslator();
  const currency = order.currency || tenant.currency;

  const timeline = [
    { labelKey: "status.placed", at: order.created_at },
    { labelKey: "status.accepted", at: order.accepted_at },
    { labelKey: "status.preparing", at: order.preparing_at },
    { labelKey: "status.ready", at: order.ready_at },
    { labelKey: "status.served", at: order.served_at },
    { labelKey: "status.rejected", at: order.rejected_at },
  ].filter((entry) => entry.at);

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={15000} />
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/orders" className="inline-flex items-center gap-1 hover:text-ink-700">
            <ArrowLeft className="size-3" aria-hidden /> {t("orders.title")}
          </Link>
        }
        title={`${t("orders.title")} ${order.order_number}`}
        description={`${localizedTableLabel(order.table_label) || t("unit.counter")} · ${timeAgo(order.created_at)} — ${formatDateTime(order.created_at, tenant.timeZone)}`}
        actions={
          <>
            <OrderStatusBadge status={order.status} label={t(ORDER_STATUS_KEY[order.status] ?? order.status)} />
            {order.payment_status === "paid" ? <Badge tone="moss">{t("billing.paid")}</Badge> : <Badge tone="neutral">{t("billing.payAtCounter")}</Badge>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("orders.items")} description={t("orders.itemsHint", { count: formatNumber(order.item_count) })} />
            <CardBody className="pt-0">
              <ul className="divide-y divide-ink-100">
                {order.items.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink-800">
                        <span className="mr-1.5 inline-flex min-w-5 justify-center rounded bg-ink-100 px-1 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
                          {formatNumber(line.quantity)}×
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
                      <p className="text-[11px] text-ink-400">{t("orders.eachPrice", { price: formatMoney(line.unit_price, currency) })}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-[12.5px]">
                <Row label={t("billing.subtotal")} value={formatMoney(order.subtotal, currency)} />
                {Number(order.service_charge) > 0 ? <Row label={t("billing.serviceCharge")} value={formatMoney(order.service_charge, currency)} /> : null}
                {Number(order.tax_amount) > 0 ? <Row label={t("billing.tax")} value={formatMoney(order.tax_amount, currency)} /> : null}
                <div className="flex items-center justify-between border-t border-ink-100 pt-1.5">
                  <dt className="text-[13px] font-semibold text-ink-900">{t("billing.total")}</dt>
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
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-clay-700">{t("orders.guestNote")}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-800">{order.note}</p>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t("orders.timeline")} description={t("orders.timelineHint")} />
            <CardBody className="pt-0">
              <ol className="relative space-y-3 border-l border-ink-200 pl-4">
                {order.history.map((entry, index) => (
                  <li key={`${entry.to_status}-${index}`} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-clay-400 ring-2 ring-white" aria-hidden />
                    <p className="text-[12.5px] font-medium text-ink-800">{t(ORDER_STATUS_KEY[entry.to_status] ?? entry.to_status)}</p>
                    <p className="text-[11.5px] text-ink-400">
                      {formatDateTime(entry.created_at, tenant.timeZone)}
                      {entry.actor_role ? ` · ${entry.actor_role}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t("orders.nextStep")} description={t("orders.nextStepHint")} />
            <CardBody className="pt-0">
              <OrderActions
                orderId={order.id}
                restaurantId={tenant.restaurantId}
                status={order.status}
                role={tenant.role}
                etaCurrent={order.eta_minutes}
                fullWidth
              />
              {order.status === "rejected" && order.rejection_reason ? (
                <p className="mt-3 rounded-md bg-red-50 px-2.5 py-2 text-[12px] text-red-700 ring-1 ring-inset ring-red-200">
                  {t("status.rejected")}: {order.rejection_reason}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("orders.guest")} />
            <CardBody className="space-y-2.5 pt-0">
              <Detail icon={<User className="size-3.5" aria-hidden />} label={t("orders.name")} value={order.customer_name ?? t("orders.notProvided")} />
              <Detail icon={<Receipt className="size-3.5" aria-hidden />} label={t("orders.phone")} value={order.customer_phone ?? t("orders.notProvided")} />
              <Detail icon={<CreditCard className="size-3.5" aria-hidden />} label={t("orders.payment")} value={order.payment_status === "paid" ? t("billing.paid") : t("billing.dueAtCounter")} />
              <Detail icon={<Clock3 className="size-3.5" aria-hidden />} label={t("orders.table")} value={localizedTableLabel(order.table_label) || t("unit.counter")} />
              <Detail
                icon={<Clock3 className="size-3.5" aria-hidden />}
                label={t("orders.eta")}
                value={order.eta_minutes ? t("orders.minutes", { count: formatNumber(order.eta_minutes) }) : t("orders.notSet")}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("orders.session")} description={t("orders.sessionHint")} />
            <CardBody className="pt-0">
              <dl className="space-y-1.5 text-[12px]">
                <Row label={t("orders.signedInAs")} value={tenant.user.email} />
                <Row label={t("staff.role")} value={t(`staff.role.${tenant.role}`)} />
                <Row label={t("staff.restaurant")} value={tenant.restaurantName} />
              </dl>
            </CardBody>
          </Card>

          <div className="flex gap-2">
            <LinkButton href="/dashboard/orders" variant="secondary" size="sm" fullWidth>{t("orders.title")}</LinkButton>
          </div>
        </div>
      </div>

      {timeline.length > 1 ? (
        <p className="text-[11.5px] text-ink-400">
          {t("orders.timeline")}: {timeline.map((entry) => `${t(entry.labelKey)} ${formatDateTime(entry.at!, tenant.timeZone)}`).join(" → ")}
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
