import { expect, test, type Page } from "@playwright/test";

// Surface what the page was doing when a test fails: uncaught errors, console errors, and the accessibility tree.
test.beforeEach(({ page }) => {
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[console.${m.type()}] ${m.text()}`);
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log(`[page at failure]\n${await page.locator("body").ariaSnapshot()}`);
});

/** Click the table at a point in table cm (+y up). */
async function clickTable(page: Page, x: number, y: number) {
  const svg = page.locator("svg.table");
  const box = await svg.boundingBox();
  if (box === null) throw new Error("no table");
  // viewBox is -2 -2 184 124 (table 180 × 120).
  const sx = box.x + ((x + 2) / 184) * box.width;
  const sy = box.y + ((120 - y + 2) / 124) * box.height;
  await page.mouse.move(sx, sy);
  await page.mouse.click(sx, sy);
}

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
