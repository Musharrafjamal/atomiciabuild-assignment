import { chromium, type Page } from "@playwright/test";

/**
 * Proves the live-update stretch goal against a running server.
 *
 * Two independent browser contexts (separate cookie jars, separate sessions).
 * One claims a shift; the other must show the change without any navigation or
 * reload. The watcher is never touched after the initial load, so anything that
 * appears there arrived over the event stream.
 *
 * Run with: npx tsx scripts/live-check.ts [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3002";
const WEEK = "2026-08-24";

async function signIn(page: Page, email: string, password: string, to: string) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`${BASE}${to}`);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const browser = await chromium.launch();

  const watcherCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const actorCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const watcher = await watcherCtx.newPage();
  const actor = await actorCtx.newPage();

  // The manager watches the coverage board.
  await signIn(watcher, "manager@clinic.test", "manager1234", `/dashboard?week=${WEEK}`);

  // Wait for the stream to report itself connected.
  await watcher.waitForFunction(
    () => document.body.innerText.includes("LIVE"),
    undefined,
    { timeout: 20000 },
  );
  console.log("  watcher: stream connected");

  // Find a shift this week that still needs a nurse, and read the board's
  // current text for it.
  const target = await watcher.evaluate(async (week) => {
    const res = await fetch(`/api/shifts?week=${week}`);
    const data = await res.json();
    const shift = data.shifts.find(
      (s: { missing: Record<string, number> }) => s.missing.nurse > 0,
    );
    return shift ? { id: shift.id, missingNurses: shift.missing.nurse } : null;
  }, WEEK);

  if (!target) throw new Error("no shift needing a nurse this week");
  console.log(`  target shift ${target.id}: ${target.missingNurses} nurses short`);

  const before = await watcher.evaluate(
    (id) =>
      document.querySelector<HTMLElement>(`[data-shift-id="${id}"]`)?.innerText ??
      "",
    target.id,
  );

  // A nurse, in a completely separate session, claims it.
  await signIn(actor, "ivy.bell@clinicmail.test", "staff1234", `/shifts?week=${WEEK}`);
  const claimed = await actor.evaluate(async (id) => {
    const res = await fetch(`/api/shifts/${id}/claim`, { method: "POST" });
    return res.status;
  }, target.id);
  console.log(`  actor: claim POST -> ${claimed}`);

  // The watcher must update on its own. No reload, no navigation.
  const changedAt = Date.now();
  await watcher.waitForFunction(
    ({ id, before }) => {
      const el = document.querySelector<HTMLElement>(`[data-shift-id="${id}"]`);
      return !!el && el.innerText !== before;
    },
    { id: target.id, before },
    { timeout: 20000 },
  );

  const after = await watcher.evaluate(
    (id) =>
      document.querySelector<HTMLElement>(`[data-shift-id="${id}"]`)?.innerText ??
      "",
    target.id,
  );

  console.log(`\n  updated after ${Date.now() - changedAt}ms without a refresh`);
  console.log(`  before: ${JSON.stringify(before.replace(/\n/g, " | "))}`);
  console.log(`  after:  ${JSON.stringify(after.replace(/\n/g, " | "))}`);

  // Put it back so re-running is idempotent.
  await actor.evaluate(
    (id) => fetch(`/api/shifts/${id}/claim`, { method: "DELETE" }),
    target.id,
  );

  await browser.close();
  console.log("\nLIVE UPDATE VERIFIED");
}

main().catch((error) => {
  console.error("live check failed:", error.message);
  process.exitCode = 1;
});
