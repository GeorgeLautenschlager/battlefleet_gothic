/** The Raiders (p. 131) through the hot-seat form: the surprise roll, the defender's facing, deployment at anchor, and a raider moving on from the edge. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("The Raiders: caught napping, facing the bottom edge, and a raider moving on from the left edge", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("raiders");
  await expect(form.getByLabel(/^Raiders/)).toHaveValue("p2");
  await expect(form.getByLabel("Defender's points")).toHaveValue("500");
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await expect(page.locator(".log")).toContainText("The defenders are caught napping");
  await page.getByRole("button", { name: "Face the bottom edge" }).click();
  await expect(page.locator(".log")).toContainText("fleet faces the bottom edge");
  await expect(page.locator(".zone.p1")).toContainText("At anchor");
  await clickTable(page, 90, 60);
  await expect(page.locator(".clock .where")).toContainText("Round 1 of 8 ·");

  // The raiders go first, and every one of them moves on now.
  const panel = page.locator(".reinforcements");
  await expect(panel).toContainText("Raiders moving on");
  await expect(panel.getByRole("button", { name: "Leave the rest waiting" })).toHaveCount(0);
  await expect(page.locator(".entry-edges .edge")).toHaveCount(4);
  await panel.getByRole("button", { name: /^Bring on/ }).click();
  await clickTable(page, 3, 60);
  await expect(page.locator(".log")).toContainText("arrives from the table edge");
  await page.screenshot({ path: "e2e-results/raiders-arrival.png" });
});
