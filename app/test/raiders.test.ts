import { describe, expect, test } from "vitest";
import { newGame } from "@bfg/engine";
import { cruiserClash, roleOf, sideProblem, type NewGameOptions } from "../src/game/config";
import { describe as prose } from "../src/log/format";

/** Ann defends with a Lunar and a Gothic; Bo raids with a Murder. */
const options: NewGameOptions = {
  p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Invincible"], classes: ["lunar", "gothic"], reserves: [false, true] },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  scenario: "raiders",
  forces: { kind: "points", limit: 500 },
  scoring: "victory_points",
  attacker: "p2",
  seed: 7,
};

describe("The Raiders from the form", () => {
  test("the config names the raiders, who all start in reserve; reinforcement ticks don't apply", () => {
    const config = cruiserClash(options, new Date(0));
    expect(config.attacker).toBe("p2");
    expect(config.ships.some((s) => s.reserve === true)).toBe(false);
    expect(newGame(config).ships.map((s) => s.status)).toEqual(["undeployed", "undeployed", "reserve"]);
  });

  test("each side is checked in its own role: the raiders at half the points", () => {
    expect(roleOf("raiders", "p2", "p1")).toEqual({ scenario: "raiders", defender: true });
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "raiders", defender: true })).toBeNull();
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "raiders", defender: false })).toMatch(/raiders' fleet is 360 pts, over the 250 pt limit/);
  });

  test("the surprise and the facing read as sentences", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 0, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("surprise_roll", { rolls: [3], turns: 3 }))).toBe("The defenders are caught napping [3]: −1 Leadership for the first 3 turns");
    expect(prose(s, entry("facing", { player: "p1", heading: 180 }))).toBe("Ann's fleet faces the bottom edge");
  });
});
