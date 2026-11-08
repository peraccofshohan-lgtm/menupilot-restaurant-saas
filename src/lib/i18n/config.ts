/**
 * Locale configuration.
 *
 * MenuPilot ships with Bengali as the default and complete language, because it
 * is built for restaurants in Bangladesh. The dictionary is keyed rather than
 * inlined so a second language can be added later without touching a single
 * component: add a locale here, add its dictionary, done.
 *
 * Bangla is `defaultLocale`, so a request without a cookie, a device that has
 * never chosen, and the server-rendered HTML all agree on one language. There is
 * no Accept-Language negotiation by design — a restaurant's staff should not see
 * a different interface because a guest's phone is set to English.
 */
export const LOCALES = ["bn", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const defaultLocale: Locale = "bn";

/** Shown in the (optional) language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  bn: "বাংলা",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
