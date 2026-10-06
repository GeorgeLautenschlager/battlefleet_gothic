/** The Bait (p. 130) through the hot-seat form: who is pursued, a reinforcement, the bait at the centre, and bringing the reinforcement on. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("The Bait: the bait at the centre, the pursuers behind it, and a reinforcement arriving from the east edge", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("the_bait");
  await expect(form.getByLabel("Pursued")).toHaveValue("p1");
  await expect(form.getByLabel("Pursuers' points")).toHaveValue("500");
  // Player 1 adds a second Lunar and keeps it back as a reinforcement.
  const p1 = form.locator("fieldset.p1");
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await expect(form.locator(".rejection")).toContainText("one ship or one squadron");
  await p1.getByLabel("Ship 2 is a reinforcement").check();
  await expect(p1).toContainText("Bait 180 of 250 pts · reinforcements 180 of 500 pts");
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await expect(page.locator(".zone.p1")).toContainText("The bait");
  await clickTable(page, 90, 60); // the bait, at the centre
  await clickTable(page, 15, 60); // the pursuers, 60 cm behind
  await expect(page.locator(".clock .where")).toContainText("Round 1 ·");
  await expect(page.locator(".log")).toContainText("Battle begins");

  // Player 1 goes first and can bring the reinforcement on from the east edge.
  await expect(page.locator(".entry-edges")).toHaveCount(1);
  const panel = page.locator(".reinforcements");
  await panel.getByRole("button", { name: /^Bring on/ }).click();
  await clickTable(page, 178, 80);
  await expect(page.locator(".log")).toContainText("arrives from the table edge");
  await expect(page.locator(".reinforcements")).toHaveCount(0);
  await page.screenshot({ path: "e2e-results/bait-arrival.png" });
});
