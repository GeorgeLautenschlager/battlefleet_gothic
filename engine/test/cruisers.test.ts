/**
 * The remaining Cruiser Clash cruisers: combined battery volleys (transform
 * T32–T34, validator checks 21–25, reducer §4.1, R25), improved thrusters
 * (state N10) and rarity limits (T35).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import type { GameState } from "../src/state/types";
import { battle, broadside, expectOk, expectReject, unclean } from "./validator-fixtures";
import { logOf, playDice } from "./reducer-helpers";
import { LUNAR_VS_MURDER } from "./helpers";

const as = (s: GameState, classId: string): GameState => {
  unclean(s).profile = cloneJson(CATALOGUE[classId]!.profile);
  return s;
};

/** The broadside geometry (Unclean at (100, 50) h180, Agrippa 24.3 cm off its starboard beam), Unclean refitted as a Carnage. */
const carnage = (): GameState => as(broadside(), "carnage");
const fire = (patch: Record<string, unknown> = {}) => ({
  type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target: { kind: "ship", id: "ship-1" }, ...patch,
});

describe("combined batteries: validation (checks 21–25)", () => {
  test("the starboard batteries and the prow battery can all fire at a target off the starboard beam", () => {
    expectOk(carnage(), fire({ combineWith: ["starboard_long_battery", "prow_battery"] }));
    expectOk(carnage(), fire({ combineWith: [] }));
  });

  test("only batteries, each once, besides the main one", () => {
    const lances = as(broadside(), "inferno");
    expectReject(lances, fire({ weaponId: "starboard_lances", combineWith: ["starboard_battery"] }), "INVALID_VOLLEY");
    expectReject(carnage(), fire({ combineWith: ["prow_battery", "prow_battery"] }), "INVALID_VOLLEY");
    expectReject(carnage(), fire({ combineWith: ["starboard_battery"] }), "INVALID_VOLLEY");
    expectReject(as(broadside(), "inferno"), fire({ combineWith: ["starboard_lances"] }), "WRONG_WEAPON_KIND");
    expectReject(carnage(), fire({ combineWith: ["dorsal_battery"] }), "UNKNOWN_WEAPON");
  });

  test("each battery must be ready, in range and bear on the target", () => {
    const fired = carnage();
    fired.turnState.ships["ship-2"]!.weaponsFired.push("prow_battery");
    expectReject(fired, fire({ combineWith: ["prow_battery"] }), "WEAPON_ALREADY_FIRED");
    expectReject(carnage(), fire({ combineWith: ["port_battery"] }), "OUT_OF_ARC");
    const far = carnage();
    far.ships.find((x) => x.id === "ship-1")!.position = { x: 50, y: 46 }; // ~50 cm: the 60 cm battery reaches, the 45 cm one doesn't
    expectOk(far, fire({ weaponId: "starboard_long_battery", combineWith: ["prow_battery"] }));
    expectReject(far, fire({ weaponId: "starboard_long_battery", combineWith: ["starboard_battery"] }), "OUT_OF_RANGE", { weaponId: "starboard_battery" });
  });
});

describe("combined batteries: one volley (reducer §4.1, R25)", () => {
  test("firepower adds up before the Gunnery Table: 6 + 4 + 6 = 16 abeam is 6 dice, not 2 + 1 + 2", () => {
    const offered = playDice(carnage(), fire({ combineWith: ["starboard_long_battery", "prow_battery"] }) as never, []);
    expect(offered.pending).toHaveLength(1); // one brace offer for the volley
    expect(offered.turnState.ships["ship-2"]!.weaponsFired).toEqual(["starboard_battery", "starboard_long_battery", "prow_battery"]);
    const s = playDice(offered, { type: "answer_brace", player: "p1", pendingId: offered.pending[0]!.id, attempt: false }, [6, 2, 5, 3, 1, 1]);
    const [attack] = logOf(s, "attack");
    expect(attack?.data).toMatchObject({
      weapon: "battery",
      weaponIds: ["starboard_battery", "starboard_long_battery", "prow_battery"],
      firepower: 16,
      column: "D",
      rolls: [6, 2, 5, 3, 1, 1],
      hits: 2,
    });
  });
});

describe("improved thrusters (state N10)", () => {
  test("a Slaughter rolls 5D6 for All Ahead Full", () => {
    const s0 = as(battle(), "slaughter");
    // Command check [3, 4] passes Ld 7; then 5D6.
    const s = playDice(s0, { type: "declare_order", player: "p2", shipId: "ship-2", order: "all_ahead_full" }, [3, 4, 1, 2, 3, 4, 5]);
    expect(logOf(s, "aaf_roll")[0]?.data).toEqual({ shipId: "ship-2", rolls: [1, 2, 3, 4, 5], extra: 15 });
    expect(s.activation).toMatchObject({ aafExtra: 15, maxDistance: 45, minDistance: 45 });
  });
});

describe("the new classes in Cruiser Clash", () => {
  const fleet = (p1: string[], p2: string[]): GameConfig => ({
    ...cloneJson(LUNAR_VS_MURDER),
    ships: [...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })), ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId }))],
  });

  test("every Imperial and Chaos cruiser fits the 185-point cap", () => {
    const s = newGame(fleet(["lunar", "gothic", "tyrant"], ["carnage", "inferno", "slaughter"]));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships.map((x) => x.profile.points)).toEqual([180, 180, 185, 180, 180, 165]);
  });

  test("no more than two Murder lance variants per 750 points (T35)", () => {
    expect(() => newGame(fleet(["lunar", "lunar"], ["murder_lances", "murder_lances"]))).not.toThrow();
    expect(() => newGame(fleet(["lunar", "lunar", "lunar"], ["murder_lances", "murder_lances", "murder_lances"]))).toThrow(/at most 2/);
  });

  test("classes stay in their fleet", () => {
    expect(() => newGame(fleet(["carnage"], ["murder"]))).toThrow(/can't serve/);
  });
});
