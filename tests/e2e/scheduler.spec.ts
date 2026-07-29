import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end coverage of the paths a reviewer will actually walk.
 *
 * These complement rather than duplicate the integration tests: the rules
 * themselves are proved against a real replica set in tests/integration, so what
 * matters here is that the whole stack is wired together -- a click reaches the
 * rules engine, and a refusal reaches the screen with its reason intact.
 */

/** The seeded roster runs 3-30 August 2026. */
const WEEK = "2026-08-24";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  // The form only works once React has taken over; clicking before then would
  // trigger a native submission rather than the fetch handler.
  await page.locator("form[data-hydrated='true']").waitFor();
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login")),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
}

test.describe("signing in", () => {
  test("rejects a bad password without revealing whether the account exists", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("form[data-hydrated='true']").waitFor();
    await page.getByRole("textbox", { name: /email/i }).fill("manager@clinic.test");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // Scoped to our own notice: Next renders a role="alert" route announcer too.
    const failure = page.getByText(/do not match an account/i);
    await expect(failure).toBeVisible();

    // The same message for an address that does not exist at all -- the point of
    // the test is that these two cases are indistinguishable.
    await page.getByRole("textbox", { name: /email/i }).fill("nobody@nowhere.test");
    await page.locator('input[type="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(failure).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends each role to its own screen", async ({ page }) => {
    await signIn(page, "manager@clinic.test", "manager1234");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    await signIn(page, "ivy.bell@clinicmail.test", "staff1234");
    await expect(page).toHaveURL(/\/shifts/);
  });
});

test.describe("staff claiming", () => {
  test("claims a shift and is then refused an overlapping one", async ({ page }) => {
    await signIn(page, "ivy.bell@clinicmail.test", "staff1234");
    await page.goto(`/shifts?week=${WEEK}`);

    // Find two shifts on the same day that overlap and still need a nurse.
    const pair = await page.evaluate(async (week) => {
      const res = await fetch(`/api/shifts?week=${week}`);
      const { shifts } = await res.json();
      const open = shifts.filter(
        (s: { missing: Record<string, number>; claimedByMe: boolean }) =>
          s.missing.nurse > 0 && !s.claimedByMe,
      );
      for (const a of open) {
        const clash = open.find(
          (b: { id: string; startAt: string; endAt: string }) =>
            b.id !== a.id && b.startAt < a.endAt && b.endAt > a.startAt,
        );
        if (clash) return { first: a.id, second: clash.id };
      }
      return null;
    }, WEEK);

    expect(pair, "expected two overlapping open shifts in the seeded week").not.toBeNull();

    const first = page.locator(`[data-shift-row="${pair!.first}"]`);
    const second = page.locator(`[data-shift-row="${pair!.second}"]`);

    await first.getByRole("button", { name: "Claim" }).click();
    await expect(first.getByText("You are on")).toBeVisible();

    // The overlapping one must be refused, with the reason on screen.
    await second.getByRole("button", { name: "Claim" }).click();
    await expect(second).toContainText(/overlaps a shift already claimed/i);

    // Releasing frees it again.
    await first.getByRole("button", { name: "Release" }).click();
    await expect(first.getByRole("button", { name: "Claim" })).toBeVisible();
  });
});

test.describe("authorisation", () => {
  test("staff cannot reach manager screens or manager APIs", async ({ page }) => {
    await signIn(page, "ivy.bell@clinicmail.test", "staff1234");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/shifts/); // bounced

    await page.goto("/import");
    await expect(page).toHaveURL(/\/shifts/);

    // And the API refuses directly, not just the routing.
    const codes = await page.evaluate(async () => {
      const staff = await fetch("/api/staff");
      const create = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-08-25",
          startTime: "08:00",
          endTime: "16:00",
          requirements: { nurse: 1 },
        }),
      });
      return { staff: staff.status, create: create.status };
    });

    expect(codes.staff).toBe(403);
    expect(codes.create).toBe(403);
  });

  test("staff cannot claim on behalf of somebody else", async ({ page }) => {
    await signIn(page, "ivy.bell@clinicmail.test", "staff1234");

    const result = await page.evaluate(async (week) => {
      const { shifts } = await (await fetch(`/api/shifts?week=${week}`)).json();
      const target = shifts.find(
        (s: { missing: Record<string, number> }) => s.missing.nurse > 0,
      );
      const res = await fetch(`/api/shifts/${target.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Somebody else's id shape; the guard rejects before any lookup matters.
        body: JSON.stringify({ staffId: "000000000000000000000001" }),
      });
      return { status: res.status, body: await res.json() };
    }, WEEK);

    expect(result.status).toBe(403);
    expect(result.body.error.message).toMatch(/only claim or release shifts for yourself/i);
  });
});

test.describe("manager coverage", () => {
  test("shows the week, and assigning someone updates the board", async ({ page }) => {
    await signIn(page, "manager@clinic.test", "manager1234");
    await page.goto(`/dashboard?week=${WEEK}`);

    // Scoped to the summary tile: "Fully staffed" also appears on every covered
    // shift's chip, which is the point of the chip.
    await expect(page.locator("dt", { hasText: "Fully staffed" })).toBeVisible();
    await expect(page.locator("[data-shift-id]").first()).toBeVisible();
    // All three coverage states should be represented in the seeded week.
    for (const status of ["full", "partial", "empty"]) {
      await expect(page.locator(`[data-status="${status}"]`).first()).toBeVisible();
    }

    // Open a shift that still needs somebody.
    const shiftId = await page.evaluate(async (week) => {
      const { shifts } = await (await fetch(`/api/shifts?week=${week}`)).json();
      return shifts.find(
        (s: { missing: Record<string, number> }) =>
          s.missing.nurse > 0 || s.missing.doctor > 0,
      )?.id;
    }, WEEK);

    await page.locator(`[data-shift-id="${shiftId}"]`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Add someone")).toBeVisible();

    const before = await page.locator(`[data-shift-id="${shiftId}"]`).innerText();

    await dialog.getByRole("button", { name: "Assign" }).first().click();

    // The person moves into "On this shift", and the card behind updates.
    await expect(dialog.getByRole("button", { name: "Remove" }).first()).toBeVisible();
    await expect
      .poll(async () => page.locator(`[data-shift-id="${shiftId}"]`).innerText())
      .not.toBe(before);
  });

  test("editing a claimed shift warns before releasing anyone", async ({ page }) => {
    await signIn(page, "manager@clinic.test", "manager1234");
    await page.goto(`/dashboard?week=${WEEK}`);

    // A shift that somebody is already on.
    const shiftId = await page.evaluate(async (week) => {
      const { shifts } = await (await fetch(`/api/shifts?week=${week}`)).json();
      return shifts.find((s: { claims: unknown[] }) => s.claims.length > 0)?.id;
    }, WEEK);

    await page.locator(`[data-shift-id="${shiftId}"]`).click();
    await page.getByRole("button", { name: "Edit shift" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Drop every requirement to zero-but-one so the existing claims cannot fit.
    await dialog.locator('input[type="number"]').first().fill("0");
    await dialog.locator('input[type="number"]').nth(1).fill("0");
    await dialog.locator('input[type="number"]').nth(2).fill("1");

    await dialog.getByRole("button", { name: /save changes/i }).click();

    // It must disclose who would be released rather than acting silently.
    await expect(dialog.getByText(/already on the shift/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /release \d+ and save/i })).toBeVisible();

    // Backing out changes nothing.
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog.getByRole("button", { name: /save changes/i })).toBeVisible();
  });
});

test.describe("import report", () => {
  test("explains every row it refused", async ({ page }) => {
    await signIn(page, "manager@clinic.test", "manager1234");
    await page.goto("/import");

    await page.getByRole("link", { name: /shifts\.csv/ }).first().click();
    await expect(page).toHaveURL(/\/import\/[a-f0-9]{24}/);

    // The header states how much got in.
    await expect(page.getByText(/of \d+ rows accepted/)).toBeVisible();

    // How the ambiguous dates were resolved, with the proof.
    await expect(page.getByText(/How this file was read/i)).toBeVisible();
    await expect(page.getByText(/29\/08\/2026/)).toBeVisible();

    // And the actual problems, each with a row, a reason and an action.
    await expect(page.getByText(/is not a real calendar date/)).toBeVisible();
    // Two rows legitimately carry this: the 18-hour and the 26-hour ones.
    await expect(page.getByText(/above the 16-hour limit/).first()).toBeVisible();
    await expect(page.getByText(/shift would run 18 hours/)).toBeVisible();
    await expect(page.getByText(/shift would run 26 hours/)).toBeVisible();
    await expect(page.getByText(/no duration/)).toBeVisible();
    await expect(page.getByText("What we did").first()).toBeVisible();
  });
});
