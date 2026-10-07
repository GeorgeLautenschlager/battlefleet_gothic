/** Mines, minefields and fire ships (fleets book pp. 512–513, 516): bought with the holder's fleet, placed before deployment, and a fire ship going off. */
import { expect, test } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

test.beforeEach(async ({ page }) => {
  await promiseScrollIntoView(page);
  logPageErrors(page);
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

test("Player 1 lays a minefield and two mines round the planet, then detonates a fire ship", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("750");
  await form.getByLabel("Planet in the centre").selectOption("medium");
  const p1 = form.locator("fieldset.p1");
  // Two fire ships: escorts squadron in twos or more under the fleet lists.
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByLabel("Ship 2 class").selectOption("fire_ship");
  await p1.getByLabel("Ship 3 class").selectOption("fire_ship");
  await p1.getByLabel("Orbital mines").fill("2");
  await p1.getByLabel("Minefields").selectOption("1");
  await expect(p1).toContainText("2 × orbital mine (5 pts), 1 × minefield (40 pts)");
  await expect(p1).toContainText("defences 70 of 250 pts");
  await expect(form.locator("fieldset.p2").getByLabel("Orbital mines")).toHaveCount(0); // Player 2 doesn't hold the planet
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await page.getByRole("button", { name: "Roll for deployment zones" }).click();
  const order = page.getByRole("button", { name: "Roll off: who deploys first" });
  while (await order.isVisible()) await order.click();

  // The minefield first (its edge within 15 cm of the planet, whose edge is 12.5 cm from the centre at 90, 60), then the mines in the well.
  await expect(page.locator(".hint").first()).toContainText("place your defences");
  await clickTable(page, 63, 60); // 5–15 cm wide: its right edge 65.5–70.5, within 15 cm of the planet whatever the dice
  await expect(page.locator(".minefield")).toHaveCount(1);
  await expect(page.locator(".hint").first()).toContainText("An orbital mine goes in the planet's gravity well");
  await clickTable(page, 90, 82);
  await clickTable(page, 110, 60);
  await expect(page.locator(".mine")).toHaveCount(2);

  // Four placements: the cruisers in their zones, the fire ships side by side in the gravity well.
  const torches = [{ x: 75, y: 75 }, { x: 80, y: 78 }];
  for (let i = 0; i < 4; i++) {
    const hint = (await page.locator(".hint").first().textContent()) ?? "";
    const torch = hint.includes("planetary defence") ? torches.shift() : undefined;
    if (torch !== undefined) await clickTable(page, torch.x, torch.y);
    else if (hint.includes("zone A")) await clickTable(page, 90, 105);
    else await clickTable(page, 90, 15);
    await expect(page.locator(".log li").filter({ hasText: "deploys at" })).toHaveCount(i + 1);
  }

  const first = page.getByRole("button", { name: "Roll off: who chooses first turn" });
  const goFirst = page.getByRole("button", { name: "Go first" });
  await first.click();
  while (!(await goFirst.isVisible())) await first.click();
  // Player 1 if they won the roll-off, else they choose to go second: the fire ship's turn comes either way.
  const chooser = (await page.locator(".hint").first().textContent()) ?? "";
  if (chooser.includes("Player 1")) await goFirst.click();
  else await page.getByRole("button", { name: "Go second" }).click();
  await expect(page.locator(".clock .where")).toContainText("Round 1 of 8 ·");

  await page.getByRole("button", { name: "Detonate" }).first().click();
  await expect(page.locator(".log li").filter({ hasText: "detonates" })).toHaveCount(1);
  await page.screenshot({ path: "e2e-results/mines.png" });
});
