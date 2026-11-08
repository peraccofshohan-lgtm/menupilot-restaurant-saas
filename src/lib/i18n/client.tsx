"use client";

import * as React from "react";
import { defaultLocale } from "./config";
import type { Locale } from "./config";
import { interpolate } from "./translator";
import type { LocaleDictionary } from "./translator";

/**
 * Client translation context.
 *
 * Only the active locale's messages are shipped to the browser — the dictionary
 * travels as a prop from the server layout, so a phone on the restaurant's Wi-Fi
 * downloads one language (about 20 KB gzipped), not every language MenuPilot
 * might eventually support.
 *
 * `useT()` returns a stable function so components can put it in dependency
 * arrays without re-rendering on every parent render.
 */
type Vars = Record<string, string | number>;

interface LocaleContextValue {
  locale: Locale;
  messages: Record<string, string>;
  fallbackMessages: Record<string, string>;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  dictionary,
  fallback,
  children,
}: {
  locale: Locale;
  dictionary: LocaleDictionary;
  fallback?: Record<string, string>;
  children: React.ReactNode;
}) {
  const value = React.useMemo<LocaleContextValue>(
    () => ({
      locale,
      messages: dictionary.messages,
      fallbackMessages: fallback ?? (locale === defaultLocale ? dictionary.messages : {}),
    }),
    [locale, dictionary.messages, fallback],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const context = React.useContext(LocaleContext);
  if (!context) {
    throw new Error("useT() must be used inside <LocaleProvider>");
  }
  return context;
}

export function useLocale(): Locale {
  return useLocaleContext().locale;
}

/** Translate in a client component. */
export function useT(): (key: string, vars?: Vars) => string {
  const { messages, fallbackMessages } = useLocaleContext();
  return React.useCallback(
    (key: string, vars?: Vars) => {
      const value = messages[key] ?? fallbackMessages[key];
      if (value !== undefined) return interpolate(value, vars);
      if (process.env.NODE_ENV !== "production") return `⟦${key}⟧`;
      return "";
    },
    [messages, fallbackMessages],
  );
}
