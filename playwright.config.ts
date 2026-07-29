import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a real server and a **separate database**.
 *
 * `clinic_e2e` rather than the development database: these tests claim and
 * release shifts, and a test run must not quietly rearrange the data someone is
 * demoing. `globalSetup` re-seeds it from the provided CSVs before every run, so
 * each run starts from a known rota.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);

/*
 * `localhost`, deliberately not `127.0.0.1`.
 *
 * Next 16's dev server restricts which origins may load its client assets, and
 * the two hostnames are different origins. Visiting via 127.0.0.1 serves the
 * HTML but the dev client never connects, so the page renders and then never
 * hydrates -- every interaction silently does nothing, and the failure looks
 * like a broken app rather than a wrong URL.
 */
const BASE_URL = `http://localhost:${PORT}`;

const E2E_ENV = {
  MONGODB_URI:
    process.env.E2E_MONGODB_URI ??
    "mongodb://localhost:27017/clinic_e2e?directConnection=true",
  AUTH_SECRET: "e2e-secret-0123456789abcdef0123456789abcdef",
  CLINIC_TZ: "Europe/London",
  NEXT_PUBLIC_CLINIC_TZ: "Europe/London",
  FORCE_RESEED: "true",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },

  // These exercise shared state -- one shift, several actors -- so running them
  // in parallel would make failures ambiguous. The concurrency guarantees are
  // tested properly at the engine level in tests/integration.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: E2E_ENV,
  },
});

export { E2E_ENV, BASE_URL };
