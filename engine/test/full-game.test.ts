/**
 * Whole games, Lunar vs Murder: a dumb bot plays both sides from newGame to
 * game_end. Every transform is validated, reduced and invariant-checked by
 * play(), so this smoke-tests every handler against every other one.
 */
import { describe, expect, test } from "vitest";
import { newGame } from "../src/state/newGame";
import { cloneJson } from "../src/state/json";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { GameConfig } from "../src/state/newGame";
import { candidates } from "./bot";
import { fleets, LUNAR_VS_MURDER } from "./helpers";
import { play } from "./reducer-helpers";

function playOut(seed: number, config: GameConfig = LUNAR_VS_MURDER): GameState {
  let s = newGame({ ...cloneJson(config), seed });
  for (let n = 0; s.clock.stage !== "ended"; n++) {
    if (n > 5000) throw new Error(`seed ${seed}: no end in sight at ${JSON.stringify(s.clock)}`);
    const t = candidates(s, n).find((c) => validate(s, c).ok);
    if (t === undefined) {
      const why = [...new Set(candidates(s, n).map((c) => { const v = validate(s, c); return v.ok ? "ok" : `${v.reason.code}: ${v.reason.message}`; }))];
      throw new Error(`seed ${seed}: stuck at ${JSON.stringify(s.clock)} ${JSON.stringify(s.activation)}\n${why.join("\n")}`);
    }
    s = play(s, t);
  }
  return s;
}

describe("full games", () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("seed %i plays to a result", (seed) => {
    const s = playOut(seed);
    expect(s.result).not.toBeNull();
    expect(s.log.at(-1)?.kind).toBe("game_end");
    expect(s.queue).toEqual([]);
  });
});

const IMPERIAL = { faction: "imperial_navy", classId: "lunar" } as const;
const CHAOS = { faction: "chaos", classId: "murder" } as const;

/** Any classes a side, in config order. */
const mixed = (p1: string[], p2: string[]): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  ships: [...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })), ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId }))],
});

describe("full games with fleets", () => {
  const matchups: [string, GameConfig][] = [
    ["4 Lunars vs 4 Murders", fleets({ ...IMPERIAL, n: 4 }, { ...CHAOS, n: 4 })],
    ["3 Murders vs 3 Lunars", fleets({ ...CHAOS, n: 3 }, { ...IMPERIAL, n: 3 })],
    ["mirror: 2 Lunars a side", fleets({ ...IMPERIAL, n: 2 }, { ...IMPERIAL, n: 2 })],
    ["mirror: 4 Murders a side", fleets({ ...CHAOS, n: 4 }, { ...CHAOS, n: 4 })],
    ["Gothic, Tyrant and Lunar vs Carnage, Inferno and Slaughter", mixed(["gothic", "tyrant", "lunar"], ["carnage", "inferno", "slaughter"])],
    ["Tyrants vs Murder lance variants", mixed(["tyrant", "tyrant"], ["murder_lances", "murder_lances"])],
  ];
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4, 5, 6])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
      expect(s.log.at(-1)?.kind).toBe("game_end");
      expect(s.queue).toEqual([]);
    });
  }
});

describe("full games with carriers", () => {
  const carriers = (p1: string[], p2: string[]): GameConfig => ({
    ...cloneJson(LUNAR_VS_MURDER),
    options: { carriers: true, boarding: true },
    ships: [
      ...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })),
      ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId })),
    ],
  });
  const matchups: [string, GameConfig][] = [
    ["Dictator vs Devastation", carriers(["dictator"], ["devastation"])],
    ["Dictator and 2 Lunars vs Devastation and 2 Murders", carriers(["dictator", "lunar", "lunar"], ["devastation", "murder", "murder"])],
  ];
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4, 5, 6])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
      expect(s.queue).toEqual([]);
    });
  }

  test("across those games the bot launches, flies CAP, dogfights, bombs and boards from assault boats", () => {
    const kinds = new Set<string>();
    for (const [, config] of matchups) for (const seed of [1, 2, 3, 4, 5, 6]) for (const e of playOut(seed, config).log) kinds.add(e.kind);
    for (const k of ["craft_launch", "craft_move", "cap_formed", "dogfight", "craft_attack", "hit_and_run", "turrets"]) expect(kinds).toContain(k);
  });
});

describe("full games, points battles with victory points", () => {
  const battle = (p1: string[], p2: string[], limit: number): GameConfig => ({ ...mixed(p1, p2), forces: { kind: "points", limit }, scoring: "victory_points" });
  const matchups: [string, GameConfig][] = [
    ["750 pts: Dictator, Gothic, Lunar vs Devastation, Slaughter ×2, Murder", battle(["dictator", "gothic", "lunar"], ["devastation", "slaughter", "slaughter", "murder"], 750)],
    ["500 pts: two Tyrants vs three Slaughters", battle(["tyrant", "tyrant"], ["slaughter", "slaughter", "slaughter"], 500)],
    ["1000 pts: nova cannons (Dominator ×2, Lunar, Tyrant) vs Murder ×4, Carnage", battle(["dominator", "dominator_long", "lunar_nova", "tyrant_long_nova"], ["murder", "murder", "murder", "murder", "carnage"], 1000)],
    ["1500 pts: Mars, Overlord and cruisers vs Styx, Hecate, Hades, Acheron and cruisers", battle(["mars", "overlord", "lunar", "gothic", "dominator", "tyrant"], ["styx", "hecate", "hades", "acheron", "murder", "carnage"], 1500)],
  ];
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
      expect(s.log.at(-1)?.data["scoring"]).toBe("victory_points");
    });
  }
});

describe("full games, Fleet Engagement", () => {
  const fleetEngagement = (p1: string[], p2: string[], limit: number): GameConfig => ({ ...mixed(p1, p2), scenario: "fleet_engagement", forces: { kind: "points", limit } });
  const matchups: [string, GameConfig][] = [
    ["750 pts: Lunar, Gothic, Dominator, Tyrant vs Murder ×2, Carnage, Slaughter", fleetEngagement(["lunar", "gothic", "dominator", "tyrant"], ["murder", "murder", "carnage", "slaughter"], 750)],
    ["500 pts: Dictator, Lunar vs Devastation, Murder", fleetEngagement(["dictator", "lunar"], ["devastation", "murder"], 500)],
  ];
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4])(`${name}, seed %i, plays until a side is gone`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result?.reason).toBe("fleet_eliminated");
      expect(s.log.at(-1)?.data["scoring"]).toBe("victory_points");
      expect(s.log.some((e) => e.kind === "setup_choice")).toBe(true);
    }, 60_000); // no round limit: these run longer than Cruiser Clash
  }
});

test("nova cannons fire, scatter, hit and miss across those games", () => {
  const config = { ...mixed(["dominator", "dominator_long", "lunar_nova", "tyrant_long_nova"], ["murder", "murder", "murder", "murder", "carnage"]), forces: { kind: "points" as const, limit: 1000 } };
  const shots = [1, 2, 3, 4].flatMap((seed) => playOut(seed, config).log.filter((e) => e.kind === "nova_cannon"));
  expect(shots.length).toBeGreaterThan(4);
  expect(shots.some((e) => e.data["scatter"] === "hit")).toBe(true);
  expect(shots.some((e) => e.data["scatter"] !== "hit")).toBe(true);
  expect(shots.some((e) => (e.data["ships"] as unknown[]).length > 0)).toBe(true);
});

test("in those games the new cruisers fire combined battery volleys", () => {
  const config = mixed(["gothic", "tyrant", "lunar"], ["carnage", "inferno", "slaughter"]);
  const volleys = [1, 2, 3].flatMap((seed) => playOut(seed, config).log.filter((e) => e.kind === "attack" && Array.isArray(e.data["weaponIds"])));
  expect(volleys.length).toBeGreaterThan(0);
});

describe("full games with boarding on", () => {
  const withBoarding = (c: GameConfig): GameConfig => ({ ...c, options: { boarding: true } });
  const matchups: [string, GameConfig][] = [
    ["Lunar vs Murder", withBoarding(LUNAR_VS_MURDER)],
    ["4 Lunars vs 4 Murders", withBoarding(fleets({ ...IMPERIAL, n: 4 }, { ...CHAOS, n: 4 }))],
  ];
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4, 5, 6])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
      expect(s.queue).toEqual([]);
    });
  }

  test("across those games the bot boards, grapples, boards ships to hulks and teleports", () => {
    const kinds = new Set<string>();
    for (const [, config] of matchups) for (const seed of [1, 2, 3, 4, 5, 6]) for (const e of playOut(seed, config).log) kinds.add(e.kind);
    for (const k of ["boarding_declared", "boarding", "boarding_critical", "teleport"]) expect(kinds).toContain(k);
  });
});
