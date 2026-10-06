/**
 * Per-ship options and the battlecruisers and heavy cruisers (state v0.13
 * §7.1, N20–N21; transforms v0.11 §5, T57, T64, T66; reducer v0.10 §4.1).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE, profileWithOptions } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { columnShift } from "../src/reducer/gunnery";
import { LUNAR_VS_MURDER } from "./helpers";
import { agrippa, broadside, unclean } from "./validator-fixtures";

/** A profile without its class name and options, to compare an optioned class with an old option class. */
const without = (p: ReturnType<typeof profileWithOptions>) => ({ ...p, classId: "", className: "", options: [] });

describe("options applied to a profile (T57)", () => {
  test("the nova cannon and 45 cm options match the old option classes", () => {
    expect(without(profileWithOptions("lunar", ["nova_cannon"]))).toEqual(without(CATALOGUE["lunar_nova"]!.profile));
    expect(without(profileWithOptions("tyrant", ["long_batteries", "nova_cannon"]))).toEqual(without(CATALOGUE["tyrant_long_nova"]!.profile));
    expect(without(profileWithOptions("tyrant", ["nova_cannon", "long_batteries"]))).toEqual(without(CATALOGUE["tyrant_long_nova"]!.profile)); // catalogue order
    expect(without(profileWithOptions("dominator", ["long_batteries"]))).toEqual(without(CATALOGUE["dominator_long"]!.profile));
    expect(profileWithOptions("lunar", ["nova_cannon"]).options).toEqual(["nova_cannon"]);
    expect(profileWithOptions("lunar").options).toBeUndefined();
  });

  test("battlecruisers: a targeting matrix and a third turret, +15 and +10", () => {
    const mars = profileWithOptions("mars", ["third_turret", "targeting_matrix"]);
    expect(mars).toMatchObject({ points: 295, turrets: 3, traits: { targetingMatrix: true }, options: ["targeting_matrix", "third_turret"] });
    expect(CATALOGUE["mars"]!.profile.turrets).toBe(2); // the class is untouched
  });

  test("unknown or repeated options are refused", () => {
    expect(() => profileWithOptions("lunar", ["third_turret"])).toThrow(/no option/);
    expect(() => profileWithOptions("lunar", ["nova_cannon", "nova_cannon"])).toThrow(/twice/);
  });
});

describe("the new hulls (T66)", () => {
  test("battlecruisers and heavy cruisers: cruisers in the core rules, with their category", () => {
    const rows = ["mars", "overlord", "styx", "hecate", "hades", "acheron"].map((id) => {
      const p = CATALOGUE[id]!.profile;
      return [id, p.type, p.category, p.points, p.speed, p.turrets];
    });
    expect(rows).toEqual([
      ["mars", "cruiser", "battlecruiser", 270, 20, 2],
      ["overlord", "cruiser", "battlecruiser", 220, 20, 2],
      ["styx", "cruiser", "heavy_cruiser", 260, 25, 3],
      ["hecate", "cruiser", "heavy_cruiser", 230, 25, 3],
      ["hades", "cruiser", "heavy_cruiser", 200, 25, 2],
      ["acheron", "cruiser", "heavy_cruiser", 190, 25, 3],
    ]);
    const dorsal = CATALOGUE["hades"]!.profile.weapons.find((w) => w.id === "dorsal_lances");
    expect(dorsal).toMatchObject({ kind: "lance", location: "dorsal", arcs: ["left", "front", "right"], range: 60, strength: 2 });
    expect(CATALOGUE["styx"]!.profile.weapons.filter((w) => w.kind === "launch_bay").map((w) => w.strength)).toEqual([3, 3]);
  });
});

describe("options in a game (transform §5)", () => {
  const config = (p1: { classId: string; options?: string[] }[], forces?: GameConfig["forces"]): GameConfig => ({
    ...cloneJson(LUNAR_VS_MURDER),
    ...(forces !== undefined ? { forces } : {}),
    ships: [
      ...p1.map((s, i) => ({ owner: "p1" as const, name: `I${i}`, ...s })),
      ...p1.map((_, i) => ({ owner: "p2" as const, name: `C${i}`, classId: "murder" })),
    ],
  });

  test("the profile snapshot is the ship as fielded; points count the options", () => {
    const s = newGame(config([{ classId: "mars", options: ["targeting_matrix"] }, { classId: "lunar", options: ["nova_cannon"] }], { kind: "points", limit: 500 }));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships[0]!.profile).toMatchObject({ points: 285, traits: { targetingMatrix: true } });
    expect(s.ships[1]!.loaded).toEqual({}); // the nova cannon replaced its torpedoes
    expect(() => newGame(config([{ classId: "mars", options: ["targeting_matrix", "third_turret"] }, { classId: "lunar", options: ["nova_cannon"] }], { kind: "points", limit: 490 }))).toThrow(/495 pts/);
  });

  test("Cruiser Clash's 185-point cap counts the options; bad options throw", () => {
    expect(() => newGame(config([{ classId: "lunar", options: ["nova_cannon"] }]))).toThrow(/200 pts exceeds/);
    expect(() => newGame(config([{ classId: "dominator", options: ["long_batteries"] }]))).not.toThrow();
    expect(() => newGame(config([{ classId: "lunar", options: ["warp_drive"] }]))).toThrow(/ships\[0\]: lunar has no option/);
    expect(() => newGame(config([{ classId: "lunar_nova", options: ["nova_cannon"] }], { kind: "points", limit: 500 }))).toThrow(/takes no options/);
  });
});

describe("the targeting matrix (T64, reducer §4.1)", () => {
  test("one column shift left for the ship's batteries", () => {
    const s = broadside();
    const plain = columnShift(s, unclean(s), agrippa(s).position!, agrippa(s));
    unclean(s).profile = profileWithOptions("overlord", ["targeting_matrix"]);
    expect(columnShift(s, unclean(s), agrippa(s).position!, agrippa(s))).toBe(plain - 1);
  });
});
