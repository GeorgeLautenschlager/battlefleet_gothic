/**
 * Network play end to end: two separate browsers (contexts) against the game
 * server running locally in workerd. The host creates a game, the guest joins
 * by the invite link, and setup plays out with each seat seeing only its own
 * controls.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clickTable, logPageErrors, promiseScrollIntoView } from "./helpers";

async function player(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await promiseScrollIntoView(page);
  logPageErrors(page);
  return page;
}

const where = (p: Page) => p.locator(".clock .where");
const log = (p: Page) => p.locator(".log");

test("host creates, guest joins by link, setup over the server, online undo, reconnect", async ({ browser }) => {
  const ann = await player(browser);
  const bo = await player(browser);

  // Ann creates an online game as the Imperials.
  await ann.goto("/");
  const online = ann.locator("form", { hasText: "Online" });
  await online.getByLabel("Your name").fill("Ann");
  await online.getByRole("button", { name: "Create game" }).click();
  await expect(ann.getByText("Waiting for your opponent")).toBeVisible();
  const link = await ann.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/#join=[\w-]+\.[\w-]+$/);

  // Bo opens the link and joins as Chaos.
  await bo.goto(link);
  await expect(bo.getByText("You've been invited")).toBeVisible();
  await expect(bo.getByText("Chaos · Murder")).toBeVisible();
  await bo.getByLabel("Your name").fill("Bo");
  await bo.getByRole("button", { name: "Join the battle" }).click();

  // Both are in the game, both online.
  for (const p of [ann, bo]) {
    await expect(where(p)).toContainText("Setup · Roll leadership");
    await expect(p.locator(".presence.online")).toHaveCount(2);
  }

  // Either player may roll; each roll shows up on both screens.
  await ann.getByRole("button", { name: "Roll Leadership" }).click();
  await expect(log(bo)).toContainText("for Leadership");
  await bo.getByRole("button", { name: /deployment zones/ }).click();
  await expect(log(ann)).toContainText("Zones rolled");
  while (await ann.getByRole("button", { name: /who deploys first/ }).isVisible()) {
    await ann.getByRole("button", { name: /who deploys first/ }).click();
    await ann.waitForTimeout(150);
  }
  await expect(where(ann)).toContainText("Deploy");

  // Whoever deploys first has the controls; the other waits.
  const annFirst = (await log(ann).innerText()).includes("Ann deploys first");
  const [mover, other, otherName] = annFirst ? [ann, bo, "Ann"] : [bo, ann, "Bo"];
  await expect(other.getByRole("status").filter({ hasText: `Waiting for ${otherName}` })).toBeVisible();
  const hint = await mover.locator(".hint").innerText();
  const zone = hint.match(/zone ([AB])/)?.[1];
  await clickTable(mover, 70, zone === "A" ? 110 : 10);
  await expect(log(other)).toContainText("deploys at");

  // Online undo: the deployer takes it back; both screens follow.
  await expect(mover.getByRole("button", { name: "Undo" })).toBeEnabled();
  await expect(other.getByRole("button", { name: "Undo" })).toBeDisabled();
  await mover.getByRole("button", { name: "Undo" }).click();
  await expect(other.getByRole("status").filter({ hasText: "Waiting for" })).toBeVisible();
  await expect(other.locator(".log li", { hasText: "deploys at" })).toHaveCount(0);

  // Reconnect: a reload comes back to the same game, from My games.
  await bo.reload();
  await expect(bo.getByRole("heading", { name: "My online games" })).toBeVisible();
  await bo.getByRole("button", { name: "Resume" }).click();
  await expect(where(bo)).toContainText("Deploy");
  await expect(log(bo)).toContainText("Zones rolled");
  await bo.screenshot({ path: "e2e-results/online-guest.png" });
});
