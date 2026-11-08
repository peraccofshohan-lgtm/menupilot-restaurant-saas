/**
 * Validation helpers. Intentionally dependency-free: one small, well-understood
 * schema vocabulary shared by server actions (authoritative) and forms (instant
 * feedback). Server-side validation is always re-run; client state is never trusted.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export type FieldErrors = Record<string, string>;

export class Validator {
  private errors: FieldErrors = {};

  constructor(private readonly data: Record<string, unknown>) {}

  private raw(field: string): unknown {
    return this.data[field];
  }

  fail(field: string, message: string): void {
    if (!this.errors[field]) this.errors[field] = message;
  }

  string(
    field: string,
    options: { min?: number; max?: number; required?: boolean; label?: string; pattern?: RegExp; patternMessage?: string } = {},
  ): string {
    const value = this.raw(field);
    const label = options.label ?? field;
    const str = typeof value === "string" ? value.trim() : "";
    if (!str) {
      if (options.required !== false) this.fail(field, `${label} is required.`);
      return "";
    }
    if (options.min && str.length < options.min) this.fail(field, `${label} must be at least ${options.min} characters.`);
    if (options.max && str.length > options.max) this.fail(field, `${label} must be ${options.max} characters or fewer.`);
    if (options.pattern && !options.pattern.test(str)) {
      this.fail(field, options.patternMessage ?? `${label} is not valid.`);
    }
    return str;
  }

  email(field: string, options: { required?: boolean; label?: string } = {}): string {
    const value = this.string(field, { required: options.required, label: options.label ?? "Email" });
    if (value && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) {
      this.fail(field, "Enter a valid email address.");
    }
    return value.toLowerCase();
  }

  phone(field: string, options: { required?: boolean } = {}): string {
    const value = this.string(field, { required: options.required, max: 24, label: "Phone" });
    if (value && !/^[+()\-\s0-9]{6,24}$/.test(value)) this.fail(field, "Enter a valid phone number.");
    return value;
  }

  money(field: string, options: { min?: number; max?: number; required?: boolean; label?: string } = {}): number {
    const value = this.raw(field);
    const num = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
    const label = options.label ?? field;
    if (!Number.isFinite(num)) {
      this.fail(field, `${label} must be a number.`);
      return 0;
    }
    if (options.required !== false && num === 0 && String(value ?? "").trim() === "") {
      this.fail(field, `${label} is required.`);
      return 0;
    }
    if (num < 0) this.fail(field, `${label} cannot be negative.`);
    if (options.min !== undefined && num < options.min) this.fail(field, `${label} must be at least ${options.min}.`);
    if (options.max !== undefined && num > options.max) this.fail(field, `${label} must be at most ${options.max}.`);
    return Math.round(num * 100) / 100;
  }

  integer(field: string, options: { min?: number; max?: number; label?: string; fallback?: number } = {}): number {
    const value = this.raw(field);
    const num = Number.parseInt(String(value ?? ""), 10);
    const label = options.label ?? field;
    if (!Number.isFinite(num)) {
      this.fail(field, `${label} must be a whole number.`);
      return options.fallback ?? 0;
    }
    if (options.min !== undefined && num < options.min) this.fail(field, `${label} must be at least ${options.min}.`);
    if (options.max !== undefined && num > options.max) this.fail(field, `${label} must be at most ${options.max}.`);
    return num;
  }

  boolean(field: string): boolean {
    const value = this.raw(field);
    return value === true || value === "true" || value === "on" || value === "1" || value === 1;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], fallback: T): T {
    const value = String(this.raw(field) ?? "");
    if ((allowed as readonly string[]).includes(value)) return value as T;
    this.fail(field, `Select a valid option.`);
    return fallback;
  }

  slug(field: string, options: { min?: number; max?: number; label?: string; required?: boolean } = {}): string {
    const value = this.string(field, { ...options, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
    if (value && value.length < (options.min ?? 3)) {
      this.fail(field, `${options.label ?? "Slug"} must be at least ${options.min ?? 3} characters.`);
    }
    if (value && value.length > (options.max ?? 60)) {
      this.fail(field, `${options.label ?? "Slug"} must be ${options.max ?? 60} characters or fewer.`);
    }
    return value;
  }

  result<T>(value: T): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
    if (Object.keys(this.errors).length > 0) return { ok: false, errors: this.errors };
    return { ok: true, data: value };
  }

  get fieldErrors(): FieldErrors {
    return this.errors;
  }

  throwIfInvalid(): void {
    const first = Object.values(this.errors)[0];
    if (first) throw new ValidationError(first, Object.keys(this.errors)[0]);
  }
}

export function makeSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
