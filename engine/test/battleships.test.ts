/**
 * The Gothic War lists' battleships: Emperor, Retribution; the Chaos battle
 * barge, Despoiler and Desolator (state v0.15 N30–N33; transforms v0.13 §5,
 * T71–T74; validator v0.10 declare_order check 8).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE, profileWithOptions } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { leadership } from "../src/state/derived";
import { moveParameters } from "../src/rules/move";
import { fleetListProblem, buildCommander, type CommanderConfig } from "../src/rules/fleetLists";
import { LUNAR_VS_MURDER } from "./helpers";
import { battle, expectOk, expectReject, unclean } from "./validator-fixtures";

type Entry = { classId: string; options?: string[]; commander?: CommanderConfig };
const game = (p1: Entry[], p2: Entry[], extra: Partial<GameConfig> = {}): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  ...extra,
  ships: [...p1.map((s, i) => ({ owner: "p1" as const, name: `I${i}`, ...s })), ...p2.map((s, i) => ({ owner: "p2" as const, name: `C${i}`, ...s }))],
});
const side = (entries: Entry[]) => entries.map((e) => ({ ...e, profile: profileWithOptions(e.classId, e.options ?? []) }));
const BATTLESHIPS = ["emperor", "retribution", "chaos_battle_barge", "despoiler", "desolator"];

describe("the profiles (N30–N32)", () => {
  test("Battleship/12, 4 shields, a large base, no Come to New Heading", () => {
    const rows = BATTLESHIPS.map((id) => {
      const p = CATALOGUE[id]!.profile;
      return [id, p.type, p.category, p.points, p.hits, p.speed, p.shields, p.armour.front, p.turrets, p.baseSize, p.traits?.noComeToNewHeading];
    });
    expect(rows).toEqual([
      ["emperor", "battleship", "battleship", 365, 12, 15, 4, 5, 5, "large", true],
      ["retribution", "battleship", "battleship", 345, 12, 20, 4, 6, 4, "large", true],
      ["chaos_battle_barge", "battleship", "battleship", 410, 12, 20, 4, 5, 4, "large", true],
      ["despoiler", "battleship", "battleship", 400, 12, 20, 4, 5, 4, "large", true],
      ["desolator", "battleship", "battleship", 300, 12, 25, 4, 5, 4, "large", true],
    ]);
    expect(CATALOGUE["emperor"]!.profile.traits?.leadershipBonus).toBe(1);
    const bays = (id: string) => CATALOGUE[id]!.profile.weapons.filter((w) => w.kind === "launch_bay").map((w) => `${w.location} ${w.strength}`);
    expect(bays("emperor")).toEqual(["port 4", "starboard 4"]);
    expect(bays("chaos_battle_barge")).toEqual(["port 3", "starboard 3", "prow 2"]);
    expect(bays("despoiler")).toEqual(["port 4", "starboard 4"]);
    const weapon = (id: string, w: string) => CATALOGUE[id]!.profile.weapons.find((x) => x.id === w);
    expect(weapon("retribution", "prow_torpedoes")).toMatchObject({ strength: 9, speed: 30 });
    expect(weapon("desolator", "port_lances")).toMatchObject({ range: 60, strength: 4 });
    expect(weapon("emperor", "dorsal_battery")).toMatchObject({ arcs: ["left", "front", "right"], range: 60, strength: 5 });
  });

  test("15 cm before turning (p. 54)", () => {
    const s = battle();
    unclean(s).profile = profileWithOptions("desolator");
    expect(moveParameters(unclean(s), null).turnDistance).toBe(15);
  });
});

describe("their options (T57, N33, T74)", () => {
  test("the Emperor's Sharks join its launch bays (+5)", () => {
    const p = profileWithOptions("emperor", ["sharks"]);
    expect(p.points).toBe(370);
    for (const w of p.weapons.filter((x) => x.kind === "launch_bay")) expect(w.craft?.map((c) => c.name)).toEqual(["Fury", "Starhawk", "Shark"]);
  });

  test("the battle barge's refits; the two battery refits exclude each other", () => {
    const p = profileWithOptions("chaos_battle_barge", ["batteries_45", "prow_torpedoes", "dorsal_lances_45"]);
    expect(p.points).toBe(430);
    const w = (id: string) => p.weapons.find((x) => x.id === id);
    expect([w("port_battery")?.range, w("port_battery")?.strength, w("starboard_battery")?.strength]).toEqual([45, 8, 8]);
    expect(w("prow_torpedoes")).toMatchObject({ kind: "torpedoes", strength: 8 });
    expect(w("dorsal_lances")).toMatchObject({ range: 45, strength: 4 });
    expect(profileWithOptions("chaos_battle_barge", ["batteries_30"]).weapons.find((x) => x.id === "port_battery")).toMatchObject({ range: 30, strength: 10 });
    expect(() => profileWithOptions("chaos_battle_barge", ["batteries_45", "batteries_30"])).toThrow(/can't both be taken/);
  });

  test("the Despoiler's torpedoes (+10)", () => {
    expect(profileWithOptions("despoiler", ["prow_torpedoes"])).toMatchObject({ points: 410 });
  });
});

describe("in a game (T71)", () => {
  test("points battles take battleships; Cruiser Clash doesn't", () => {
    const s = newGame(game([{ classId: "emperor", options: ["sharks"] }], [{ classId: "chaos_battle_barge", options: ["batteries_30"] }], { forces: { kind: "points", limit: 500 } }));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships.map((x) => x.profile.baseSize)).toEqual(["large", "large"]);
    expect(() => newGame(game([{ classId: "lunar" }], [{ classId: "desolator" }]))).toThrow(/Cruiser Clash allows cruisers only/);
  });
});

describe("Come to New Heading (T73)", () => {
  test("refused to a battleship, any other order allowed", () => {
    const s = battle();
    unclean(s).profile = profileWithOptions("despoiler");
    const order = (o: string) => ({ type: "declare_order", player: "p2", shipId: "ship-2", order: o });
    expectReject(s, order("come_to_new_heading"), "INVALID_ORDER");
    expectOk(s, order("burn_retros"));
    expectOk(battle(), order("come_to_new_heading")); // a Murder may
  });
});

describe("the Emperor's Leadership (N32)", () => {
  test("+1 on its own value or its commander's, capped at 10; Bridge Smashed after the cap", () => {
    const s = battle();
    const ship = unclean(s);
    ship.profile = profileWithOptions("emperor");
    ship.leadership = 7;
    expect(leadership(s, ship)).toBe(8);
    ship.commander = buildCommander({ kind: "admiral", leadership: 9, extraRerolls: 0 });
    expect(leadership(s, ship)).toBe(10);
    ship.commander = buildCommander({ kind: "admiral", leadership: 10, extraRerolls: 0 });
    expect(leadership(s, ship)).toBe(10);
    ship.criticals.push({ id: "crit-x", kind: "bridge_smashed", playerTurn: 1 });
    expect(leadership(s, ship)).toBe(7);
  });
});

describe("fleet lists (T72)", () => {
  test("Gothic Sector: one battleship per three cruisers or battlecruisers", () => {
    expect(fleetListProblem("imperial_navy", side([{ classId: "emperor" }, { classId: "lunar" }, { classId: "gothic" }]))).toMatch(
      /one battleship per three cruisers or battlecruisers: 2 cruisers or battlecruisers allow 0/,
    );
    expect(fleetListProblem("imperial_navy", side([{ classId: "retribution", commander: { kind: "admiral", leadership: 8, extraRerolls: 0 } }, { classId: "mars" }, { classId: "lunar" }, { classId: "dauntless" }]))).toBeNull();
  });

  test("Chaos Incursion: one per three cruisers or heavy cruisers; the Warmaster goes on it", () => {
    const warmaster: CommanderConfig = { kind: "warmaster", leadership: 9, marks: [] };
    expect(fleetListProblem("chaos", side([{ classId: "despoiler", commander: warmaster }, { classId: "murder" }, { classId: "murder" }]))).toMatch(/allow 0/);
    const chaos = side([{ classId: "chaos_battle_barge", commander: warmaster }, { classId: "murder" }, { classId: "murder" }, { classId: "hades" }]);
    expect(fleetListProblem("chaos", chaos)).toBeNull();
    expect(fleetListProblem("chaos", side([{ classId: "despoiler" }, { classId: "murder", commander: warmaster }, { classId: "murder" }, { classId: "murder" }]))).toMatch(/most expensive/);
  });
});
