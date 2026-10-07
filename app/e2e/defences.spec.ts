/** Planetary defences (pp. 100–101): a points battle round a medium planet, a laser platform bought from the fleet's points and deployed in the gravity well. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("a laser platform in the planet's gravity well, held by Player 1", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("750");
  await form.getByLabel("Planet in the centre").selectOption("medium");
  await expect(form.getByLabel("Planet held by")).toHaveValue("p1");
  const p1 = form.locator("fieldset.p1");
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByLabel("Ship 2 class").selectOption("laser_platform");
  await expect(p1).toContainText("defences 30 of 250 pts");
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await page.getByRole("button", { name: "Roll for deployment zones" }).click();
  const order = page.getByRole("button", { name: "Roll off: who deploys first" });
  while (await order.isVisible()) await order.click();

  // Three placements: the cruisers in their zones, the platform in the gravity well (centre 90, 60; it ends 27.5 cm out).
  for (let i = 0; i < 3; i++) {
    const hint = (await page.locator(".hint").first().textContent()) ?? "";
    if (hint.includes("planetary defence")) await clickTable(page, 90, 80);
    else if (hint.includes("zone A")) await clickTable(page, 90, 105);
    else await clickTable(page, 90, 15);
    await expect(page.locator(".log li").filter({ hasText: "deploys at" })).toHaveCount(i + 1);
  }
  await expect(page.locator(".ship .platform")).toHaveCount(1);
  await expect(page.locator(".ships")).toContainText("Planetary defence: never moves");

  const first = page.getByRole("button", { name: "Roll off: who chooses first turn" });
  const goFirst = page.getByRole("button", { name: "Go first" });
  await first.click();
  while (!(await goFirst.isVisible())) await first.click();
  await goFirst.click();
  await expect(page.locator(".clock .where")).toContainText("Round 1 of 8 ·");
  await page.screenshot({ path: "e2e-results/defences.png" });
});
