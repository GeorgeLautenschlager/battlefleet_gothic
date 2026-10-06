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
  await online.getByLabel("Commander").fill("Ann");
  await online.getByRole("button", { name: "Create game" }).click();
  await expect(ann.getByText("Waiting for your opponent")).toBeVisible();
  const link = await ann.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/#join=[\w-]+\.[\w-]+$/);

  // Bo opens the link and joins as Chaos.
  await bo.goto(link);
  await expect(bo.getByText("You've been invited")).toBeVisible();
  await expect(bo.getByText("Ann brings Imperial Navy: 1 × Lunar class cruiser (Agrippa).")).toBeVisible();
  await expect(bo.locator("fieldset").first()).toContainText("1 × Murder class cruiser"); // the other fleet, by default
  await bo.getByLabel("Commander").fill("Bo");
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

test("fleets online: two a side, a Chaos mirror match, names checked against the host's", async ({ browser }) => {
  const ann = await player(browser);
  const bo = await player(browser);

  await ann.goto("/");
  const online = ann.locator("form", { hasText: "Online" });
  await online.getByLabel("Cruisers a side").selectOption("2");
  await online.getByRole("combobox", { name: /^Fleet/ }).selectOption("chaos");
  await online.getByLabel("Commander").fill("Ann");
  await online.getByLabel("Ramming").uncheck();
  await online.getByRole("button", { name: "Create game" }).click();
  await expect(ann.getByText("Waiting for your opponent")).toBeVisible();
  await expect(ann.locator(".seats")).toContainText("Chaos: 2 × Murder class cruiser");
  const link = await ann.getByLabel("Invite link").inputValue();

  await bo.goto(link);
  await expect(bo.getByText("2 cruisers a side, no ramming")).toBeVisible();
  const form = bo.locator("form", { hasText: "You've been invited" });
  await form.getByRole("combobox", { name: /^Fleet/ }).selectOption("chaos");
  await expect(form.locator("fieldset").first()).toContainText("2 × Murder class cruiser");
  // The default names steer clear of Ann's; a clash is caught before it's sent.
  const annShips = (await ann.locator(".seats li.p1 .small").innerText()).match(/\((.*)\)/)?.[1]?.split(", ") ?? [];
  expect(annShips).toHaveLength(2);
  for (const n of annShips) await expect(form.getByLabel("Ship 1", { exact: true })).not.toHaveValue(n);
  await form.getByLabel("Ship 1", { exact: true }).fill(annShips[0] ?? "");
  await expect(form.getByRole("button", { name: "Join the battle" })).toBeDisabled();
  await form.getByLabel("Ship 1", { exact: true }).fill("Woe Unending");
  await form.getByLabel("Commander").fill("Bo");
  await form.getByRole("button", { name: "Join the battle" }).click();

  for (const p of [ann, bo]) {
    await expect(where(p)).toContainText("Setup · Roll leadership");
    await expect(p.locator(".card")).toHaveCount(4);
    await expect(p.locator(".card").filter({ hasText: "Murder class cruiser" })).toHaveCount(4);
  }
  await expect(bo.locator(".card").filter({ hasText: "Woe Unending" })).toHaveCount(1);
  await bo.screenshot({ path: "e2e-results/online-fleets.png" });
});

test("points battle online: the host sets the limit, each side brings its own number of ships", async ({ browser }) => {
  const ann = await player(browser);
  const bo = await player(browser);

  await ann.goto("/");
  const online = ann.locator("form", { hasText: "Online" });
  await online.getByLabel("Battle").selectOption("750");
  await online.getByLabel("Commander").fill("Ann");
  await online.getByRole("button", { name: "Add a ship" }).click();
  await online.getByRole("button", { name: "Add a ship" }).click();
  await online.getByLabel("Ship 1 class").selectOption("dictator");
  await expect(online.locator("fieldset").first()).toContainText("· 580 of 750 pts");
  await online.getByRole("button", { name: "Create game" }).click();
  await expect(ann.getByText("Waiting for your opponent")).toBeVisible();
  const link = await ann.getByLabel("Invite link").inputValue();

  await bo.goto(link);
  await expect(bo.getByText("750 points a side, victory points")).toBeVisible();
  const form = bo.locator("form", { hasText: "You've been invited" });
  await form.getByLabel("Commander").fill("Bo");
  // Starts with the host's three; a fourth Murder-class fits, a fifth ship doesn't.
  await form.getByRole("button", { name: "Add a ship" }).click();
  await form.getByRole("button", { name: "Add a ship" }).click();
  await expect(form.locator(".rejection")).toContainText("over the 750 pt limit");
  await expect(form.getByRole("button", { name: "Join the battle" })).toBeDisabled();
  await form.getByRole("button", { name: "Remove the last" }).click();
  await form.getByRole("button", { name: "Join the battle" }).click();

  for (const p of [ann, bo]) {
    await expect(where(p)).toContainText("Setup · Roll leadership");
    await expect(p.locator(".card")).toHaveCount(7);
    await expect(p.locator(".card").filter({ hasText: "Dictator class cruiser" })).toHaveCount(1);
  }
});
