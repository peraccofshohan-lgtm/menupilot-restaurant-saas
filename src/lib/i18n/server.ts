import "server-only";

import { cookies } from "next/headers";
import { defaultLocale, isLocale, type Locale } from "./config";
import { createTranslator, type Translator } from "./translator";

/**
 * The locale the interface is rendered in.
 *
 * Order: explicit cookie (set only if an owner ever switches language) → Bengali.
 * Deliberately not `Accept-Language`: a restaurant installs one language for its
 * staff, and a guest whose phone is in English must not see a half-English
 * dashboard the owner cannot read.
 */
export const LOCALE_COOKIE = "mp_locale";

export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    return isLocale(value) ? value : defaultLocale;
  } catch {
    // Called outside a request scope (scripts, tests): Bengali is the default.
    return defaultLocale;
  }
}

/**
 * Server-side translator for a server component or route handler.
 *
 * Route handlers should prefer this over importing strings directly so error
 * messages returned to the browser are in the same language as the UI that
 * displays them.
 */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale());
}

/** Convenience for server components that only need `t`. */
export async function getT(): Promise<Translator["t"]> {
  return (await getTranslator()).t;
}
