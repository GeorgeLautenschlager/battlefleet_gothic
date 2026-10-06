/**
 * The nova cannon in the UI. The fixture (nova-cannon.json, made with the
 * engine from a seeded 500-point game) is at Ann's direct-fire step in round 1:
 * the Dominator Hammer of Justice at (90, 30) facing up the table, the Murder
 * Unclean at (90, 100) facing it, 70 cm apart.
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

const SAVE = fileURLToPath(new URL("./fixtures/nova-cannon.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("place the template on the table, the target braces or not, and the shell scatters", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  await expect(page.locator(".clock .where")).toContainText("Shooting");

  await page.getByRole("button", { name: /Prow nova cannon/ }).click();
  await expect(page.locator(".ship-controls")).toContainText("Click the table to place the template");
  await expect(page.locator(".targets li").filter({ hasText: "Unclean" })).toContainText("Fire at Unclean");

  // Too close: under 30 cm to the template's edge, so a click does nothing.
  await clickTable(page, 90, 50);
  await expect(page.locator(".ship-controls")).toContainText("Fire here");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.screenshot({ path: "e2e-results/nova-aim.png" });

  // Short of the Unclean, 55.7 cm to the edge: 2D6 of scatter, and the Unclean is within reach of it.
  await clickTable(page, 95, 88);
  await expect(page.getByRole("alertdialog", { name: "Brace for impact?" })).toContainText("Unclean is under attack from Hammer of Justice");
  await page.getByRole("alertdialog").getByRole("button", { name: "Take it" }).click();
  await expect(page.locator(".log")).toContainText(/Hammer of Justice fires its nova cannon at 55\.\d cm/);
  await page.screenshot({ path: "e2e-results/nova-fired.png" });
});
