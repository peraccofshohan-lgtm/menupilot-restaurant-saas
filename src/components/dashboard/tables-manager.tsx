"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, EyeOff, Plus, Printer, QrCode, RotateCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, Input, cx } from "@/components/ui";
import type { DiningTable } from "@/lib/services/tables";
import {
  createTableAction,
  deleteTableAction,
  regenerateQrAction,
  toggleTableAction,
} from "@/lib/actions/tenant";
import type { ActionState } from "@/lib/actions/types";

function AddTableForm({ restaurantId, onDone }: { restaurantId: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    const result = await createTableAction({ status: "idle" }, new FormData(form));
    setPending(false);
    if (result.status === "success") {
      setMessage(result.message ?? "Table added.");
      setErrors({});
      form.reset();
      router.refresh();
      setTimeout(onDone, 700);
    } else {
      setErrors(result.errors ?? {});
      setMessage(result.message ?? "Could not add the table.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <Field label="Table label" htmlFor="table-label" required error={errors.label} hint="For example “Table 21” or “Terrace A”.">
        <Input id="table-label" name="label" required placeholder={`Table ${String(Math.floor(Math.random() * 20) + 21).padStart(2, "0")}`} invalid={Boolean(errors.label)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zone" htmlFor="table-zone" hint="Optional. Ground floor, terrace…">
          <Input id="table-zone" name="zone" placeholder="Ground floor" />
        </Field>
        <Field label="Seats" htmlFor="table-seats" error={errors.seats}>
          <Input id="table-seats" name="seats" type="number" min={1} max={40} defaultValue={4} />
        </Field>
      </div>
      {message ? (
        <p className={cx("rounded-md px-2.5 py-2 text-[12px] ring-1 ring-inset", errors.label ? "bg-red-50 text-red-700 ring-red-200" : "bg-moss-50 text-moss-700 ring-moss-100")}>
          {message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending} size="sm">
          <Plus className="size-3.5" aria-hidden /> Add table
        </Button>
      </div>
    </form>
  );
}

export function TablesManager({
  restaurantId,
  restaurantName,
  tables,
  qrMap,
}: {
  restaurantId: string;
  restaurantName: string;
  tables: DiningTable[];
  qrMap: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ tone: "success" | "error"; message: string } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function run(key: string, action: () => Promise<ActionState>) {
    setPending(key);
    const result = await action();
    setPending(null);
    setToast({ tone: result.status === "success" ? "success" : "error", message: result.message ?? "Done." });
    if (result.status === "success") router.refresh();
  }

  return (
    <div className="space-y-3">
      {toast ? (
        <div
          className={cx(
            "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-[12.5px] font-medium shadow-[var(--shadow-lift)]",
            toast.tone === "success" ? "bg-moss-600 text-white" : "bg-red-600 text-white",
          )}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => {
          const svg = qrMap[table.id];
          return (
            <Card key={table.id} className={cx("p-3.5", !table.is_active && "border-dashed bg-ink-50/60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-ink-900">{table.label}</p>
                  <p className="text-[11.5px] text-ink-400">
                    {table.zone ? `${table.zone} · ` : ""}{table.seats} seats
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {table.is_active ? (
                    <Badge tone="moss" dot>Active</Badge>
                  ) : (
                    <Badge tone="neutral">Inactive</Badge>
                  )}
                  {table.open_orders > 0 ? <Badge tone="amber">{table.open_orders} open</Badge> : null}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-3">
                <div className={cx("size-20 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-white p-1", !table.is_active && "opacity-40")}>
                  {svg ? (
                    <div className="size-full [&>svg]:size-full" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
                  ) : (
                    <span className="grid size-full place-items-center text-ink-300"><QrCode className="size-5" aria-hidden /></span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-relaxed text-ink-400">
                    {table.qr_token ? (
                      <>
                        Token <span className="font-mono text-[10px] text-ink-500">{table.qr_token.slice(0, 10)}…</span>
                        <br />
                        <span className="text-ink-400">points to /q/&lt;token&gt;</span>
                      </>
                    ) : (
                      "No active QR code"
                    )}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <a
                      href={`/api/qr/${table.id}?format=png`}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                    >
                      <Download className="size-3" aria-hidden /> PNG
                    </a>
                    <a
                      href={`/api/qr/${table.id}?format=svg`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 bg-white px-1.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
                    >
                      SVG
                    </a>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-ink-100 pt-2">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void run(`toggle-${table.id}`, () => toggleTableAction(restaurantId, table.id, !table.is_active))}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-40"
                >
                  {table.is_active ? <EyeOff className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
                  {table.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    if (!window.confirm(`Generate a new QR for ${table.label}? The printed code on that table will stop working immediately.`)) return;
                    void run(`rotate-${table.id}`, () => regenerateQrAction(restaurantId, table.id));
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-40"
                >
                  <RotateCw className={cx("size-3", pending === `rotate-${table.id}` && "animate-spin")} aria-hidden /> New QR
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    if (!window.confirm(`Delete ${table.label}? This removes its QR code and cannot be undone.`)) return;
                    void run(`delete-${table.id}`, () => deleteTableAction(restaurantId, table.id));
                  }}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                  aria-label={`Delete ${table.label}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <p className="text-[13px] font-semibold text-ink-800">Printable sheet</p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          {restaurantName}: a four-per-page layout, ready to cut and place.
        </p>
        <a
          href="/dashboard/tables/print"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 text-[12px] font-medium text-ink-700 hover:bg-ink-50"
        >
          <Printer className="size-3.5" aria-hidden /> Open print sheet
        </a>
      </Card>
    </div>
  );
}

export function AddTableButton({ restaurantId }: { restaurantId: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> Add table
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4" role="dialog" aria-modal="true" aria-label="Add a table">
          <Card className="w-full max-w-sm p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="text-[14px] font-semibold text-ink-900">Add a table</h2>
                <p className="text-[12px] text-ink-500">A secure QR code is generated automatically.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-[12px] font-medium text-ink-500 hover:text-ink-800">
                Close
              </button>
            </div>
            <AddTableForm restaurantId={restaurantId} onDone={() => setOpen(false)} />
          </Card>
        </div>
      ) : null}
    </>
  );
}
