/** Fleet Engagement (pp. 142–143) through the hot-seat form: formations, the set-up roll-off, a map, divisions, and no round limit. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("a Fleet Engagement: secret formations, the set-up roll-off, map A, deploying into divisions", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("fleet_engagement");
  await expect(form.getByLabel("Points a side")).toHaveValue("750");
  await expect(form).toContainText("no round limit");
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  // Player 1 picks with Player 2 looking away; then Player 2, without seeing it.
  await expect(page.locator(".hint")).toContainText("Player 2, look away");
  await page.getByRole("button", { name: "Sphere" }).click();
  await expect(page.locator(".hint")).toContainText("Player 1 has picked");
  await expect(page.locator(".log")).not.toContainText("sphere");
  await page.getByRole("button", { name: "Wedge" }).click();
  await expect(page.locator(".log")).toContainText("Formations revealed: Player 1 sphere, Player 2 wedge");
  await expect(page.locator(".hint")).toContainText("map A (Player 1 dark grey) or map C (Player 1 dark grey)");

  while (await page.getByRole("button", { name: /who picks the set-up/ }).isVisible()) {
    await page.getByRole("button", { name: /who picks the set-up/ }).click();
  }
  const pick = page.getByRole("button", { name: /^Map A/ });
  await pick.hover();
  await expect(page.locator(".zones.preview")).toHaveCount(1);
  await page.screenshot({ path: "e2e-results/engagement-preview.png" });
  await pick.click();
  await expect(page.locator(".log")).toContainText("picks map A: Player 1 dark grey, Player 2 white");

  while (await page.getByRole("button", { name: /who deploys first/ }).isVisible()) {
    await page.getByRole("button", { name: /who deploys first/ }).click();
  }
  // Map A: white is the block at the top centre; dark grey the bottom strip and the side strips.
  for (let i = 0; i < 2; i++) {
    const hint = await page.locator(".hint").innerText();
    const dark = hint.includes("dark grey");
    await clickTable(page, 90, dark ? 15 : 105);
  }
  await page.screenshot({ path: "e2e-results/engagement-deployed.png" });
  // Player 1 (dark grey) faces up the table; Player 2 (white) down it.
  while (await page.getByRole("button", { name: /first turn/ }).isVisible()) {
    await page.getByRole("button", { name: /first turn/ }).click();
  }
  await page.getByRole("button", { name: "Go first" }).click();
  await expect(page.locator(".clock .where")).toContainText("Round 1 ·");
  await expect(page.locator(".clock .where")).not.toContainText("of 8");
});
