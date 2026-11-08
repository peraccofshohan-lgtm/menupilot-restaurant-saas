"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  MoreHorizontal,
  PackageX,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
  cx,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { Category, MenuData, MenuItem } from "@/lib/services/menu";
import {
  archiveMenuItemAction,
  deleteCategoryAction,
  deleteMenuItemAction,
  reorderCategoriesAction,
  reorderMenuItemsAction,
  saveCategoryAction,
  saveMenuItemAction,
  toggleCategoryAction,
  toggleMenuItemAction,
} from "@/lib/actions/menu";
import { initialActionState, type ActionState } from "@/lib/actions/types";

/* ==========================================================================
   Menu workspace: one screen for categories and dishes.
   All writes go through server actions; the UI only ever shows a hint of what
   the server will re-check.
   ========================================================================== */

export function MenuWorkspace({
  data,
  currency,
  canEdit,
}: {
  data: MenuData;
  currency: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [showArchived, setShowArchived] = React.useState(false);
  const [editor, setEditor] = React.useState<{ mode: "create" | "edit"; item?: MenuItem } | null>(null);
  const [categoryEditor, setCategoryEditor] = React.useState<{ mode: "create" | "edit"; category?: Category } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: "success" | "error"; message: string } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function run(action: () => Promise<ActionState>) {
    setPending(true);
    const result = await action();
    setPending(false);
    setToast({ tone: result.status === "success" ? "success" : "error", message: result.message ?? "Done." });
    if (result.status === "success") router.refresh();
    return result;
  }

  const items = data.items.filter((item) => {
    if (!showArchived && item.is_archived) return false;
    if (categoryFilter !== "all" && item.category_id !== categoryFilter) return false;
    if (query.trim()) {
      const needle = query.toLowerCase();
      return item.name.toLowerCase().includes(needle) || (item.description ?? "").toLowerCase().includes(needle);
    }
    return true;
  });

  const availableCount = data.items.filter((item) => item.is_available && !item.is_archived).length;

  return (
    <div className="space-y-4">
      {toast ? (
        <div
          className={cx(
            "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-[12.5px] font-medium shadow-[var(--shadow-lift)] ring-1 ring-inset",
            toast.tone === "success" ? "bg-moss-600 text-white ring-moss-700" : "bg-red-600 text-white ring-red-700",
          )}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[268px_1fr]">
        <Card className="h-fit p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Categories</p>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setCategoryEditor({ mode: "create" })}
                className="grid size-6 place-items-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                aria-label="Add category"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setCategoryFilter("all")}
            className={cx(
              "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium",
              categoryFilter === "all" ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50",
            )}
          >
            All dishes <span className="tabular-nums opacity-70">{data.items.filter((i) => !i.is_archived).length}</span>
          </button>
          <ul className="mt-1 space-y-0.5">
            {data.categories.map((category, index) => (
              <li key={category.id} className="group">
                <div
                  className={cx(
                    "flex items-center gap-1 rounded-lg pr-1",
                    categoryFilter === category.id ? "bg-clay-50 ring-1 ring-inset ring-clay-200" : "hover:bg-ink-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(category.id)}
                    className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                  >
                    <span className={cx("block truncate text-[12.5px] font-medium", categoryFilter === category.id ? "text-clay-800" : "text-ink-700")}>
                      {category.name}
                    </span>
                    <span className="block text-[10.5px] text-ink-400">
                      {category.item_count} dish{category.item_count === 1 ? "" : "es"}
                      {!category.is_active ? " · hidden" : ""}
                    </span>
                  </button>
                  {canEdit ? (
                    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton label={`Move ${category.name} up`} disabled={index === 0 || pending} onClick={() => {
                        const ids = data.categories.map((c) => c.id);
                        const target = index - 1;
                        if (target < 0) return;
                        [ids[index], ids[target]] = [ids[target]!, ids[index]!];
                        void run(() => reorderCategoriesAction(ids));
                      }}>
                        <ArrowUp className="size-3" aria-hidden />
                      </IconButton>
                      <IconButton label={`Move ${category.name} down`} disabled={index === data.categories.length - 1 || pending} onClick={() => {
                        const ids = data.categories.map((c) => c.id);
                        const target = index + 1;
                        if (target >= ids.length) return;
                        [ids[index], ids[target]] = [ids[target]!, ids[index]!];
                        void run(() => reorderCategoriesAction(ids));
                      }}>
                        <ArrowDown className="size-3" aria-hidden />
                      </IconButton>
                      <IconButton label={category.is_active ? `Hide ${category.name}` : `Show ${category.name}`} disabled={pending} onClick={() => void run(() => toggleCategoryAction(category.id, !category.is_active))}>
                        {category.is_active ? <Eye className="size-3" aria-hidden /> : <EyeOff className="size-3" aria-hidden />}
                      </IconButton>
                      <IconButton label={`Edit ${category.name}`} disabled={pending} onClick={() => setCategoryEditor({ mode: "edit", category })}>
                        <Pencil className="size-3" aria-hidden />
                      </IconButton>
                      <IconButton label={`Delete ${category.name}`} disabled={pending} onClick={() => {
                        if (!window.confirm(`Delete “${category.name}”? Dishes must be moved first.`)) return;
                        void run(() => deleteCategoryAction(category.id));
                      }}>
                        <Trash2 className="size-3 text-red-500" aria-hidden />
                      </IconButton>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {data.categories.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-400">No categories yet.</p>
          ) : null}
        </Card>

        <div className="space-y-3">
          <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search dishes"
                aria-label="Search dishes"
                className="h-9 w-full rounded-lg border border-ink-200 bg-white pl-8 pr-3 text-[13px] focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-ink-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                  className="size-3.5 rounded border-ink-300 text-clay-600"
                />
                Archived
              </label>
              {canEdit ? (
                <Button size="sm" onClick={() => setEditor({ mode: "create" })} disabled={data.categories.length === 0}>
                  <Plus className="size-3.5" aria-hidden /> Add dish
                </Button>
              ) : null}
            </div>
          </Card>

          <div className="flex flex-wrap gap-2 text-[12px] text-ink-500">
            <Badge tone="neutral">{data.items.filter((i) => !i.is_archived).length} live dishes</Badge>
            <Badge tone="moss">{availableCount} available</Badge>
            <Badge tone="amber">{data.items.filter((i) => !i.is_available && !i.is_archived).length} unavailable</Badge>
            <Badge tone="clay">{data.items.filter((i) => i.is_featured && !i.is_archived).length} featured</Badge>
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ImagePlus className="size-4" aria-hidden />}
                title={query ? "No dishes match that search" : "No dishes here yet"}
                description={
                  query
                    ? "Try a different name, or clear the search."
                    : data.categories.length === 0
                      ? "Create a category first, then add your dishes to it."
                      : "Add your first dish with a price and a photograph."
                }
                action={
                  canEdit && data.categories.length > 0 ? (
                    <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
                      <Plus className="size-3.5" aria-hidden /> Add dish
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <li key={item.id}>
                  <Card className={cx("group h-full overflow-hidden", item.is_archived && "opacity-60")}>
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-100">
                      {item.image_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/media/menu/${item.image_path}`}
                          alt={item.name}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid size-full place-items-center text-ink-300">
                          <ImagePlus className="size-6" aria-hidden />
                        </div>
                      )}
                      <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                        {item.is_featured ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-clay-700 ring-1 ring-inset ring-clay-200">
                            <Star className="size-2.5" aria-hidden /> Featured
                          </span>
                        ) : null}
                        {!item.is_available ? (
                          <span className="rounded-full bg-ink-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">Unavailable</span>
                        ) : null}
                        {item.is_archived ? (
                          <span className="rounded-full bg-ink-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">Archived</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-ink-900">{item.name}</p>
                          <p className="text-[11px] text-ink-400">{item.category_name}</p>
                        </div>
                        <p className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-900">{formatMoney(item.price, currency)}</p>
                      </div>
                      {item.description ? (
                        <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-500">{item.description}</p>
                      ) : null}
                      {canEdit ? (
                        <div className="mt-2.5 flex items-center gap-1 border-t border-ink-100 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditor({ mode: "edit", item })}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-600 hover:bg-ink-100"
                          >
                            <Pencil className="size-3" aria-hidden /> Edit
                          </button>
                          <button
                            type="button"
                            disabled={pending || item.is_archived}
                            onClick={() => void run(() => toggleMenuItemAction(item.id, !item.is_available))}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-40"
                          >
                            {item.is_available ? <EyeOff className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
                            {item.is_available ? "Sold out" : "Available"}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (!window.confirm(item.is_archived ? `Restore “${item.name}”?` : `Archive “${item.name}”? Guests will stop seeing it.`)) return;
                              void run(() => archiveMenuItemAction(item.id, !item.is_archived));
                            }}
                            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-500 hover:bg-ink-100"
                          >
                            <PackageX className="size-3" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (!window.confirm(`Delete “${item.name}” permanently? Dishes already ordered are archived instead so receipts stay accurate.`)) return;
                              void run(() => deleteMenuItemAction(item.id));
                            }}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-red-600 hover:bg-red-50"
                            aria-label={`Delete ${item.name}`}
                          >
                            <Trash2 className="size-3" aria-hidden />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editor ? (
        <ItemEditor
          mode={editor.mode}
          item={editor.item}
          categories={data.categories}
          currency={currency}
          onClose={() => setEditor(null)}
          onSaved={(message, tone) => {
            setToast({ tone, message });
            if (tone === "success") {
              setEditor(null);
              router.refresh();
            }
          }}
        />
      ) : null}

      {categoryEditor ? (
        <CategoryEditor
          mode={categoryEditor.mode}
          category={categoryEditor.category}
          nextSortOrder={data.categories.length}
          onClose={() => setCategoryEditor(null)}
          onSaved={(message, tone) => {
            setToast({ tone, message });
            if (tone === "success") {
              setCategoryEditor(null);
              router.refresh();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid size-6 place-items-center rounded text-ink-400 hover:bg-white hover:text-ink-700 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Modal({ title, description, onClose, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-[var(--shadow-lift)] sm:rounded-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3">
          <div>
            <h2 className="text-[14.5px] font-semibold text-ink-900">{title}</h2>
            {description ? <p className="text-[12px] text-ink-500">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function useActionStateCompat() {
  const [state, setState] = React.useState<ActionState>(initialActionState);
  const [pending, setPending] = React.useState(false);

  async function submit(
    action: (prev: ActionState, formData: FormData) => Promise<ActionState>,
    form: HTMLFormElement,
  ) {
    setPending(true);
    const formData = new FormData(form);
    const result = await action(initialActionState, formData);
    setPending(false);
    setState(result);
    return result;
  }

  return { state, pending, submit, setState };
}

function ItemEditor({
  mode,
  item,
  categories,
  currency,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  item?: MenuItem;
  categories: Category[];
  currency: string;
  onClose: () => void;
  onSaved: (message: string, tone: "success" | "error") => void;
}) {
  const { state, pending, submit } = useActionStateCompat();
  const [imagePath, setImagePath] = React.useState(item?.image_path ?? "");
  const [imageUrl, setImageUrl] = React.useState(item?.image_path ? `/api/media/menu/${item.image_path}` : "");
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    const body = new FormData();
    body.set("file", file);
    if (item?.id) body.set("itemId", item.id);
    try {
      const res = await fetch("/api/uploads/menu", { method: "POST", body });
      const data = (await res.json()) as { ok: boolean; path?: string; url?: string; error?: string };
      if (!data.ok) {
        setUploadError(data.error ?? "Upload failed.");
      } else {
        setImagePath(data.path ?? "");
        setImageUrl(data.url ?? "");
      }
    } catch {
      setUploadError("Network problem during upload. Try a smaller image.");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await submit(saveMenuItemAction, form);
    if (result.status === "success") onSaved(result.message ?? "Saved.", "success");
    else onSaved(result.message ?? "Could not save this dish.", "error");
  }

  return (
    <Modal
      title={mode === "create" ? "Add a dish" : "Edit dish"}
      description="Prices are in the restaurant currency and shown to guests exactly as entered."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
        {item ? <input type="hidden" name="id" value={item.id} /> : null}
        <input type="hidden" name="image_path" value={imagePath} />

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-700">Photograph</p>
          <div className="flex items-center gap-3">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-ink-50">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-ink-300"><ImagePlus className="size-5" aria-hidden /></span>
              )}
            </div>
            <div className="flex-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
              />
              <Button type="button" size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                {imageUrl ? "Replace image" : "Upload image"}
              </Button>
              {imagePath ? (
                <button
                  type="button"
                  onClick={() => {
                    setImagePath("");
                    setImageUrl("");
                  }}
                  className="ml-2 text-[11.5px] font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              ) : null}
              <p className="mt-1 text-[11px] text-ink-400">JPEG, PNG or WebP · up to 5 MB</p>
              {uploadError ? <p className="mt-1 text-[11.5px] text-red-600" role="alert">{uploadError}</p> : null}
            </div>
          </div>
        </div>

        <Field label="Dish name" htmlFor="item-name" required error={state.errors?.name}>
          <Input id="item-name" name="name" defaultValue={item?.name ?? ""} required invalid={Boolean(state.errors?.name)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="item-category" required error={state.errors?.category_id}>
            <Select id="item-category" name="category_id" defaultValue={item?.category_id ?? categories[0]?.id ?? ""} required>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={`Price (${currency})`} htmlFor="item-price" required error={state.errors?.price}>
            <Input id="item-price" name="price" type="number" min={0} step="0.01" defaultValue={item?.price ?? ""} required invalid={Boolean(state.errors?.price)} />
          </Field>
        </div>

        <Field label="Description" htmlFor="item-description" error={state.errors?.description} hint="Two short sentences. What is in it, and why should they order it?">
          <Textarea id="item-description" name="description" defaultValue={item?.description ?? ""} maxLength={600} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prep time (minutes)" htmlFor="item-prep" error={state.errors?.prep_minutes}>
            <Input id="item-prep" name="prep_minutes" type="number" min={0} max={240} defaultValue={item?.prep_minutes ?? 15} />
          </Field>
          <div className="space-y-1.5 pt-1.5">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
              <input type="checkbox" name="is_available" value="true" defaultChecked={item ? item.is_available : true} className="size-3.5 rounded border-ink-300 text-clay-600" />
              Available to order
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
              <input type="checkbox" name="is_featured" value="true" defaultChecked={item?.is_featured ?? false} className="size-3.5 rounded border-ink-300 text-clay-600" />
              Feature at the top of the menu
            </label>
          </div>
        </div>

        {state.status === "error" && state.message ? (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-[12px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">{state.message}</p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending}>{mode === "create" ? "Add dish" : "Save changes"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CategoryEditor({
  mode,
  category,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  category?: Category;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: (message: string, tone: "success" | "error") => void;
}) {
  const { state, pending, submit } = useActionStateCompat();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await submit(saveCategoryAction, event.currentTarget);
    if (result.status === "success") onSaved(result.message ?? "Saved.", "success");
    else onSaved(result.message ?? "Could not save this category.", "error");
  }

  return (
    <Modal
      title={mode === "create" ? "New category" : "Edit category"}
      description="Categories group dishes on the guest menu, in the order shown here."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <input type="hidden" name="sort_order" value={category?.sort_order ?? nextSortOrder} />
        <input type="hidden" name="is_active" value={category ? String(category.is_active) : "true"} />
        <Field label="Name" htmlFor="category-name" required error={state.errors?.name}>
          <Input id="category-name" name="name" defaultValue={category?.name ?? ""} required invalid={Boolean(state.errors?.name)} />
        </Field>
        <Field label="Description" htmlFor="category-description" error={state.errors?.description}>
          <Input id="category-description" name="description" defaultValue={category?.description ?? ""} maxLength={400} />
        </Field>
        {state.status === "error" && state.message ? (
          <p className="rounded-md bg-red-50 px-2.5 py-2 text-[12px] text-red-700 ring-1 ring-inset ring-red-200" role="alert">{state.message}</p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" loading={pending}>{mode === "create" ? "Create category" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function MenuWorkspaceFooter({ itemCount }: { itemCount: number }) {
  return (
    <p className="text-[11.5px] text-ink-400">
      {itemCount} dishes in this restaurant. Availability changes take effect on the guest menu immediately.
      <MoreHorizontal className="ml-1 inline size-3" aria-hidden />
    </p>
  );
}
