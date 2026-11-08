/**
 * Standalone runner for the security audit suite.
 *
 * `npm test` runs the product suite and the audit suite together. This entry point
 * runs *only* the audit, which is what you want in a pre-deploy gate or when
 * investigating a finding.
 *
 *   npm run test:security
 *
 * Against a real Supabase project, set DATABASE_URL first: the suite then runs
 * against that database instead of the embedded engine, which is how the
 * deployment is verified end to end.
 */
import "dotenv/config";
import { setup, teardown } from "./harness";

async function main() {
  const started = Date.now();
  const target = process.env.DATABASE_URL ? "DATABASE_URL target" : "embedded PostgreSQL";
  console.log(`\n  MenuPilot security audit — ${target}\n`);

  await setup();
  const { runSecuritySuite } = await import("./security.test");

  let passed = 0;
  let failed = 0;
  await runSecuritySuite({
    onResult(name, ok, ms, error) {
      if (ok) {
        passed += 1;
        console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${ms}ms)\x1b[0m`);
      } else {
        failed += 1;
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`    \x1b[31m${error}\x1b[0m`);
      }
    },
  });

  await teardown();

  console.log(
    `\n  ${passed} passed, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : "0 failed"} · ${(
      (Date.now() - started) / 1000
    ).toFixed(1)}s\n`,
  );
  if (failed > 0) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
