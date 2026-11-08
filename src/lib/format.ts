/**
 * Formatting helpers shared by server and client components.
 *
 * Bangla-first: money is ৳ with Bengali digits, dates read "৮ নভে, ০২:৩০ PM" and
 * relative times read "৭ মিনিট আগে". Every helper accepts a `digits` option
 * because two things must stay readable in Latin numerals:
 *
 *   - order numbers and QR/tracking references (people read them aloud, type
 *     them into a phone, or compare them against a printed ticket)
 *   - technical ids and timestamps in the dashboard
 *
 * Bengali digits are thus the default for *display* of quantities, prices and
 * times, and explicitly switched off for references.
 */

export type DigitStyle = "bengali" | "latin";

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"] as const;

/** Converts every ASCII digit in a string to its Bengali counterpart. */
export function toBengaliDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)]!);
}

/** Converts Bengali digits back to ASCII. Used when parsing user input. */
export function toLatinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit as (typeof BENGALI_DIGITS)[number])));
}

function applyDigits(value: string, digits: DigitStyle): string {
  return digits === "bengali" ? toBengaliDigits(value) : value;
}

/**
 * Money, in taka.
 *
 * `৳` is placed first and separated by no space, which is how prices are printed
 * on Bangladeshi menus ("৳২৫০"), rather than the "BDT 250" the previous English
 * build produced. Paise appear only when they exist.
 */
export function formatMoney(
  amount: number | string,
  currency = "BDT",
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";

  const fractionDigits = value % 1 === 0 ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  // Bangladeshi grouping (১,২৩,৪৫৬) matches the lakh/crore convention staff use
  // when they read a figure aloud, so en-IN grouping is deliberate, not a typo.
  const symbol = currency === "BDT" ? "৳" : `${currency} `;
  return applyDigits(`${symbol}${formatted}`, digits);
}

/** A plain number with thousands separators, optionally in Bengali digits. */
export function formatNumber(value: number, options: { digits?: DigitStyle } = {}): string {
  const digits = options.digits ?? "bengali";
  const formatted = new Intl.NumberFormat("en-IN").format(value);
  return applyDigits(formatted, digits);
}

const BN_MONTHS = [
  "জানু",
  "ফেব",
  "মার্চ",
  "এপ্রি",
  "মে",
  "জুন",
  "জুলা",
  "আগ",
  "সেপ্ট",
  "অক্টো",
  "নভে",
  "ডিসে",
] as const;

const BN_WEEKDAYS = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহঃ", "শুক্র", "শনি"] as const;

/** Hour as 12-hour clock without locale surprises, e.g. "০২:৩০ PM". */
function clockParts(date: Date, timeZone: string): { time: string; meridian: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const meridian = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${String(hour12).padStart(2, "0")}:${minute}`, meridian };
}

/**
 * "০৮ নভে, ০২:৩০ PM" — the shape used across the dashboard and the tracker.
 *
 * The meridian stays in Latin letters because "AM/PM" is what phones and staff
 * clocks in Bangladesh show; converting it to "পূর্বাহ্ণ" makes a 12:30 ticket
 * harder to scan on a busy pass.
 */
export function formatDateTime(
  value: string | Date,
  timeZone = "Asia/Dhaka",
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "numeric",
  }).formatToParts(date);
  const day = dateParts.find((part) => part.type === "day")?.value ?? "01";
  const month = Number(dateParts.find((part) => part.type === "month")?.value ?? "1");
  const { time, meridian } = clockParts(date, timeZone);

  return applyDigits(`${day} ${BN_MONTHS[month - 1]}, ${time} ${meridian}`, digits);
}

/** "০২:৩০ PM" */
export function formatTime(
  value: string | Date,
  timeZone = "Asia/Dhaka",
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const { time, meridian } = clockParts(date, timeZone);
  return applyDigits(`${time} ${meridian}`, digits);
}

/** "০৮ নভে" — used on chart axes and list rows. */
export function formatDay(
  value: string | Date,
  timeZone = "Asia/Dhaka",
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "numeric",
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  return applyDigits(`${day} ${BN_MONTHS[month - 1]}`, digits);
}

/** "শুক্র, ০৮ নভেম্বর ২০২৬" — long form for reports. */
export function formatLongDate(
  value: string | Date,
  timeZone = "Asia/Dhaka",
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "numeric",
    year: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const weekdayBn = weekdayIndex >= 0 ? BN_WEEKDAYS[weekdayIndex] : "";
  return applyDigits(
    `${weekdayBn ? `${weekdayBn}, ` : ""}${day} ${BN_MONTHS[month - 1]} ${year}`,
    digits,
  );
}

/**
 * Relative time in Bangla: "এইমাত্র", "৭ মিনিট আগে", "২ ঘণ্টা আগে", "৩ দিন আগে".
 *
 * Pure function of a timestamp and `now`, so tests can pin it and the server and
 * client agree on the same string for the same instant.
 */
export function timeAgo(
  value: string | Date,
  now: number = Date.now(),
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return "এইমাত্র";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return applyDigits(`${minutes} মিনিট আগে`, digits);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return applyDigits(`${hours} ঘণ্টা আগে`, digits);
  const days = Math.round(hours / 24);
  if (days < 30) return applyDigits(`${days} দিন আগে`, digits);
  const months = Math.round(days / 30);
  if (months < 12) return applyDigits(`${months} মাস আগে`, digits);
  return applyDigits(`${Math.round(months / 12)} বছর আগে`, digits);
}

/** Minutes as a Bangla duration: "২০ মিনিট", "১ ঘণ্টা ১০ মিনিট". */
export function formatDuration(minutes: number, options: { digits?: DigitStyle } = {}): string {
  const digits = options.digits ?? "bengali";
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return applyDigits(`${safe} মিনিট`, digits);
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0
    ? applyDigits(`${hours} ঘণ্টা`, digits)
    : applyDigits(`${hours} ঘণ্টা ${rest} মিনিট`, digits);
}

/** "৭ মিনিট" — the short form used inside ETA chips. */
export function formatMinutesShort(minutes: number, options: { digits?: DigitStyle } = {}): string {
  const digits = options.digits ?? "bengali";
  return applyDigits(`${Math.max(0, Math.round(minutes))} মিনিট`, digits);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Order numbers, QR references and tracking ids stay in Latin digits.
 *
 * These are read aloud across a noisy restaurant, typed into a phone, or matched
 * against a printed ticket — "মাতি-২৬১১০৮-১০০০" invites mistakes that
 * "MATI-261108-1000" does not. Deliberately not localised.
 */
export function formatReference(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

/** A count with a Bangla noun, e.g. "৩ আইটেম". */
export function formatCount(
  count: number,
  singular: string,
  plural: string,
  options: { digits?: DigitStyle } = {},
): string {
  const digits = options.digits ?? "bengali";
  return applyDigits(`${count}`, digits) + ` ${count === 1 ? singular : plural}`;
}
