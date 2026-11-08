import type { LocaleDictionary } from "../translator";
import { common } from "./common";
import { customer } from "./customer";
import { dashboard } from "./dashboard";

/**
 * The Bengali dictionary — MenuPilot's reference language.
 *
 * Split into three files by audience so translators (and reviewers) can work on
 * one surface at a time:
 *   common.ts    — shell, actions, states, units
 *   customer.ts  — everything a guest at a table reads
 *   dashboard.ts — owner, kitchen and staff surfaces
 *
 * Keys must be unique across all three; `dictionaryProblems()` below proves it in
 * the test suite rather than letting a later file silently shadow an earlier one.
 */
export const bnMessages: Record<string, string> = {
  ...common,
  ...customer,
  ...dashboard,
};

export const bnDictionary: LocaleDictionary = {
  messages: bnMessages,
  digits: "bengali",
};

/** Keys duplicated between files — a real bug, because the last one wins. */
export function dictionaryProblems(): string[] {
  const seen = new Map<string, number>();
  for (const value of [common, customer, dashboard]) {
    for (const key of Object.keys(value)) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

/** Total key count, reported in the Bangla coverage report. */
export const bnKeyCount = Object.keys(bnMessages).length;
