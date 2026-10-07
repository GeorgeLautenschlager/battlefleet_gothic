import { describe, expect, test } from "vitest";
import type { GameState } from "@bfg/engine";
import { apply, current, fromSave, type History } from "../src/game/history";
import { classChoices, configProblem, optionIds, shipEntries, type Side } from "../src/game/config";
import { novaReach, novaShot, novaTargets } from "../src/fire/fire";
import { describe as prose } from "../src/log/format";
import save from "../e2e/fixtures/nova-cannon.json";

/** The e2e fixture: Ann's Dominator at (90, 30) facing the Unclean at (90, 100), at her direct-fire step. */
const fixture = (): History => fromSave(save) as History;

describe("ship options in the fleet forms (T57)", () => {
  test("Cruiser Clash offers the classes that can fit 185 points; a points battle offers them all", () => {
    expect(classChoices("imperial_navy", false)).toEqual(["lunar", "gothic", "tyrant", "dominator", "dauntless"]); // the Dominator, with its original batteries
    expect(classChoices("imperial_navy", false, true)).toEqual([
      "lunar", "gothic", "tyrant", "dominator", "dauntless", "mars", "overlord", "emperor", "retribution", "firestorm", "sword", "cobra",
      // and the planetary defences, for the planet holder (state N91)
      "laser_platform", "torpedo_platform", "weapons_platform", "orbital_dock", "space_station", "blackstone_fortress", "defence_monitor", "system_ship", "fire_ship",
    ]);
    expect(classChoices("chaos", false, true)).toContain("acheron");
    expect(classChoices("chaos", false, true)).toContain("repulsive");
    expect(classChoices("chaos", false)).not.toContain("repulsive"); // 230 pts, over Cruiser Clash's cap
  });

  test("options ride with each ship; a class's options are dropped when it doesn't have them", () => {
    const side: Side = { name: "Ann", fleet: "imperial_navy", ships: ["A", "B"], classes: ["lunar", "mars"], options: [["nova_cannon"], ["third_turret", "nova_cannon"]] };
    expect(optionIds(side, false, true)).toEqual([["nova_cannon"], ["third_turret"]]);
    expect(shipEntries(side, false, true)).toEqual([
      { name: "A", classId: "lunar", options: ["nova_cannon"] },
      { name: "B", classId: "mars", options: ["third_turret"] },
    ]);
    const bo: Side = { name: "Bo", fleet: "chaos", ships: ["C", "D"], classes: ["styx", "murder"] };
    expect(configProblem({ p1: side, p2: bo, ramming: true, boarding: false, forces: { kind: "points", limit: 750 } })).toBeNull();
    const clash: Side = { ...side, ships: ["A"], classes: ["lunar"], options: [["nova_cannon"]] };
    expect(configProblem({ p1: clash, p2: { ...bo, ships: ["C"], classes: ["murder"] }, ramming: true, boarding: false })).toMatch(/200 pts exceeds/);
  });
});

describe("aiming", () => {
  test("drop the template on an enemy's stem, or anywhere legal", () => {
    const s = current(fixture());
    const ship = s.ships[0]!;
    const weapon = ship.profile.weapons.find((w) => w.kind === "nova_cannon")!;
    const [unclean] = novaTargets(s, ship, weapon);
    expect(unclean).toMatchObject({ name: "Unclean", range: 67.5, reason: null });
    expect(unclean!.shot).toEqual({ type: "fire_nova_cannon", player: "p1", shipId: ship.id, weaponId: weapon.id, aim: { x: 90, y: 100 } });
    expect(novaReach(ship, { x: 90, y: 75 })).toEqual({ range: 42.5, dice: 1 });
    expect(novaShot(ship, weapon, { x: 90.04, y: 75.06 }).aim).toEqual({ x: 90, y: 75.1 }); // to the millimetre
    const r = apply(fixture(), novaShot(ship, weapon, { x: 90, y: 40 }));
    expect(r.ok ? null : r.reason.code).toBe("OUT_OF_RANGE");
  });
});

describe("log prose", () => {
  test("a nova cannon shot reads as a sentence", () => {
    const s: GameState = current(fixture());
    const entry = (data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind: "nova_cannon", actor: null, data }) as Parameters<typeof prose>[1];
    const base = { shipId: "ship-1", range: 67.5, ordnanceIds: [], blastMarkerId: null };
    expect(prose(s, entry({ ...base, rolls: [2, 6], scatter: "hit", ships: [{ shipId: "ship-2", hole: true, hits: 6 }] }))).toBe(
      "Hammer of Justice fires its nova cannon at 67.5 cm [2 6]: on target, Unclean 6 hits (centre)",
    );
    expect(prose(s, entry({ ...base, rolls: [4, 2, 4, 3, 1, 2], scatter: { bearing: 90, distance: 6 }, ships: [], ordnanceIds: ["ord-1"] }))).toBe(
      "Hammer of Justice fires its nova cannon at 67.5 cm [4 2 4 3 1 2]: scatters 6 cm on 90°, 1 ordnance destroyed",
    );
    expect(prose(s, entry({ ...base, rolls: [5, 1, 1, 6, 6, 6], scatter: { bearing: 0, distance: 18 }, ships: [] }))).toBe(
      "Hammer of Justice fires its nova cannon at 67.5 cm [5 1 1 6 6 6]: scatters 18 cm on 0°, touches nothing, off the table",
    );
  });
});
