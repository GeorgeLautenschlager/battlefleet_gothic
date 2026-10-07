import { describe, expect, test } from "vitest";
import { newGame } from "@bfg/engine";
import { cruiserClash, roleOf, sideProblem, type NewGameOptions } from "../src/game/config";
import { describe as prose } from "../src/log/format";

/** Ann blockades with a Lunar and a Gothic; Bo runs with a Murder. */
const options: NewGameOptions = {
  p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Invincible"], classes: ["lunar", "gothic"] },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  scenario: "blockade_run",
  forces: { kind: "points", limit: 500 },
  scoring: "victory_points",
  attacker: "p2",
  seed: 7,
};

describe("Blockade Run from the form", () => {
  test("the config names the runners; 6 turns; nobody in reserve", () => {
    const config = cruiserClash(options, new Date(0));
    expect(config.attacker).toBe("p2");
    const s = newGame(config);
    expect(s.scenario.maxRounds).toBe(6);
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "undeployed", "undeployed"]);
  });

  test("each side is checked in its own role: the runners at half the points", () => {
    expect(roleOf("blockade_run", "p2", "p1")).toEqual({ scenario: "blockade_run", defender: true });
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "blockade_run", defender: true })).toBeNull();
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "blockade_run", defender: false })).toMatch(/runners' fleet is 360 pts, over the 250 pt limit/);
  });

  test("the thirds and a run off the top edge read as sentences", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 0, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("thirds_roll", { rolls: [2, 5], thirds: { "ship-1": 0, "ship-2": 2 } }))).toBe("The blockade takes position [2 5]: Agrippa left, Invincible right");
    expect(prose(s, entry("disengaged", { shipId: "ship-3", reason: "table_edge", edge: 180 }))).toBe("Unclean disengages off the top edge");
  });
});
