/**
 * i18n entry point.
 *
 * Importing the dictionaries registers them, so any caller of
 * `createTranslator()` gets a working Bengali translator without extra setup.
 * Components should import from this module (or the narrower server/client
 * helpers) rather than reaching into the messages folder.
 */
import { bnDictionary, bnKeyCount, dictionaryProblems, bnMessages } from "./messages/bn";
import { registerDictionary } from "./translator";
import { defaultLocale, isLocale, LOCALES, LOCALE_NAMES, type Locale } from "./config";

registerDictionary("bn", bnDictionary);

export {
  bnDictionary,
  bnKeyCount,
  bnMessages,
  defaultLocale,
  dictionaryProblems,
  isLocale,
  LOCALES,
  LOCALE_NAMES,
  registerDictionary,
};
export type { Locale };
export { createTranslator, interpolate, resolveLocale } from "./translator";
export type { Translator } from "./translator";
