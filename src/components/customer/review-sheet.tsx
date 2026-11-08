"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Star, X } from "lucide-react";
import { Button, Textarea, cx } from "@/components/ui";

/**
 * Review a served order.
 *
 * The guest holds the tracking token and nothing else; the server decides
 * whether a review is allowed (served only, dish must be on the order, one per
 * dish, one per visit). The star buttons here only collect the intent.
 */

const SUB_SCORES =
  {
    item: [
      { key: "taste", label: "Taste" },
      { key: "quality", label: "Quality" },
      { key: "presentation", label: "Presentation" },
    ],
    restaurant: [
      { key: "service", label: "Service" },
      { key: "staff", label: "Staff behaviour" },
      { key: "cleanliness", label: "Cleanliness" },
    ],
  } as const;

type SubKey = "taste" | "quality" | "presentation" | "service" | "staff" | "cleanliness";

function StarPicker({
  value,
  onChange,
  label,
  size = "md",
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = React.useState(0);
  const active = hover || value;
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${label}: ${star} star${star === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(star)}
          className="rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
        >
          <Star
            className={cx(
              size === "sm" ? "size-4" : "size-6",
              star <= active ? "fill-amber-400 text-amber-400" : "text-ink-300",
            )}
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}

export function ReviewSheet({
  token,
  kind,
  menuItemId,
  title,
  subtitle,
  onClose,
}: {
  token: string;
  kind: "item" | "restaurant";
  menuItemId?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function submit() {
    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          kind,
          menuItemId: kind === "item" ? menuItemId : null,
          rating,
          comment: comment.trim() || null,
          ...scores,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "That review could not be saved.");
        return;
      }
      setDone(true);
      router.refresh();
      setTimeout(onClose, 1400);
    } catch {
      setError("Network problem — your review was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-6 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">{done ? "Thank you" : title}</h2>
            {subtitle && !done ? <p className="text-[12px] text-ink-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {done ? (
          <div className="mt-5 flex flex-col items-center py-6 text-center">
            <CircleCheck className="size-9 text-moss-600" aria-hidden />
            <p className="mt-2 text-[13.5px] font-medium text-ink-900">Your review has been sent</p>
            <p className="mt-0.5 text-[12px] text-ink-500">The restaurant can see it straight away.</p>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <p className="text-[12.5px] font-medium text-ink-700">How was it overall?</p>
              <div className="mt-1.5">
                <StarPicker value={rating} onChange={setRating} label="Overall rating" />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {SUB_SCORES[kind].map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px] text-ink-600">{field.label}</span>
                  <StarPicker
                    size="sm"
                    label={field.label}
                    value={scores[field.key] ?? 0}
                    onChange={(next) => setScores((prev) => ({ ...prev, [field.key]: next }))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label htmlFor="review-comment" className="text-[12.5px] font-medium text-ink-700">
                Anything you would like to add? <span className="font-normal text-ink-400">(optional)</span>
              </label>
              <Textarea
                id="review-comment"
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 2000))}
                placeholder="What stood out — good or not so good?"
                className="mt-1"
              />
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={onClose} className="flex-1">
                Not now
              </Button>
              <Button onClick={submit} disabled={busy || rating < 1} className="flex-[2]">
                {busy ? "Sending…" : "Send review"}
              </Button>
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              Reviews are tied to this order. Sub-scores are optional.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export { StarPicker };
export type { SubKey };
