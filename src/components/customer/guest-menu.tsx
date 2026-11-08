"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChefHat,
  Clock3,
  Info,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { PublicMenu } from "@/lib/services/orders";
import { cartCount, useCart } from "@/lib/customer/cart";
import { cx } from "@/components/ui";

/**
 * Guest menu.
 *
 * Mobile-first, engineered for a phone held in one hand at a table. Prices shown
 * come from the server payload; the cart stores only ids and quantities, so a
 * tampered client cannot influence what the guest is charged.
 */
export function GuestMenu({ menu, qrToken }: { menu: PublicMenu; qrToken: string | null }) {
  const { lines, add, setQuantity, hydrateFor } = useCart();
  const [query, setQuery] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<string>("all");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [availableOnly, setAvailableOnly] = React.useState(false);
  const [flash, setFlash] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (qrToken) hydrateFor(qrToken);
  }, [qrToken, hydrateFor]);

  React.useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(timer);
  }, [flash]);

  const currency = menu.restaurant.currency;
  const count = cartCount(lines);
  const cartSubtotal = lines.reduce((sum, line) => {
    const item = menu.items.find((entry) => entry.id === line.menuItemId);
    return sum + (item ? Number(item.price) * line.quantity : 0);
  }, 0);

  const filtered = menu.items.filter((item) => {
    if (availableOnly && !item.is_available) return false;
    if (activeCategory !== "all" && item.category_id !== activeCategory) return false;
    if (query.trim()) {
      const needle = query.toLowerCase();
      return item.name.toLowerCase().includes(needle) || (item.description ?? "").toLowerCase().includes(needle);
    }
    return true;
  });

  const detailItem = detailId ? menu.items.find((item) => item.id === detailId) ?? null : null;
  const featured = menu.items.filter((item) => item.is_featured && item.is_available).slice(0, 4);
  const orderingEnabled = Boolean(qrToken) && menu.settings.accept_orders;

  function addItem(id: string, quantity = 1, note?: string) {
    add(id, quantity, note);
    const item = menu.items.find((entry) => entry.id === id);
    setFlash(item ? `${item.name} added` : "Added to your order");
  }

  return (
    <div className="min-h-dvh bg-white pb-28">
      {/* Cover */}
      <div className="relative h-44 w-full overflow-hidden bg-ink-800 sm:h-56">
        {menu.restaurant.cover_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/branding/${menu.restaurant.cover_path}`} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full bg-ink-800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/25 to-ink-900/10" />
        <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-2xl items-end gap-3 px-4 pb-4">
          {menu.restaurant.logo_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/media/branding/${menu.restaurant.logo_path}`}
              alt={`${menu.restaurant.name} logo`}
              className="size-14 shrink-0 rounded-xl border border-white/20 object-cover shadow-sm"
            />
          ) : null}
          <div className="min-w-0 pb-0.5">
            <h1 className="truncate text-xl font-semibold text-white">{menu.restaurant.name}</h1>
            {menu.restaurant.tagline ? (
              <p className="truncate text-[12.5px] text-white/75">{menu.restaurant.tagline}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4">
        {/* Context strip */}
        <div className="-mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-2 shadow-[var(--shadow-card)]">
          {menu.table ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-moss-50 px-2 py-1 text-[11.5px] font-semibold text-moss-700 ring-1 ring-inset ring-moss-100">
              <Users className="size-3" aria-hidden /> {menu.table.label}
              {menu.table.zone ? <span className="font-normal text-moss-600">· {menu.table.zone}</span> : null}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-100 px-2 py-1 text-[11.5px] font-medium text-ink-600">
              <Info className="size-3" aria-hidden /> Browse only — scan your table code to order
            </span>
          )}
          {qrToken ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2 py-1 text-[11.5px] text-ink-600">
              <ChefHat className="size-3" aria-hidden /> Sent to the kitchen once approved
            </span>
          ) : null}
          {menu.restaurant.phone ? (
            <a href={`tel:${menu.restaurant.phone}`} className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-clay-700 hover:bg-clay-50">
              Call
            </a>
          ) : null}
        </div>

        {menu.restaurant.description ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-600">{menu.restaurant.description}</p>
        ) : null}

        {/* Search */}
        <div className="sticky top-0 z-20 -mx-4 mt-4 bg-white/95 px-4 py-2 backdrop-blur-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dishes"
              aria-label="Search the menu"
              className="h-10 w-full rounded-xl border border-ink-200 bg-ink-50 pl-9 pr-9 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-clay-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-clay-500/25"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-400 hover:bg-ink-100"
                aria-label="Clear search"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            <CategoryChip active={activeCategory === "all"} onClick={() => setActiveCategory("all")}>
              All
            </CategoryChip>
            {menu.categories.map((category) => (
              <CategoryChip
                key={category.id}
                active={activeCategory === category.id}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.name}
              </CategoryChip>
            ))}
            <button
              type="button"
              onClick={() => setAvailableOnly((value) => !value)}
              className={cx(
                "ml-1 shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors",
                availableOnly ? "bg-moss-600 text-white ring-moss-600" : "bg-white text-ink-500 ring-ink-200",
              )}
              aria-pressed={availableOnly}
            >
              Available only
            </button>
          </div>
        </div>

        {flash ? (
          <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink-900 px-3.5 py-2 text-[12.5px] font-medium text-white shadow-[var(--shadow-lift)]" role="status">
            {flash}
          </div>
        ) : null}

        {/* Featured */}
        {featured.length > 0 && activeCategory === "all" && !query ? (
          <section className="mt-4" aria-label="Featured dishes">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
              <Sparkles className="size-3.5 text-clay-600" aria-hidden /> Chef's picks
            </h2>
            <div className="no-scrollbar mt-2 flex gap-2.5 overflow-x-auto pb-1">
              {featured.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDetailId(item.id)}
                  className="w-40 shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-white text-left shadow-[var(--shadow-card)]"
                >
                  <MenuImage path={item.image_path} alt={item.name} className="h-24 w-full" />
                  <div className="p-2">
                    <p className="truncate text-[12.5px] font-semibold text-ink-900">{item.name}</p>
                    <p className="text-[12px] font-medium text-clay-700">{formatMoney(item.price, currency)}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Menu */}
        <div className="mt-4 space-y-5">
          {menu.categories
            .filter((category) => activeCategory === "all" || category.id === activeCategory)
            .map((category) => {
              const items = filtered.filter((item) => item.category_id === category.id);
              if (items.length === 0) return null;
              return (
                <section key={category.id} aria-labelledby={`cat-${category.id}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id={`cat-${category.id}`} className="text-[15px] font-semibold text-ink-900">{category.name}</h2>
                    <span className="text-[11px] text-ink-400">{items.length} dishes</span>
                  </div>
                  {category.description ? <p className="mt-0.5 text-[12px] text-ink-500">{category.description}</p> : null}
                  <ul className="mt-2 divide-y divide-ink-100">
                    {items.map((item) => {
                      const line = lines.find((entry) => entry.menuItemId === item.id);
                      return (
                        <li key={item.id} className="flex gap-3 py-3">
                          <button
                            type="button"
                            onClick={() => setDetailId(item.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-start gap-1.5">
                              <p className={cx("text-[13.5px] font-semibold", item.is_available ? "text-ink-900" : "text-ink-400")}>
                                {item.name}
                              </p>
                              {item.is_featured ? <Sparkles className="mt-1 size-3 shrink-0 text-clay-500" aria-hidden /> : null}
                            </div>
                            {item.description ? (
                              <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink-500">{item.description}</p>
                            ) : null}
                            <div className="mt-1 flex items-center gap-2">
                              <p className={cx("text-[13px] font-semibold", item.is_available ? "text-ink-800" : "text-ink-400")}>
                                {formatMoney(item.price, currency)}
                              </p>
                              {!item.is_available ? (
                                <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">Sold out</span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[10.5px] text-ink-400">
                                  <Clock3 className="size-2.5" aria-hidden /> {item.prep_minutes} min
                                </span>
                              )}
                            </div>
                          </button>

                          <div className="relative w-24 shrink-0">
                            <button type="button" onClick={() => setDetailId(item.id)} className="block w-full">
                              <MenuImage path={item.image_path} alt={item.name} className={cx("h-20 w-full", !item.is_available && "opacity-50")} />
                            </button>
                            {line ? (
                              <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-ink-200 bg-white p-0.5 shadow-sm">
                                <button
                                  type="button"
                                  onClick={() => setQuantity(item.id, line.quantity - 1)}
                                  className="grid size-6 place-items-center rounded-full text-ink-600 hover:bg-ink-100"
                                  aria-label={`Remove one ${item.name}`}
                                >
                                  <Minus className="size-3" aria-hidden />
                                </button>
                                <span className="min-w-4 text-center text-[12px] font-semibold tabular-nums text-ink-900">{line.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => setQuantity(item.id, line.quantity + 1)}
                                  disabled={!item.is_available}
                                  className="grid size-6 place-items-center rounded-full text-clay-700 hover:bg-clay-50 disabled:opacity-40"
                                  aria-label={`Add one ${item.name}`}
                                >
                                  <Plus className="size-3" aria-hidden />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={!item.is_available}
                                onClick={() => addItem(item.id)}
                                className="absolute -bottom-2 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-ink-200 bg-white text-clay-700 shadow-sm transition-colors hover:bg-clay-50 disabled:cursor-not-allowed disabled:text-ink-300"
                                aria-label={`Add ${item.name} to your order`}
                              >
                                <Plus className="size-4" aria-hidden />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

          {filtered.length === 0 ? (
            <div className="py-14 text-center">
              <Search className="mx-auto size-5 text-ink-300" aria-hidden />
              <p className="mt-2 text-[13.5px] font-medium text-ink-700">Nothing matches that search</p>
              <p className="mt-0.5 text-[12.5px] text-ink-500">Try another dish name, or clear the filters.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setActiveCategory("all");
                  setAvailableOnly(false);
                }}
                className="mt-3 rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-50"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>

        <footer className="mt-10 border-t border-ink-100 pt-4 pb-6 text-center">
          <p className="text-[11px] text-ink-400">
            {menu.settings.tax_label} {Number(menu.settings.tax_rate)}% · {menu.settings.service_charge_label}{" "}
            {Number(menu.settings.service_charge_rate)}% applied at checkout. Payment at the counter.
          </p>
          <p className="mt-1 text-[10.5px] text-ink-300">Powered by MenuPilot</p>
        </footer>
      </div>

      {/* Cart bar */}
      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink-500">
                {count} item{count === 1 ? "" : "s"} · {formatMoney(cartSubtotal, currency)}
              </p>
              <p className="text-[10.5px] text-ink-400">
                {orderingEnabled ? "Taxes added at checkout" : "Scan a table code to order"}
              </p>
            </div>
            <Link
              href={qrToken ? `/menu/${menu.restaurant.slug}/cart?t=${encodeURIComponent(qrToken)}` : `/menu/${menu.restaurant.slug}/cart`}
              className={cx(
                "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[13.5px] font-semibold text-white",
                orderingEnabled ? "bg-clay-600 hover:bg-clay-700" : "pointer-events-none bg-ink-300",
              )}
              aria-disabled={!orderingEnabled}
            >
              <ShoppingBag className="size-4" aria-hidden /> Review order
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}

      {detailItem ? (
        <ItemSheet
          item={detailItem}
          currency={currency}
          line={lines.find((entry) => entry.menuItemId === detailItem.id)}
          onClose={() => setDetailId(null)}
          onAdd={(quantity, note) => {
            addItem(detailItem.id, quantity, note);
            setDetailId(null);
          }}
          onQuantity={(quantity) => setQuantity(detailItem.id, quantity)}
          orderingEnabled={orderingEnabled}
        />
      ) : null}

    </div>
  );
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors",
        active ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
      )}
    >
      {children}
    </button>
  );
}

function MenuImage({ path, alt, className }: { path: string | null; alt: string; className?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-lg bg-ink-100", className)}>
      {path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/menu/${path}`} alt={alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-ink-300">
          <ChefHat className="size-5" aria-hidden />
        </div>
      )}
    </div>
  );
}

function ItemSheet({
  item,
  currency,
  line,
  onClose,
  onAdd,
  onQuantity,
  orderingEnabled,
}: {
  item: PublicMenu["items"][number];
  currency: string;
  line?: { quantity: number; note?: string };
  onClose: () => void;
  onAdd: (quantity: number, note?: string) => void;
  onQuantity: (quantity: number) => void;
  orderingEnabled: boolean;
}) {
  const [quantity, setQuantity] = React.useState(line?.quantity ?? 1);
  const [note, setNote] = React.useState(line?.note ?? "");

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50" role="dialog" aria-modal="true" aria-label={item.name}>
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close" />
      <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white">
        <div className="relative">
          <MenuImage path={item.image_path} alt={item.name} className="h-52 w-full rounded-none" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-white/95 text-ink-700 shadow-sm"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="p-4 pb-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[17px] font-semibold leading-snug text-ink-900">{item.name}</h2>
            <p className="shrink-0 text-[16px] font-semibold tabular-nums text-ink-900">{formatMoney(item.price, currency)}</p>
          </div>
          {item.description ? <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">{item.description}</p> : null}
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-ink-400">
            <Clock3 className="size-3" aria-hidden /> About {item.prep_minutes} minutes
            {!item.is_available ? (
              <span className="rounded-full bg-ink-100 px-1.5 py-0.5 font-medium text-ink-500">Sold out</span>
            ) : null}
          </div>

          {item.is_available && orderingEnabled ? (
            <>
              <div className="mt-4">
                <label htmlFor="item-note" className="text-[12.5px] font-medium text-ink-700">
                  Special instructions <span className="font-normal text-ink-400">(optional)</span>
                </label>
                <textarea
                  id="item-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value.slice(0, 200))}
                  rows={2}
                  placeholder="No onion, extra spicy, sauce on the side…"
                  className="mt-1 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-[13px] text-ink-800 placeholder:text-ink-400 focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
                />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="inline-flex items-center rounded-xl border border-ink-200 p-1">
                  <button
                    type="button"
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                    className="grid size-8 place-items-center rounded-lg text-ink-600 hover:bg-ink-100"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span className="min-w-8 text-center text-[14px] font-semibold tabular-nums text-ink-900">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((value) => Math.min(99, value + 1))}
                    className="grid size-8 place-items-center rounded-lg text-ink-600 hover:bg-ink-100"
                    aria-label="Increase quantity"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => (line ? onQuantity(quantity) : onAdd(quantity, note.trim() || undefined))}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-clay-600 px-4 text-[13.5px] font-semibold text-white hover:bg-clay-700"
                >
                  {line ? "Update order" : "Add to order"} · {formatMoney(Number(item.price) * quantity, currency)}
                </button>
              </div>
              {line ? (
                <button
                  type="button"
                  onClick={() => {
                    onQuantity(0);
                    onClose();
                  }}
                  className="mt-2 w-full text-center text-[12px] font-medium text-red-600 hover:underline"
                >
                  Remove from order
                </button>
              ) : null}
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-600 ring-1 ring-inset ring-ink-100">
              {item.is_available
                ? "Scan the QR code on your table to order this dish."
                : "This dish is unavailable right now. Please ask your server for an alternative."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
