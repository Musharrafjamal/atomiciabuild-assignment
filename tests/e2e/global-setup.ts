import { execFileSync } from "node:child_process";
import { E2E_ENV } from "../../playwright.config";

/**
 * Seeds the end-to-end database before the suite runs.
 *
 * Uses the ordinary seed script, so the E2E run starts from exactly the data a
 * fresh checkout produces -- the same import pipeline, the same 110 shifts, the
 * same deterministic claims.
 */
export default function globalSetup() {
  console.log("  seeding clinic_e2e from the provided CSVs…");
  execFileSync("npx", ["tsx", "scripts/seed.ts"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...E2E_ENV },
  });
}
