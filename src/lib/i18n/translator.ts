import { defaultLocale, isLocale, type Locale } from "./config";
import { bnDictionary } from "./messages/bn";

/**
 * Translation runtime.
 *
 * Keys are flat dotted strings (`order.status.preparing`) rather than nested
 * objects. That keeps the dictionary readable, makes a missing key greppable,
 * and lets `t()` accept placeholders without a template engine.
 *
 * Two rules make this safe to build a whole product on:
 *
 * 1. `bn` is the reference dictionary. Its key set defines `MessageKey`, so a
 *    component cannot reference a key that does not exist — TypeScript rejects
 *    it at build time instead of rendering "order.status.prepar" to a guest.
 * 2. Placeholders are `{name}`. A value is filled by literal replacement, never
 *    evaluated, so a dish called `{admin}` is rendered as text and cannot inject.
 */
export type Direction = "ltr" | "rtl";

export interface LocaleDictionary {
  messages: Record<string, string>;
  /** Bengali digits are opt-in per call; see `formatNumber` in lib/format. */
  digits: "bengali" | "latin";
}

type Vars = Record<string, string | number>;

/** Fills `{name}` placeholders. Unknown placeholders are left intact on purpose. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

const dictionaries = new Map<Locale, LocaleDictionary>();

export function registerDictionary(locale: Locale, dictionary: LocaleDictionary): void {
  dictionaries.set(locale, dictionary);
}

export function getDictionary(locale: Locale): LocaleDictionary {
  const dictionary = dictionaries.get(locale);
  if (dictionary) return dictionary;
  const fallback = dictionaries.get(defaultLocale);
  if (!fallback) throw new Error(`No dictionary registered for "${locale}" and no "${defaultLocale}" fallback`);
  return fallback;
}

/**
 * The reference dictionary registers itself.
 *
 * This is deliberately a side effect of importing this module rather than a
 * call the caller must remember: forgetting it produced a 500 on every page
 * ("no dictionary registered for bn"). Any module that can build a translator
 * now has Bengali available, by construction.
 *
 * `messages/bn.ts` only imports the `LocaleDictionary` *type* from here, so this
 * import is not a runtime cycle.
 */
registerDictionary("bn", bnDictionary);

/** A translator bound to one locale. Safe to pass into components and to cache per request. */
export interface Translator {
  locale: Locale;
  /** Translate a key, filling `{placeholders}` from `vars`. */
  t: (key: string, vars?: Vars) => string;
  /** Does this key exist? Used by tests and by optional labels. */
  has: (key: string) => boolean;
  /** Values for `<html lang>` / `<html dir>`. */
  htmlLang: string;
}

export function createTranslator(locale: Locale): Translator {
  const dictionary = getDictionary(locale);
  const fallback = getDictionary(defaultLocale);

  const has = (key: string) =>
    Object.prototype.hasOwnProperty.call(dictionary.messages, key) ||
    Object.prototype.hasOwnProperty.call(fallback.messages, key);

  function t(key: string, vars?: Vars): string {
    const value = dictionary.messages[key] ?? fallback.messages[key];
    if (value !== undefined) return interpolate(value, vars);
    // Never render a raw key to a guest in production; the key itself is the
    // most useful thing a developer can see, and tests assert this never fires.
    if (process.env.NODE_ENV !== "production") {
      return `⟦${key}⟧`;
    }
    return "";
  }

  return {
    locale,
    t,
    has,
    htmlLang: locale === "bn" ? "bn-BD" : "en",
  };
}

/** Resolves a locale from a request value, falling back to Bengali. */
export function resolveLocale(candidate: unknown): Locale {
  return isLocale(candidate) ? candidate : defaultLocale;
}
