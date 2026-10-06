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

test("fleets: a two-a-side Chaos mirror match, deploying and moving ships in the order picked", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Cruisers a side").selectOption("2");
  const p1 = form.locator("fieldset.p1");
  await p1.getByRole("combobox", { name: /^Fleet/ }).selectOption("chaos");
  await expect(p1).toContainText("2 × Murder class cruiser");
  await expect(form.locator("fieldset.p2")).toContainText("2 × Murder class cruiser");
  // Duplicate names are refused.
  const first = p1.getByLabel("Ship 1", { exact: true });
  const original = await first.inputValue();
  await first.fill(await form.locator("fieldset.p2").getByLabel("Ship 1", { exact: true }).inputValue());
  await expect(form.getByRole("button", { name: "Start" })).toBeDisabled();
  await first.fill(original);
  await form.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: "Roll Leadership" }).click();
  await page.getByRole("button", { name: /deployment zones/ }).click();
  while (await page.getByRole("button", { name: /who deploys first/ }).isVisible()) {
    await page.getByRole("button", { name: /who deploys first/ }).click();
  }
  // Four deployments. With two ships left to place, deploy the second one first.
  for (let i = 0; i < 4; i++) {
    const picker = page.getByRole("group", { name: "Deploy which ship" });
    if (await picker.isVisible()) {
      const last = picker.getByRole("button").last();
      const name = await last.innerText();
      await last.click();
      await expect(page.locator(".hint strong")).toHaveText(name);
    }
    const zone = (await page.locator(".hint").innerText()).match(/zone ([AB])/)?.[1];
    await clickTable(page, 50 + i * 20, zone === "A" ? 110 : 10);
  }
  while (await page.getByRole("button", { name: /first turn/ }).isVisible()) {
    await page.getByRole("button", { name: /first turn/ }).click();
  }
  await page.getByRole("button", { name: "Go first" }).click();
  await expect(page.locator(".banner")).toContainText("Chaos");

  // Pick the second ship to move first, from its card.
  const mover = page.getByRole("group", { name: "Move which ship" });
  const second = await mover.getByRole("button").nth(1).innerText();
  await page.locator(".card").filter({ hasText: second }).click();
  await expect(page.locator(".ship-controls h3")).toHaveText(second);
  await page.getByRole("button", { name: "Full ahead" }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.locator(".log")).toContainText(`${second} moves`);
  // One ship left: no picker, its controls straight away.
  await expect(mover).toBeHidden();
  await expect(page.locator(".ship-controls h3")).not.toHaveText(second);
  await page.screenshot({ path: "e2e-results/fleets.png" });
});

test("classes: a class per ship, carriers with the option, and the engine's limits", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Cruisers a side").selectOption("2");
  const [p1, p2] = [form.locator("fieldset.p1"), form.locator("fieldset.p2")];
  await expect(p1).toContainText("2 × Lunar class cruiser");
  await p1.getByLabel("Ship 2 class").selectOption("tyrant");
  await expect(p1).toContainText("1 × Lunar class cruiser (180 pts), 1 × Tyrant class cruiser (185 pts) · 365 pts");
  // No carriers without the option.
  await expect(p1.getByLabel("Ship 1 class").locator("option", { hasText: "Dictator" })).toHaveCount(0);
  await form.getByLabel("One carrier each, over the points cap (p. 129)").check();
  await p1.getByLabel("Ship 1 class").selectOption("dictator");
  await expect(p1).toContainText("1 × Dictator class cruiser (220 pts), 1 × Tyrant class cruiser (185 pts) · 405 pts");
  // Two carriers a side is the engine's no.
  await p2.getByLabel("Ship 1 class").selectOption("devastation");
  await p2.getByLabel("Ship 2 class").selectOption("devastation");
  await expect(form.locator(".rejection")).toContainText("only one carrier each");
  await expect(form.getByRole("button", { name: "Start" })).toBeDisabled();
  await p2.getByLabel("Ship 2 class").selectOption("slaughter");
  await form.screenshot({ path: "e2e-results/classes-form.png" });
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toContainText("Dictator class cruiser");
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toContainText("Bays ready");
  await expect(page.locator(".card").filter({ hasText: "Hammer of Terra" })).toContainText("Tyrant class cruiser");
  await expect(page.locator(".card").filter({ hasText: "Carrion Hymn" })).toContainText("Slaughter class cruiser");
});

test("points battle: each side spends its points, any number of ships, scored in victory points", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("750");
  await expect(form.getByLabel("Scoring")).toHaveValue("victory_points");
  await expect(form.getByLabel("Cruisers a side")).toHaveCount(0);
  await expect(form.getByText("One carrier each")).toHaveCount(0); // no cap, so no carrier option
  await form.getByLabel(/^Fleet lists/).uncheck(); // just the points here; fleet lists have their own test
  const [p1, p2] = [form.locator("fieldset.p1"), form.locator("fieldset.p2")];
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByLabel("Ship 1 class").selectOption("dictator"); // a carrier, no option needed
  await p1.getByLabel("Ship 2 class").selectOption("gothic");
  await expect(p1).toContainText("· 580 of 750 pts");
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByLabel("Ship 4 class").selectOption("tyrant");
  await expect(form.locator(".rejection")).toContainText("765 pts, over the 750 pt limit");
  await expect(form.getByRole("button", { name: "Start" })).toBeDisabled();
  await p1.getByRole("button", { name: "Remove the last" }).click();
  await p2.getByRole("button", { name: "Add a ship" }).click();
  await p2.getByLabel("Ship 2 class").selectOption("slaughter");
  await form.screenshot({ path: "e2e-results/points-form.png" });
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card")).toHaveCount(5);
  await expect(page.locator(".card").filter({ hasText: "Dictator class cruiser" })).toHaveCount(1);
});

test("ship options: a Mars with a targeting matrix and a third turret in a points battle", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("750");
  const p1 = form.locator("fieldset.p1");
  await p1.getByRole("combobox", { name: /^Class/ }).selectOption("mars");
  await p1.getByLabel(/Targeting matrix/).check();
  await p1.getByLabel(/Third turret/).check();
  await expect(p1).toContainText("1 × Mars class battlecruiser + targeting matrix + third turret (295 pts) · 295 of 750 pts");
  // A different class drops the options.
  await p1.getByRole("combobox", { name: /^Class/ }).selectOption("lunar");
  await expect(p1.getByLabel(/Nova cannon/)).not.toBeChecked();
  await p1.getByLabel(/Nova cannon/).check();
  await expect(p1).toContainText("1 × Lunar class cruiser + nova cannon (200 pts)");
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toBeVisible();
});

test("fleet lists: an Admiral over 750 points, a Warmaster with Marks and a Lord on their ships", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("1000");
  await expect(form.getByLabel(/^Fleet lists/)).toBeChecked();
  const [p1, p2] = [form.locator("fieldset.p1"), form.locator("fieldset.p2")];
  for (let i = 0; i < 3; i++) await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("combobox", { name: /^Ship 1 class/ }).selectOption("mars");
  await expect(form.locator(".rejection")).toContainText("must have an Admiral");
  await p1.getByRole("combobox", { name: /^Admiral/ }).selectOption("9");
  await p1.getByRole("combobox", { name: /^Extra re-rolls/ }).selectOption("1");
  await expect(p1).toContainText("commanders (125 pts)");
  // Chaos: the Warmaster rides the most expensive ship; give him Khorne, and a Lord with Tzeentch.
  await p2.getByRole("button", { name: "Add a ship" }).click();
  await p2.getByRole("combobox", { name: /^Ship 2 class/ }).selectOption("styx");
  await expect(form.locator(".rejection")).toContainText("one heavy cruiser per two cruisers"); // a Styx needs two cruisers
  await p2.getByRole("button", { name: "Add a ship" }).click();
  await expect(p2).toContainText("aboard the most expensive ship");
  await p2.getByLabel("Mark of Khorne (+20)").check();
  await p2.getByRole("button", { name: "Add a Chaos Lord" }).click();
  await p2.getByRole("combobox", { name: /^Chaos Lord 1 \(Ld 8, 50 pts\) aboard/ }).selectOption("0");
  await p2.getByRole("combobox", { name: /^Chaos Lord 1 mark/ }).selectOption("tzeentch");
  await expect(form.locator(".rejection")).toHaveCount(0);
  await form.screenshot({ path: "e2e-results/fleet-lists-form.png" });
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Mars class battlecruiser" })).toContainText("Admiral, Ld 9 · 2 re-rolls");
  await expect(page.locator(".card").filter({ hasText: "Styx class heavy cruiser" })).toContainText("Warmaster, Ld 8 · Mark of Khorne · 1 re-roll");
  await expect(page.locator(".card").filter({ hasText: "Murder class cruiser" }).first()).toContainText("Chaos Lord, Ld 8 · Mark of Tzeentch · 1 re-roll");
});

test("grand and light cruisers: a torpedo Dauntless and a shielded Repulsive under the fleet lists", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("1000");
  await expect(form.getByLabel(/^Fleet lists/)).toBeChecked();
  const [p1, p2] = [form.locator("fieldset.p1"), form.locator("fieldset.p2")];
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("combobox", { name: /^Ship 2 class/ }).selectOption("dauntless");
  await p1.getByLabel(/Prow torpedoes/).check();
  await expect(p1).toContainText("Dauntless class light cruiser + prow torpedoes (110 pts)");
  // The Repulsive needs three cruisers or heavy cruisers alongside it.
  await p2.getByRole("button", { name: "Add a ship" }).click();
  await p2.getByRole("combobox", { name: /^Ship 2 class/ }).selectOption("repulsive");
  await expect(form.locator(".rejection")).toContainText("one grand cruiser per three cruisers or heavy cruisers");
  for (let i = 0; i < 2; i++) await p2.getByRole("button", { name: "Add a ship" }).click();
  await p2.getByLabel(/Third shield/).check();
  await expect(p2).toContainText("Repulsive class grand cruiser + third shield (245 pts)");
  await expect(form.locator(".rejection")).toHaveCount(0);
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Dauntless class light cruiser" })).toBeVisible();
  await expect(page.locator(".card").filter({ hasText: "Repulsive class grand cruiser" })).toContainText("Warmaster");
});

test("battleships: an Emperor with Sharks against a refitted battle barge", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("1000");
  await form.getByLabel(/^Fleet lists/).uncheck(); // the ratios have their own tests
  const [p1, p2] = [form.locator("fieldset.p1"), form.locator("fieldset.p2")];
  await p1.getByRole("combobox", { name: /^Class/ }).selectOption("emperor");
  await p1.getByLabel(/Shark assault boats/).check();
  await expect(p1).toContainText("1 × Emperor class battleship + sharks (370 pts)");
  await p2.getByRole("combobox", { name: /^Class/ }).selectOption("chaos_battle_barge");
  await p2.getByLabel(/45 cm, FP 8/).check();
  await p2.getByLabel(/30 cm, FP 10/).check(); // the other battery refit drops the first
  await expect(p2.getByLabel(/45 cm, FP 8/)).not.toBeChecked();
  await p2.getByLabel(/Prow torpedoes/).check();
  await expect(p2).toContainText("1 × Chaos battle barge + batteries 30 + prow torpedoes (420 pts)");
  await expect(form.locator(".rejection")).toHaveCount(0);
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Emperor class battleship" })).toBeVisible();
  await expect(page.locator(".card").filter({ hasText: "Chaos battle barge" })).toBeVisible();
});

test("escorts: a squadron of Swords, named in the fleet form, shows on the ship cards", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Battle").selectOption("750");
  await form.getByLabel(/^Fleet lists/).uncheck();
  const p1 = form.locator("fieldset.p1");
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("button", { name: "Add a ship" }).click();
  await p1.getByRole("combobox", { name: /^Ship 2 class/ }).selectOption("sword");
  await p1.getByRole("combobox", { name: /^Ship 3 class/ }).selectOption("sword");
  await p1.getByLabel("Ship 2 squadron").fill("Blue Squadron");
  await p1.getByLabel("Ship 3 squadron").fill("Blue Squadron");
  await expect(form.locator(".rejection")).toHaveCount(0);
  // A Lunar can't share a squadron with escorts.
  await p1.getByLabel("Ship 1 squadron").fill("Blue Squadron");
  await expect(form.locator(".rejection")).toContainText("can't share a squadron");
  await p1.getByLabel("Ship 1 squadron").fill("");
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Sword class frigate" })).toHaveCount(2);
  await expect(page.locator(".card").filter({ hasText: "Sword class frigate" }).first()).toContainText("Blue Squadron");
});
