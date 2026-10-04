import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

const SAVE = fileURLToPath(new URL("./fixtures/seed-1337-setup.json", import.meta.url));

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

const banner = (page: Page) => page.locator(".banner");

async function fullAhead(page: Page) {
  await page.getByRole("button", { name: "Full ahead" }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
}

test("two rounds with the battle controls, a console shot and a brace decision", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  await expect(page.locator(".clock .where")).toContainText("Round 1");

  // Round 1, Bo (Chaos) first: straight ahead, then nothing in range.
  await expect(banner(page)).toContainText("Bo");
  await fullAhead(page);
  await expect(page.locator(".log")).toContainText("Unclean moves 25 cm");
  await page.getByRole("button", { name: "Done shooting" }).click();

  // Ann (Imperial): an order that needs a Command check, then move; the Lunar has torpedoes to decline.
  await expect(banner(page)).toContainText("Ann");
  await page.getByRole("button", { name: "Lock On" }).click();
  await expect(page.locator(".log")).toContainText("Command check");
  await fullAhead(page);
  await expect(page.locator(".log")).toContainText("Agrippa moves 20 cm");
  await page.getByRole("button", { name: "Done shooting" }).click();
  await page.getByRole("button", { name: "Done launching" }).click();

  // Round 2, Bo closes and fires the prow lances through the console.
  await expect(page.locator(".clock .where")).toContainText("Round 2");
  await fullAhead(page);
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

test("plotting a move by clicking: straight, then a 45° turn", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SAVE);
  const status = page.locator(".plot-status");
  const move = page.getByRole("button", { name: "Move", exact: true });

  // Unclean is at (95, 15) heading 0 (up the table): speed 25, at least 12.5, turn after 10.
  await clickTable(page, 95, 21);
  await expect(status).toContainText("at least 12.5"); // legal so far, but too short
  await expect(move).toBeDisabled();
  await expect(page.locator(".plot-stats")).toContainText("next after");

  await clickTable(page, 95, 26); // 11 cm: a turn is now allowed
  await expect(page.locator(".plot-turn")).toHaveCount(2);
  await clickTable(page, 102, 33); // 45° to starboard, about 10 cm
  await expect(status).toHaveText("Legal move.");
  await expect(page.locator(".plot-stats")).toContainText("1 / 1");

  // Keyboard: step back (the advance, then the turn), then redo it.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".plot-stats")).toContainText("0 / 1");
  await clickTable(page, 102, 33);
  await page.keyboard.press("Enter");
  await expect(page.locator(".log")).toContainText(/Unclean moves 2\d(\.\d)? cm/);
  await page.screenshot({ path: "e2e-results/plotted.png" });
});
