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
  await p1.getByLabel("Fleet").selectOption("chaos");
  await expect(p1).toContainText("2 × Murder class cruiser");
  await expect(form.locator("fieldset.p2")).toContainText("2 × Murder class cruiser");
  // Duplicate names are refused.
  const first = p1.getByLabel("Ship 1");
  const original = await first.inputValue();
  await first.fill(await form.locator("fieldset.p2").getByLabel("Ship 1").inputValue());
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

test("carriers: with the option on, each side brings its carrier first", async ({ page }) => {
  await page.goto("/");
  const form = page.locator("form", { hasText: "Hot-seat" });
  await form.getByLabel("Cruisers a side").selectOption("2");
  await expect(form.locator("fieldset.p1")).toContainText("2 × Lunar class cruiser");
  await form.getByLabel("One carrier each, over the points cap (p. 129)").check();
  await expect(form.locator("fieldset.p1")).toContainText("1 × Dictator class cruiser (220 pts), 1 × Lunar class cruiser (180 pts) · 400 pts");
  await expect(form.locator("fieldset.p2")).toContainText("1 × Devastation class cruiser (190 pts), 1 × Murder class cruiser (170 pts) · 360 pts");
  // Player 2 leaves theirs at home.
  await form.locator("fieldset.p2").getByLabel(/Bring a carrier/).uncheck();
  await expect(form.locator("fieldset.p2")).toContainText("2 × Murder class cruiser");
  await form.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toContainText("Dictator class cruiser");
  await expect(page.locator(".card").filter({ hasText: "Agrippa" })).toContainText("Bays ready");
  await expect(page.locator(".card").filter({ hasText: "Unclean" })).toContainText("Murder class cruiser");
});
