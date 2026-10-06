/** A planet in the table centre (pp. 112–113): drawn with its gravity well, and a ship in the well swinging toward it for free. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("a small planet: the bait starts in its gravity well and makes a free turn toward it", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("the_bait");
  await form.getByLabel("Planet in the centre").selectOption("small");
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".planet")).toHaveCount(1);

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await clickTable(page, 100, 50); // the bait, in the gravity well
  await clickTable(page, 15, 60); // the pursuers
  await expect(page.locator(".clock .where")).toContainText("Round 1 ·");

  await page.getByRole("button", { name: "Gravity turn 45° to port" }).click();
  await page.getByRole("button", { name: "Full ahead" }).click();
  await page.locator("button[data-commit-move]").click();
  await expect(page.locator(".log")).toContainText("swings 45° to port in the planet's gravity well");
  await page.screenshot({ path: "e2e-results/planet-gravity-turn.png" });
});
