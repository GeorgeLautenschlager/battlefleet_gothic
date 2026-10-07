/**
 * Points battles and victory points (state v0.10 §4, §11, N11–N12;
 * transforms v0.8 §5, T36–T38; reducer v0.7 game_end).
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { holdingTheField, score, shipVP, victoryPoints } from "../src/state/derived";
import { Ctx } from "../src/reducer/context";
import { endGame } from "../src/reducer/steps";
import type { GameState, Ship } from "../src/state/types";
import { LUNAR_VS_MURDER } from "./helpers";
import { addShip, agrippa, battle, unclean } from "./validator-fixtures";

const points = (p1: string[], p2: string[], limit = 750, scoring: GameConfig["scoring"] = "victory_points"): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  forces: { kind: "points", limit },
  scoring,
  ships: [...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })), ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId }))],
});

describe("points forces (T36)", () => {
  test("any number a side within the limit, carriers with no option, the forces kept in the scenario", () => {
    const s = newGame(points(["dictator", "gothic", "lunar"], ["devastation", "slaughter", "slaughter", "murder"]));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario.forces).toEqual({ kind: "points", limit: 750 });
    expect(s.scenario.scoring).toBe("victory_points");
    expect(s.ships.filter((x) => x.owner === "p2")).toHaveLength(4);
  });

  test("over the limit, an empty side or a bad limit is refused; fleets and rarity still hold", () => {
    expect(() => newGame(points(["dictator", "dictator", "tyrant", "lunar"], ["murder"]))).toThrow(/805 pts, over the 750 pt limit/);
    expect(() => newGame(points([], ["murder"]))).toThrow(/at least one ship/);
    expect(() => newGame({ ...points(["lunar"], ["murder"]), forces: { kind: "points", limit: 0 } })).toThrow(/positive whole number/);
    expect(() => newGame(points(["murder"], ["murder"]))).toThrow(/can't serve/);
    expect(() => newGame(points(["lunar"], ["murder_lances", "murder_lances", "murder_lances"]))).toThrow(/at most 2/);
  });

  test("Cruiser Clash stays the default: equal numbers, the 185-point cap", () => {
    const s = newGame(LUNAR_VS_MURDER);
    expect(s.scenario.forces).toEqual({ kind: "cruiser_clash" });
    expect(s.scenario.scoring).toBe("cruiser_clash");
    expect(() => newGame({ ...cloneJson(LUNAR_VS_MURDER), ships: [...LUNAR_VS_MURDER.ships, { owner: "p1", name: "X", classId: "lunar" }] })).toThrow(/same number/);
  });
});

/** The example state with victory points scoring and a second Lunar. Agrippa and the Lunar are 180 pts, Unclean (Murder) 170. */
function vpState(): GameState {
  const s = battle();
  s.scenario.scoring = "victory_points";
  addShip(s, agrippa(s), { id: "ship-3", name: "Hammer of Terra", position: { x: 20, y: 20 } });
  return s;
}
const hulk = (ship: Ship) => Object.assign(ship, { status: "drifting_hulk", damage: ship.profile.hits });

describe("victory points (N11–N12)", () => {
  test("destroyed is full value, crippled 25%, disengaged 10% or 25%, each rounded up", () => {
    const s = vpState();
    expect(shipVP(agrippa(s))).toBeNull();
    agrippa(s).damage = 4;
    expect(shipVP(agrippa(s))).toEqual({ shipId: "ship-1", vp: 45, why: "crippled" });
    Object.assign(agrippa(s), { status: "disengaged", position: null, heading: null });
    expect(shipVP(agrippa(s))).toEqual({ shipId: "ship-1", vp: 45, why: "disengaged" });
    agrippa(s).damage = 1;
    expect(shipVP(agrippa(s))?.vp).toBe(18); // 10% of 180
    unclean(s).damage = 4;
    expect(shipVP(unclean(s))?.vp).toBe(43); // 25% of 170 = 42.5, up
    hulk(unclean(s));
    expect(shipVP(unclean(s))).toEqual({ shipId: "ship-2", vp: 170, why: "destroyed" });
  });

  test("holding the field: the side still fighting takes half of every hulk on the table, friend or foe", () => {
    const s = vpState();
    hulk(unclean(s)); // p2 has nothing left fighting
    hulk(s.ships.find((x) => x.id === "ship-3")!); // and p1 lost a Lunar to a hulk
    expect(holdingTheField(s, "p1")).toBe(85 + 90);
    expect(holdingTheField(s, "p2")).toBe(0);
    expect(victoryPoints(s, "p1")).toEqual({ total: 170 + 175, ships: [{ shipId: "ship-2", vp: 170, why: "destroyed" }], squadrons: [], field: 175, mines: 0 });
    expect(score(s, "p2")).toBe(180); // the hulked Lunar
  });

  test("game end scores and logs the breakdown", () => {
    const s = vpState();
    hulk(unclean(s));
    const ctx = new Ctx(s);
    endGame(ctx, "fleet_eliminated");
    expect(s.result).toEqual({ reason: "fleet_eliminated", scores: { p1: 255, p2: 0 }, winner: "p1" });
    expect(s.log.at(-1)?.data).toMatchObject({
      scoring: "victory_points",
      breakdown: { p1: { ships: [{ shipId: "ship-2", vp: 170, why: "destroyed" }], field: 85 }, p2: { ships: [], field: 0 } },
    });
  });
});
