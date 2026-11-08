import * as React from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";

/* ==========================================================================
   MenuPilot UI primitives
   Every component here is used by at least two interfaces (marketing,
   dashboard, customer menu, kitchen, platform). No dead controls.
   ========================================================================== */

export function cx(...values: Array<string | false | null | undefined>): string {
  return clsx(values);
}

/* ---------------------------------- Button -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-clay-600 text-white hover:bg-clay-700 active:bg-clay-800 shadow-sm disabled:bg-clay-300",
  secondary:
    "bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 active:bg-ink-100 shadow-sm disabled:text-ink-300",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-300",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm disabled:bg-red-300",
  subtle: "bg-ink-100 text-ink-800 hover:bg-ink-200 active:bg-ink-300 disabled:text-ink-400",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
};

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const baseButton =
  "inline-flex items-center justify-center font-medium transition-colors duration-150 select-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-500 " +
  "disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonBaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(baseButton, buttonVariants[variant], buttonSizes[size], fullWidth && "w-full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  children,
  ...props
}: ButtonBaseProps & { href: string } & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      className={cx(baseButton, buttonVariants[variant], buttonSizes[size], fullWidth && "w-full", className)}
      {...props}
    >
      {children}
    </Link>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-3", className)}>
      {children}
    </div>
  );
}

/* --------------------------------- Badges --------------------------------- */

export type Tone = "neutral" | "clay" | "moss" | "amber" | "blue" | "red" | "violet";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  clay: "bg-clay-50 text-clay-700 ring-clay-200",
  moss: "bg-moss-50 text-moss-700 ring-moss-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset",
        toneStyles[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const ORDER_STATUS_TONE: Record<string, Tone> = {
  pending: "amber",
  accepted: "blue",
  preparing: "clay",
  ready: "violet",
  served: "moss",
  rejected: "red",
  cancelled: "neutral",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending approval",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={ORDER_STATUS_TONE[status] ?? "neutral"} dot>
      {ORDER_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/* ---------------------------------- Inputs -------------------------------- */

const controlBase =
  "w-full rounded-lg border bg-white text-sm text-ink-900 placeholder:text-ink-400 " +
  "transition-colors focus:outline-none focus:ring-2 focus:ring-clay-500/30 focus:border-clay-500 " +
  "disabled:bg-ink-50 disabled:text-ink-400";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-[13px] font-medium text-ink-700">
        {label}
        {required ? <span className="text-clay-600" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-[12.5px] text-red-600" role="alert">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(controlBase, "h-10 px-3", invalid ? "border-red-400" : "border-ink-200", className)}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(controlBase, "min-h-20 px-3 py-2 leading-relaxed", invalid ? "border-red-400" : "border-ink-200", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(controlBase, "h-10 pl-3 pr-8 appearance-none bg-no-repeat", invalid ? "border-red-400" : "border-ink-200", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236d6d64' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: "right 0.75rem center",
      }}
      {...props}
    >
      {children}
    </select>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  name,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-ink-800">{label}</p>
        {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-clay-600" : "bg-ink-300",
          disabled && "opacity-50",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[1.4rem]" : "translate-x-0.5",
          )}
        />
      </button>
      {name ? <input type="hidden" name={name} value={checked ? "true" : "false"} /> : null}
    </div>
  );
}

/* -------------------------------- Feedback -------------------------------- */

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "error" | "warning";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    success: "bg-moss-50 text-moss-700 ring-moss-100",
    error: "bg-red-50 text-red-800 ring-red-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  }[tone];
  const Icon = { info: Info, success: CheckCircle2, error: AlertCircle, warning: AlertCircle }[tone];
  return (
    <div className={cx("flex gap-2.5 rounded-lg px-3.5 py-3 text-[13px] ring-1 ring-inset", styles, className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-relaxed opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "py-8" : "py-14", className)}>
      {icon ? (
        <div className="mb-3 grid size-11 place-items-center rounded-full bg-ink-100 text-ink-500" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="text-[14px] font-semibold text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("shimmer rounded-md", className)} aria-hidden />;
}

export function StatSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-20" />
      <Skeleton className="mt-2 h-3 w-16" />
    </Card>
  );
}

/* --------------------------------- Layout --------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 text-[12.5px] text-ink-500">{breadcrumb}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium tracking-wide text-ink-500">{label}</p>
        {icon ? (
          <span className={cx("grid size-8 place-items-center rounded-lg ring-1 ring-inset", toneStyles[tone])} aria-hidden>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[12.5px] text-ink-500">{hint}</p> : null}
    </Card>
  );
}

export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <hr className={cx("border-ink-200", className)} />;
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <hr className="flex-1 border-ink-200" />
      <span className="text-[11.5px] font-medium uppercase tracking-wider text-ink-400">{label}</span>
      <hr className="flex-1 border-ink-200" />
    </div>
  );
}
