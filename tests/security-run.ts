/**
 * Standalone runner for the security audit suite.
 *
 * `npm test` runs the product suite and the audit suite together. This entry point
 * runs *only* the audit, which is what you want in a pre-deploy gate or when
 * investigating a finding.
 *
 *   npm run test:security
 *
 * To run against a real project (this is how the deployment is verified end to end):
 *
 *   DATABASE_URL="postgresql://…:6543/postgres" \
 *   MENUPILOT_TEST_EXTERNAL=1 \
 *   npm run test:security
 *
 * The schema must already be migrated — the suite never applies DDL to a target it
 * did not create. Fixtures are written into that database and removed in teardown;
 * the demo tenant is never touched.
 */
import "dotenv/config";
import { setup, teardown } from "./harness";

async function main() {
  const started = Date.now();
  const external = process.env.DATABASE_URL && process.env.MENUPILOT_TEST_EXTERNAL === "1";
  const target = external
    ? `external database ${new URL(process.env.DATABASE_URL!).host}`
    : "embedded PostgreSQL (temporary)";
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
  if (external) console.log("  fixtures removed from the target database");

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
