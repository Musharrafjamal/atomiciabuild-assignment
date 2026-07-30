import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Captures the graded screens at three widths and asserts the one thing that
 * actually breaks a responsive layout: the page must never scroll sideways.
 *
 * Run with: npx tsx scripts/responsive-check.ts [baseUrl]
 */

const BASE = process.argv[2] ?? "http://localhost:3002";
const OUT = "screenshots";

const WIDTHS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const SCREENS = [
  { name: "dashboard", path: "/dashboard?week=2026-08-17" },
  { name: "shifts", path: "/shifts?week=2026-08-17" },
  { name: "import", path: "/import" },
];

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("form[data-hydrated='true']").waitFor({ timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    // `commit` rather than the default `load`: once signed in the page opens a
    // server-sent-events connection that stays open, so the load event may never
    // fire and waiting for it would time out on a page that is working fine.
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30000,
      waitUntil: "commit",
    }),
    page.click('button[type="submit"]'),
  ]);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures: string[] = [];

  for (const viewport of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await signIn(page, "manager@clinic.test", "manager1234");

    for (const screen of SCREENS) {
      await page.goto(`${BASE}${screen.path}`, { waitUntil: "domcontentloaded" });
      // Not `networkidle`: the live-update stream is a long-lived connection, so
      // the network is never idle on the signed-in screens. Wait for content that
      // only exists after the week has loaded instead.
      await page
        .locator("[data-shift-id], [data-shift-row], main")
        .first()
        .waitFor({ timeout: 20000 });
      // Long enough for the staggered entrance to finish, so a screenshot never
      // catches the board mid-fade and looks like missing data.
      await page.waitForTimeout(2500);

      // The check that matters. A layout is not responsive if the body scrolls
      // sideways -- everything else is taste, this is a defect.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      const overflows = overflow.scrollWidth > overflow.clientWidth + 1;
      const status = overflows
        ? `OVERFLOW by ${overflow.scrollWidth - overflow.clientWidth}px`
        : "ok";
      if (overflows) {
        failures.push(`${screen.name} @ ${viewport.name}: ${status}`);
      }

      console.log(
        `  ${screen.name.padEnd(10)} @ ${viewport.name.padEnd(8)} ${String(viewport.width).padStart(4)}px  ${status}`,
      );

      await page.screenshot({
        path: `${OUT}/${screen.name}-${viewport.name}.png`,
        fullPage: false,
      });
    }

    await context.close();
  }

  await browser.close();

  if (failures.length) {
    console.log(`\n${failures.length} horizontal overflow(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\nNo horizontal overflow at any width.");
  }
}

main();
