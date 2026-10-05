/**
 * Attack craft in the UI. The fixture (carriers-launch.json, made with the
 * engine from a seeded game with carriers on) is at Ann's launch step in
 * round 1: the Dictator Fortitude at (90, 70) facing the Devastation
 * Deathbane at (90, 30), 40 cm apart.
 */
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

const SAVE = fileURLToPath(new URL("./fixtures/carriers-launch.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("launch a strike wave and a CAP fighter, then fly the wave by waypoints", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  await expect(page.locator(".clock .where")).toContainText("launch");

  // One Fury on CAP, one with the two Starhawks: four squadrons, the Dictator's bays.
  await page.getByLabel("Fury fighters").fill("1");
  await page.getByLabel("Fighters on CAP over this ship").fill("1");
  await page.getByRole("button", { name: "Launch 4 squadrons" }).click();
  await expect(page.locator(".log")).toContainText("Fortitude launches attack craft (2 waves)");
  await expect(page.locator(".card").filter({ hasText: "Fortitude" })).toContainText("Bays spent");
  await expect(page.locator(".card").filter({ hasText: "Fortitude" })).toContainText("CAP 1");
  await expect(page.locator("[data-wave]")).toHaveCount(2);
  await page.getByRole("button", { name: "Done launching" }).click();

  // Ordnance Phase: the strike wave flies; CAP stays with its ship.
  await expect(page.getByRole("heading", { name: "Fortitude's Fury, Starhawk, Starhawk" })).toBeVisible();
  await clickTable(page, 100, 60);
  await clickTable(page, 100, 40); // past the bombers' 20 cm: pulled back
  await expect(page.locator(".ship-controls")).toContainText(/19\.\d cm of 20 cm/);
  await page.screenshot({ path: "e2e-results/craft-plot.png" });
  await page.getByRole("button", { name: "Fly", exact: true }).click();
  await expect(page.locator(".log")).toContainText("Fortitude's Fury, Starhawk, Starhawk fly");
  await expect(page.locator(".clock .where")).toContainText("Round 1");
  await page.screenshot({ path: "e2e-results/craft-flown.png" });
});
