/**
 * Minimal assertion + test-collector helpers.
 *
 * The suite deliberately has no test-framework dependency: it runs under `tsx` against
 * a real PostgreSQL instance, and pulling in a runner would add a config surface with
 * nothing to show for it. `describe`/`it` collect cases; `run.ts` executes them and
 * reports.
 */

export type TestFn = () => Promise<void> | void;

export interface Test {
  name: string;
  fn: TestFn;
}

interface Suite {
  name: string;
  tests: Test[];
}

let current: Suite = { name: "root", tests: [] };
const stack: Suite[] = [];

export function describe(name: string, fn: () => void): void {
  const previous = current;
  current = { name: `${previous.name === "root" ? "" : `${previous.name} › `}${name}`, tests: [] };
  const holder = current;
  stack.push(holder);
  fn();
  stack.pop();
  current = previous;
  current.tests.push(...holder.tests);
}

export function it(name: string, fn: TestFn): void {
  const suite = current.name === "root" ? "" : `${current.name} › `;
  current.tests.push({ name: `${suite}${name}`, fn });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(`${message ?? "Values differ"} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertClose(actual: number, expected: number, tolerance = 0.01, message?: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message ?? "Numbers differ"} — expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

export async function assertRejects(fn: () => Promise<unknown>, matcher: string, message?: string): Promise<string> {
  try {
    await fn();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assertEquals(text.includes(matcher), true, `${message ?? "Wrong error"} — expected "${matcher}" in "${text}"`);
    return text;
  }
  throw new Error(`${message ?? "Expected a rejection"} — the call succeeded`);
}

/** Snapshot of everything collected so far, in declaration order. */
export function collected(): Test[] {
  return [...current.tests];
}
