import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

/**
 * End-to-end tests run against a real server and a **separate database**.
 *
 * These tests claim and release shifts, so they must not rearrange the data the
 * app is actually serving. The database name from `MONGODB_URI` is swapped for
 * `clinic_e2e` in the same cluster, and `globalSetup` re-seeds it from the
 * provided CSVs before every run so each run starts from a known rota.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);

/*
 * `localhost`, deliberately not `127.0.0.1`.
 *
 * Next restricts which origins may load its dev-server client assets, and the
 * two hostnames are different origins. Visiting via 127.0.0.1 serves the HTML
 * but the dev client never connects, so the page renders and then never
 * hydrates -- every interaction silently does nothing, which looks like a broken
 * app rather than a wrong URL.
 */
const BASE_URL = `http://localhost:${PORT}`;

/** Point at a dedicated end-to-end database in whatever cluster is configured. */
function e2eDatabaseUri(): string {
  const uri =
    process.env.E2E_MONGODB_URI ??
    process.env.MONGODB_URI ??
    "mongodb://localhost:27017/clinic";

  const [head, query] = uri.split("?");
  const trimmed = head.replace(/\/$/, "");
  const parts = trimmed.split("/");
  const rebuilt =
    parts.length > 3
      ? [...parts.slice(0, 3), "clinic_e2e"].join("/")
      : `${trimmed}/clinic_e2e`;

  return query ? `${rebuilt}?${query}` : rebuilt;
}

const E2E_ENV = {
  MONGODB_URI: e2eDatabaseUri(),
  AUTH_SECRET: "e2e-secret-0123456789abcdef0123456789abcdef",
  CLINIC_TZ: process.env.CLINIC_TZ ?? "Asia/Kolkata",
  NEXT_PUBLIC_CLINIC_TZ: process.env.NEXT_PUBLIC_CLINIC_TZ ?? "Asia/Kolkata",
  FORCE_RESEED: "true",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Generous: the database may be a remote Atlas cluster rather than a local one.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // These exercise shared state -- one shift, several actors -- so running them
  // in parallel would make failures ambiguous. The concurrency guarantees are
  // tested properly at the engine level in tests/integration.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: E2E_ENV,
  },
});

export { E2E_ENV, BASE_URL };
