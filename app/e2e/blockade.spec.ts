/** Blockade Run (p. 133) through the hot-seat form: the thirds rolled, the blockader in its third, the runner along its edge, and the roll-off. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("Blockade Run: the blockade takes its third, the runner lines up on its edge, and six turns begin", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("blockade_run");
  await expect(form.getByLabel("Blockade runners")).toHaveValue("p2");
  await expect(form.getByLabel("Blockader's points")).toHaveValue("500");
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await expect(page.locator(".log")).toContainText("The blockade takes position");
  await expect(page.locator(".zone.p1").first()).toContainText("Blockade");

  // The blockader's ship goes in the third it rolled, facing down the table.
  const hint = (await page.locator(".hint").first().textContent()) ?? "";
  const x = hint.includes("left third") ? 30 : hint.includes("right third") ? 150 : 90;
  await page.getByLabel("Facing").selectOption("180");
  await clickTable(page, x, 90);
  await expect(page.locator(".hint").first()).toContainText("within 15 cm of the bottom edge");
  await clickTable(page, 90, 8);

  await page.getByRole("button", { name: "Roll off: who chooses first turn" }).click();
  const goFirst = page.getByRole("button", { name: "Go first" });
  while (!(await goFirst.isVisible())) await page.getByRole("button", { name: "Roll off: who chooses first turn" }).click();
  await goFirst.click();
  await expect(page.locator(".clock .where")).toContainText("Round 1 of 6 ·");
  await page.screenshot({ path: "e2e-results/blockade-run.png" });
});
