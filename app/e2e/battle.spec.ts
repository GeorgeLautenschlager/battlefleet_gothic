import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { logPageErrors, promiseScrollIntoView } from "./helpers";

const SAVE = fileURLToPath(new URL("./fixtures/seed-1337-setup.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

const banner = (page: Page) => page.locator(".banner");

async function moveStraight(page: Page, cm: number) {
  await page.getByLabel("Distance in cm").fill(String(cm));
  await page.getByRole("button", { name: "Move", exact: true }).click();
}

test("two rounds with the battle controls, a console shot and a brace decision", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  await expect(page.locator(".clock .where")).toContainText("Round 1");

  // Round 1, Bo (Chaos) first: straight ahead, then nothing in range.
  await expect(banner(page)).toContainText("Bo");
  await moveStraight(page, 25);
  await expect(page.locator(".log")).toContainText("Unclean moves 25 cm");
  await page.getByRole("button", { name: "Done shooting" }).click();

  // Ann (Imperial): an order that needs a Command check, then move; the Lunar has torpedoes to decline.
  await expect(banner(page)).toContainText("Ann");
  await page.getByRole("button", { name: "Lock On" }).click();
  await expect(page.locator(".log")).toContainText("Command check");
  await moveStraight(page, 20);
  await page.getByRole("button", { name: "Done shooting" }).click();
  await page.getByRole("button", { name: "Done launching" }).click();

  // Round 2, Bo closes and fires the prow lances through the console.
  await expect(page.locator(".clock .where")).toContainText("Round 2");
  await moveStraight(page, 25);
  await page.getByText("Transform console", { exact: true }).click();
  await page.getByLabel("Transform JSON").fill(
    JSON.stringify({ type: "fire", player: "p2", shipId: "ship-2", weaponId: "prow_lances", target: { kind: "ship", id: "ship-1" } }),
  );
  await page.getByRole("button", { name: "Apply" }).click();

  // Ann decides whether Agrippa braces.
  const prompt = page.getByRole("alertdialog", { name: "Brace for impact?" });
  await expect(prompt).toContainText("Agrippa is under attack from Unclean");
  await prompt.getByRole("button", { name: "Take it" }).click();
  await expect(page.locator(".log")).toContainText("Agrippa doesn't brace");
  await expect(page.locator(".log")).toContainText("Unclean lance at Agrippa");
  await page.screenshot({ path: "e2e-results/battle-round-2.png" });

  // Undo can't take the shot back: it rolled dice.
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});
