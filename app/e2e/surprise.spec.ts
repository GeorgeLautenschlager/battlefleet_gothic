/** Surprise Attack (p. 132) through the hot-seat form: the alert roll, units on full alert and on standby, deploying round the planet, and the attackers' one edge. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("Surprise Attack: four Lunars caught round a medium planet, and the attackers moving on from one edge", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Scenario").selectOption("surprise_attack");
  await expect(form.getByLabel("Attacker")).toHaveValue("p2");
  await expect(form.getByLabel("Points a side")).toHaveValue("750");
  await expect(form).toContainText("caught round a medium planet");
  await expect(form.getByLabel("Planet in the centre")).toHaveCount(0);
  // Four defending units, so at least one is on standby whatever the D3.
  const p1 = form.locator("fieldset.p1");
  for (let i = 0; i < 3; i++) await p1.getByRole("button", { name: "Add a ship" }).click();
  await form.locator("fieldset.p2").getByRole("button", { name: "Add a ship" }).click();
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".planet")).toHaveCount(1);

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await expect(page.locator(".log")).toContainText("caught at anchor");
  await page.getByRole("button", { name: "Full alert" }).click();
  await expect(page.locator(".log")).toContainText("on full alert");

  // The planet's own defences: four Lunars are 720 pts, two dice, at least 20 pts. Two orbital mines, placed in the gravity well.
  await expect(page.locator(".log")).toContainText("has defences of its own");
  await page.getByLabel("Orbital mines").fill("2");
  await page.getByRole("button", { name: /^Buy \(10 of/ }).click();
  await expect(page.locator(".log")).toContainText("buys 2 orbital mines");
  await clickTable(page, 90, 82);
  await clickTable(page, 90, 38);
  await expect(page.locator(".mine")).toHaveCount(2);

  // Alert ships in the zone, facing up; standby ships broadside round the planet (centre 90, 60), the planet to starboard.
  const alertSpots = [
    [40, 40],
    [140, 40],
    [40, 80],
  ];
  const standbySpots = [
    [90, 80],
    [110, 60],
    [110, 75],
    [70, 60],
  ];
  for (let i = 0; i < 4; i++) {
    const hint = (await page.locator(".hint").first().textContent()) ?? "";
    const [x = 0, y = 0] = (hint.includes("on standby") ? standbySpots : alertSpots).shift() ?? [];
    await clickTable(page, x, y);
    await expect(page.locator(".log li").filter({ hasText: "deploys at" })).toHaveCount(i + 1);
  }
  await expect(page.locator(".clock .where")).toContainText("Round 1 ·");
  await expect(page.locator(".ships")).toContainText("On standby");

  // The attackers go first, all from one edge: the first arrival picks it.
  const panel = page.locator(".reinforcements");
  await expect(panel).toContainText("Attackers moving on");
  await expect(page.locator(".entry-edges .edge")).toHaveCount(4);
  await panel.getByRole("button", { name: /^Bring on/ }).first().click();
  await clickTable(page, 3, 60);
  await expect(page.locator(".log")).toContainText("arrives from the table edge");
  await expect(page.locator(".entry-edges .edge")).toHaveCount(1);
  await page.screenshot({ path: "e2e-results/surprise-attack.png" });
});
