/**
 * The Gothic War lists' grand and light cruisers: the Repulsive and the
 * Dauntless, their options and the grand cruisers' ratio (state v0.14 N20,
 * N27–N28; transforms v0.12 §5, T67–T70).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE, profileWithOptions } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { fleetListProblem, type CommanderConfig } from "../src/rules/fleetLists";
import { LUNAR_VS_MURDER } from "./helpers";

type Entry = { classId: string; options?: string[]; commander?: CommanderConfig };
const game = (p1: Entry[], p2: Entry[], extra: Partial<GameConfig> = {}): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  ...extra,
  ships: [...p1.map((s, i) => ({ owner: "p1" as const, name: `I${i}`, ...s })), ...p2.map((s, i) => ({ owner: "p2" as const, name: `C${i}`, ...s }))],
});
const listed = (p1: Entry[], p2: Entry[], limit = 1000) => game(p1, p2, { options: { fleetLists: true }, forces: { kind: "points", limit }, scoring: "victory_points" });
const warmaster: CommanderConfig = { kind: "warmaster", leadership: 8, marks: [] };
const side = (entries: Entry[]) => entries.map((e) => ({ ...e, profile: profileWithOptions(e.classId, e.options ?? []) }));

describe("the profiles (T69)", () => {
  test("cruisers in the core rules, with their category", () => {
    const row = (id: string) => {
      const p = CATALOGUE[id]!.profile;
      return [p.type, p.category, p.points, p.hits, p.speed, p.turns, p.shields, p.turrets, p.baseSize];
    };
    expect(row("dauntless")).toEqual(["cruiser", "light_cruiser", 110, 6, 25, 90, 1, 1, "small"]);
    expect(row("repulsive")).toEqual(["cruiser", "grand_cruiser", 230, 10, 20, 45, 2, 3, "small"]);
    expect(CATALOGUE["dauntless"]!.profile.traits).toEqual({ allAheadFullDice: 5 }); // improved thrusters (N10)
    const weapons = (id: string) => CATALOGUE[id]!.profile.weapons.map((w) => [w.id, w.kind, w.arcs.join("/"), w.range ?? w.speed, w.strength]);
    expect(weapons("dauntless")).toEqual([
      ["port_battery", "battery", "left", 30, 4],
      ["starboard_battery", "battery", "right", 30, 4],
      ["prow_lances", "lance", "front", 30, 3],
    ]);
    expect(weapons("repulsive")).toEqual([
      ["port_battery", "battery", "left", 45, 14],
      ["starboard_battery", "battery", "right", 45, 14],
      ["dorsal_lances", "lance", "left/front/right", 30, 3],
      ["prow_torpedoes", "torpedoes", "front", 30, 6],
    ]);
  });
});

describe("their options (transform §5)", () => {
  test("the Dauntless's torpedoes replace its prow lances, for nothing (T70)", () => {
    const p = profileWithOptions("dauntless", ["prow_torpedoes"]);
    expect(p.points).toBe(110);
    expect(p.weapons.map((w) => w.id)).toEqual(["port_battery", "starboard_battery", "prow_torpedoes"]);
    expect(p.weapons[2]).toMatchObject({ kind: "torpedoes", strength: 6, speed: 30 });
  });

  test("the Repulsive: 45 cm dorsal lances (+10) and a third shield on a large base (+15, N28)", () => {
    const p = profileWithOptions("repulsive", ["long_dorsal_lances", "third_shield"]);
    expect(p).toMatchObject({ points: 255, shields: 3, baseSize: "large", options: ["long_dorsal_lances", "third_shield"] });
    expect(p.weapons.find((w) => w.id === "dorsal_lances")).toMatchObject({ range: 45, strength: 3 });
    expect(CATALOGUE["repulsive"]!.profile).toMatchObject({ shields: 2, baseSize: "small" }); // the class is untouched
  });

  test("in a game, the ship is fielded with them", () => {
    const s = newGame(game([{ classId: "dauntless", options: ["prow_torpedoes"] }], [{ classId: "repulsive", options: ["third_shield"] }], { forces: { kind: "points", limit: 500 } }));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships[0]!.loaded).toEqual({ torpedoes: true });
    expect(s.ships[1]!.profile).toMatchObject({ shields: 3, baseSize: "large", points: 245 });
  });
});

describe("Cruiser Clash (N27, D29)", () => {
  test("the Dauntless is a cruiser within the cap; the Repulsive is over it", () => {
    expect(() => newGame(game([{ classId: "dauntless" }, { classId: "dauntless", options: ["prow_torpedoes"] }], [{ classId: "murder" }, { classId: "murder" }]))).not.toThrow();
    expect(() => newGame(game([{ classId: "lunar" }], [{ classId: "repulsive" }]))).toThrow(/230 pts exceeds/);
  });
});

describe("fleet lists (T67–T68)", () => {
  test("Gothic Sector: the Dauntless is on the list and counts as a cruiser", () => {
    expect(fleetListProblem("imperial_navy", side([{ classId: "mars" }, { classId: "lunar" }, { classId: "dauntless" }]))).toBeNull();
    expect(fleetListProblem("imperial_navy", side([{ classId: "mars" }, { classId: "dauntless" }]))).toMatch(/one battlecruiser per two cruisers: 1 cruisers allow 0/);
    const thirteen = side(Array.from({ length: 13 }, (_, i) => ({ classId: i % 2 === 0 ? "dauntless" : "lunar" })));
    expect(fleetListProblem("imperial_navy", thirteen)).toMatch(/at most 12 cruisers/);
  });

  test("Chaos Incursion: one grand cruiser per three cruisers or heavy cruisers", () => {
    const repulsive = { classId: "repulsive", commander: warmaster };
    expect(fleetListProblem("chaos", side([repulsive, { classId: "murder" }, { classId: "murder" }]))).toMatch(
      /one grand cruiser per three cruisers or heavy cruisers: 2 cruisers or heavy cruisers allow 0/,
    );
    // Two cruisers and a heavy cruiser: one of each larger hull (the ratios are separate).
    expect(fleetListProblem("chaos", side([repulsive, { classId: "murder" }, { classId: "murder" }, { classId: "hades" }]))).toBeNull();
    expect(fleetListProblem("chaos", side([repulsive, { classId: "repulsive" }, { classId: "murder" }, { classId: "murder" }, { classId: "hades" }]))).toMatch(/allow 1/);
    expect(fleetListProblem("imperial_navy", side([{ classId: "repulsive" }]))).toMatch(/isn't on the Gothic Sector fleet list/);
  });

  test("a Repulsive with the Warmaster in a listed game", () => {
    const chaos = [{ classId: "repulsive", options: ["third_shield"], commander: warmaster }, { classId: "murder" }, { classId: "murder" }, { classId: "acheron" }];
    const s = newGame(listed([{ classId: "lunar" }, { classId: "dauntless" }], chaos));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships.find((x) => x.profile.classId === "repulsive")!.commander).toMatchObject({ kind: "warmaster" });
  });
});
