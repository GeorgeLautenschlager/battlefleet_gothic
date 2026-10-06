import { describe, expect, test } from "vitest";
import { newGame, type GameState } from "@bfg/engine";
import { cruiserClash, type NewGameOptions } from "../src/game/config";
import { describe as prose } from "../src/log/format";

const options: NewGameOptions = {
  p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Invincible"], classes: ["lunar", "gothic"] },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  scenario: "fleet_engagement",
  forces: { kind: "points", limit: 500 },
  scoring: "victory_points",
  seed: 7,
};

describe("a Fleet Engagement from the form", () => {
  test("the config carries the scenario: unequal numbers within the points, no round limit", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    expect(s.scenario).toMatchObject({ id: "fleet_engagement", maxRounds: null, scoring: "victory_points" });
    expect(s.ships).toHaveLength(3);
  });

  test("the set-up log reads as sentences, the first formation unnamed", () => {
    const s: GameState = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 0, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("formation", { player: "p1" }))).toBe("Ann picks a formation");
    expect(prose(s, entry("formation", { player: "p2", formations: { p1: "cross", p2: "wedge" } }))).toBe("Formations revealed: Ann cross, Bo wedge");
    expect(prose(s, entry("setup_roll", { rolls: [4, 3], bonus: [0, 1], totals: [4, 4], split: true, winner: null }))).toBe("Set-up roll-off [4 3+1]: a tie, roll again");
    expect(prose(s, entry("setup_roll", { rolls: [6, 3], bonus: [0, 0], totals: [6, 3], split: false, winner: "p1" }))).toBe("Set-up roll-off [6 3]: Ann picks the set-up");
    expect(prose(s, entry("setup_choice", { player: "p1", map: "B", colours: { p1: "dark", p2: "white" } }))).toBe("Ann picks map B: Ann dark grey, Bo white");
  });
});
