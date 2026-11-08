"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye, EyeOff, MessageSquare, Star } from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { ReviewRow } from "@/lib/services/reviews";

/**
 * Review moderation for the owner.
 *
 * Two rules are visible in the UI because they are true in the database:
 * a hidden review is still counted internally (the row is never deleted), and
 * replying is an edit of one reply, not a thread.
 */

function Stars({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cx(
            size === "sm" ? "size-3" : "size-3.5",
            star <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-ink-300",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

const SCORE_LABEL: Record<string, string> = {
  taste: "Taste",
  quality: "Quality",
  presentation: "Presentation",
  service: "Service",
  staff: "Staff",
  cleanliness: "Cleanliness",
};

export function ReviewManager({
  restaurantId,
  reviews,
}: {
  restaurantId: string;
  reviews: ReviewRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [replyBody, setReplyBody] = React.useState("");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  async function act(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/reviews/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restaurantId, ...payload }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "That change could not be saved.");
        return;
      }
      setReplyTo(null);
      setReplyBody("");
      router.refresh();
    } catch {
      setError("Network problem — nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white p-10 text-center">
        <Star className="mx-auto size-5 text-ink-300" aria-hidden />
        <p className="mt-2 text-[13.5px] font-medium text-ink-700">No reviews yet</p>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Guests can review each dish and the visit once their order has been served.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {reviews.map((review) => {
        const isOpen = expanded === review.id;
        const scores = Object.entries(review.scores ?? {}).filter(([, value]) => value);
        return (
          <article
            key={review.id}
            className={cx(
              "rounded-[var(--radius-card)] border bg-white p-3.5 shadow-[var(--shadow-card)]",
              review.is_hidden ? "border-ink-200 bg-ink-50/60" : "border-ink-200",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars value={review.rating} />
                  <span className="text-[11px] font-medium text-ink-500">
                    {review.kind === "item" ? review.item_name ?? "Dish" : "Visit overall"}
                  </span>
                  {review.is_hidden ? (
                    <span className="rounded-full bg-ink-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">
                      Hidden
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-ink-400">
                  {review.order_number}
                  {review.table_label ? ` · ${review.table_label}` : ""}
                  {review.guest_name ? ` · ${review.guest_name}` : ""}
                  {" · "}
                  {new Date(review.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : review.id)}
                aria-expanded={isOpen}
                className="shrink-0 rounded-lg p-1 text-ink-400 hover:bg-ink-100"
                aria-label={isOpen ? "Collapse review" : "Expand review"}
              >
                <ChevronDown className={cx("size-4 transition", isOpen && "rotate-180")} aria-hidden />
              </button>
            </div>

            {review.comment ? (
              <p className={cx("mt-2 text-[12.5px] leading-relaxed text-ink-700", !isOpen && "line-clamp-2")}>
                {review.comment}
              </p>
            ) : (
              <p className="mt-2 text-[12px] italic text-ink-400">No written comment.</p>
            )}

            {isOpen ? (
              <div className="mt-3 space-y-3">
                {scores.length > 0 ? (
                  <dl className="grid grid-cols-3 gap-2">
                    {scores.map(([key, value]) => (
                      <div key={key} className="rounded-lg bg-ink-50 px-2 py-1.5">
                        <dt className="text-[10px] uppercase tracking-wide text-ink-400">{SCORE_LABEL[key] ?? key}</dt>
                        <dd className="text-[12.5px] font-semibold tabular-nums text-ink-800">{value}/5</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {review.is_hidden && review.hidden_reason ? (
                  <p className="rounded-lg bg-ink-100 px-2.5 py-1.5 text-[11.5px] text-ink-600">
                    Hidden: {review.hidden_reason}
                  </p>
                ) : null}

                {review.reply ? (
                  <div className="rounded-lg border-l-2 border-clay-300 bg-clay-50/60 px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-clay-700">Your reply</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-700">{review.reply}</p>
                  </div>
                ) : null}

                {replyTo === review.id ? (
                  <div>
                    <label htmlFor={`reply-${review.id}`} className="text-[11.5px] font-medium text-ink-600">
                      Reply to the guest (visible on the public menu)
                    </label>
                    <textarea
                      id={`reply-${review.id}`}
                      rows={2}
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value.slice(0, 1000))}
                      className="mt-1 w-full rounded-lg border border-ink-200 px-2.5 py-2 text-[12.5px] text-ink-800 focus:border-clay-500 focus:outline-none focus:ring-2 focus:ring-clay-500/25"
                      placeholder="Thank you for the feedback…"
                    />
                    <div className="mt-1.5 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button>
                      <Button
                        size="sm"
                        onClick={() => void act({ action: "reply", reviewId: review.id, body: replyBody }, `reply-${review.id}`)}
                        loading={busy === `reply-${review.id}`}
                        disabled={!replyBody.trim()}
                      >
                        {review.reply ? "Update reply" : "Post reply"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReplyTo(review.id);
                  setReplyBody(review.reply ?? "");
                  setExpanded(review.id);
                }}
              >
                <MessageSquare className="size-3.5" aria-hidden /> {review.reply ? "Edit reply" : "Reply"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void act(
                    {
                      action: review.is_hidden ? "unhide" : "hide",
                      reviewId: review.id,
                      reason: review.is_hidden ? null : "Hidden by the restaurant",
                    },
                    `hide-${review.id}`,
                  )
                }
                loading={busy === `hide-${review.id}`}
              >
                {review.is_hidden ? (
                  <>
                    <Eye className="size-3.5" aria-hidden /> Show again
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3.5" aria-hidden /> Hide
                  </>
                )}
              </Button>
              <span className="ml-auto text-[10.5px] text-ink-400">
                {review.kind === "item" ? "Dish review" : "Visit review"}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export { Stars };
