import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("new game, setup by clicking, into the battle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await page.getByRole("button", { name: /deployment zones/ }).click();
  // The deployment roll-off can tie; roll until someone wins.
  while (await page.getByRole("button", { name: /who deploys first/ }).isVisible()) {
    await page.getByRole("button", { name: /who deploys first/ }).click();
  }
  // Two deployments, each in the deployer's own zone. Zone A is the top band, B the bottom.
  for (let i = 0; i < 2; i++) {
    const hint = await page.locator(".hint").innerText();
    const zone = hint.match(/zone ([AB])/)?.[1];
    await clickTable(page, 60 + i * 40, zone === "A" ? 110 : 10);
  }
  await page.screenshot({ path: "e2e-results/deployed.png" });
  while (await page.getByRole("button", { name: /first turn/ }).isVisible()) {
    await page.getByRole("button", { name: /first turn/ }).click();
  }
  await page.getByRole("button", { name: "Go first" }).click();
  await expect(page.locator(".clock .where")).toContainText("Round 1");
  await expect(page.locator(".log")).toContainText("Battle begins");

  // Autosave: a reload comes back to the same place.
  await page.reload();
  await expect(page.locator(".clock .where")).toContainText("Round 1");
  await page.screenshot({ path: "e2e-results/battle.png" });
});
