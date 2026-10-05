/**
 * Boarding in the UI. The fixture (boarding-round-2.json, made with the engine
 * from a seeded game with boarding on) starts round 2 with Agrippa to move,
 * 18 cm from Unclean and face to face.
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { logPageErrors, promiseScrollIntoView } from "./helpers";

const SAVE = fileURLToPath(new URL("./fixtures/boarding-round-2.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("close to base contact, declare a boarding action, fight it in the End Phase", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  await expect(page.locator(".clock .where")).toContainText("Round 2");
  await expect(page.locator(".banner")).toContainText("Ann");

  // 15 cm puts the bases in contact: the plotter offers to board.
  await page.getByLabel("Advance distance in cm").fill("15");
  await page.getByRole("button", { name: "Advance", exact: true }).click();
  const board = page.getByRole("button", { name: "Board Unclean" });
  await expect(board).toBeVisible();
  await board.click();
  await expect(board).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.locator(".log")).toContainText("Agrippa closes to board Unclean");

  // A boarding ship can't shoot, so the turn runs straight on to the End Phase.
  await expect(page.locator(".clock .where")).toContainText("boarding");
  await expect(page.getByRole("heading", { name: "Board Unclean" })).toBeVisible();
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toContainText("Boarding Unclean");
  await page.screenshot({ path: "e2e-results/boarding-panel.png" });
  await page.getByRole("button", { name: "Fight" }).click();
  await expect(page.locator(".log")).toContainText(/Agrippa boards Unclean: \[\d \d\] → \d+ vs \d+/);
  await page.screenshot({ path: "e2e-results/boarding-fought.png" });
});
