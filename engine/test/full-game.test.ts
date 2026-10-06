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
    ["Dauntless light cruisers vs Murders", mixed(["dauntless", "dauntless", "lunar"], ["murder", "murder", "slaughter"])],
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
    [
      "1000 pts: Dauntlesses (one with torpedoes), Lunar, Overlord vs a Repulsive (both options), Hades, Murders",
      {
        ...battle(["dauntless", "dauntless", "lunar", "overlord"], ["repulsive", "hades", "murder", "murder"], 1000),
        ships: [
          ...battle(["dauntless", "dauntless", "lunar", "overlord"], [], 1000).ships.map((s, i) => (i === 1 ? { ...s, options: ["prow_torpedoes"] } : s)),
          ...battle([], ["repulsive", "hades", "murder", "murder"], 1000).ships.map((s, i) => (i === 0 ? { ...s, options: ["long_dorsal_lances", "third_shield"] } : s)),
        ],
      },
    ],
  ];
  const withOptions = (config: GameConfig, options: Record<number, string[]>): GameConfig => ({
    ...config,
    ships: config.ships.map((x, i) => (options[i] !== undefined ? { ...x, options: options[i] } : x)),
  });
  matchups.push([
    "1500 pts: Emperor (Sharks), Retribution, Lunars vs battle barge (refits), Despoiler (torpedoes), Desolator, Murders",
    withOptions(battle(["emperor", "retribution", "lunar", "lunar", "lunar"], ["chaos_battle_barge", "despoiler", "desolator", "murder", "murder"], 1500), {
      0: ["sharks"],
      5: ["batteries_45", "prow_torpedoes", "dorsal_lances_45"],
      6: ["prow_torpedoes"],
    }),
  ]);
  for (const [name, config] of matchups) {
    test.each([1, 2, 3, 4])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
      expect(s.log.at(-1)?.data["scoring"]).toBe("victory_points");
    }, 60_000);
  }
});

describe("full games with fleet lists, commanders and Marks", () => {
  const withLists = (p1: GameConfig["ships"], p2: GameConfig["ships"], limit: number): GameConfig => ({
    ...cloneJson(LUNAR_VS_MURDER),
    options: { fleetLists: true, boarding: true },
    forces: { kind: "points", limit },
    scoring: "victory_points",
    ships: [...p1, ...p2],
  });
  const imperial = (classId: string, i: number, extra: Partial<GameConfig["ships"][number]> = {}) => ({ owner: "p1" as const, name: `I${i}`, classId, ...extra });
  const chaos = (classId: string, i: number, extra: Partial<GameConfig["ships"][number]> = {}) => ({ owner: "p2" as const, name: `C${i}`, classId, ...extra });
  const config = withLists(
    [imperial("mars", 0, { options: ["targeting_matrix"], commander: { kind: "admiral", leadership: 9, extraRerolls: 1 } }), imperial("lunar", 1), imperial("gothic", 2)],
    [
      chaos("styx", 0, { commander: { kind: "warmaster", leadership: 9, marks: ["slaanesh", "khorne"] } }),
      chaos("murder", 1, { commander: { kind: "lord", mark: "tzeentch" } }),
      chaos("carnage", 2, { commander: { kind: "lord", mark: "nurgle" } }),
    ],
    1200,
  );
  test.each([1, 2, 3, 4])("seed %i plays to a result", (seed) => {
    const s = playOut(seed, config);
    expect(s.result).not.toBeNull();
  }, 60_000);

  const battleships = withLists(
    [
      imperial("emperor", 0, { options: ["sharks"], commander: { kind: "admiral", leadership: 9, extraRerolls: 0 } }),
      imperial("lunar", 1),
      imperial("gothic", 2),
      imperial("dauntless", 3, { options: ["prow_torpedoes"] }),
    ],
    [
      chaos("despoiler", 0, { commander: { kind: "warmaster", leadership: 8, marks: ["nurgle"] } }),
      chaos("murder", 1),
      chaos("carnage", 2),
      chaos("acheron", 3),
    ],
    1500,
  );
  test.each([1, 2, 3])("with battleships, seed %i plays to a result", (seed) => {
    const s = playOut(seed, battleships);
    expect(s.result).not.toBeNull();
  }, 60_000);

  test("across those games, re-rolls get spent", () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3, 4]) for (const e of playOut(seed, config).log) kinds.add(e.kind);
    expect(kinds).toContain("reroll");
  }, 60_000);
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

describe("full games with escorts and squadrons", () => {
  const sq = (owner: "p1" | "p2", classId: string, squadron: string | undefined, i: number) => ({ owner, name: `${owner}-${i}`, classId, ...(squadron !== undefined ? { squadron } : {}) });
  const points: GameConfig = {
    ...cloneJson(LUNAR_VS_MURDER),
    options: { boarding: true },
    forces: { kind: "points", limit: 1000 },
    scoring: "victory_points",
    ships: [
      sq("p1", "sword", "Blue", 0), sq("p1", "sword", "Blue", 1), sq("p1", "firestorm", "Blue", 2),
      sq("p1", "cobra", "Widowmakers", 3), sq("p1", "cobra", "Widowmakers", 4),
      sq("p1", "lunar", "Line", 5), sq("p1", "gothic", "Line", 6),
      sq("p2", "idolator", "Ravagers", 0), sq("p2", "infidel", "Ravagers", 1), sq("p2", "iconoclast", "Ravagers", 2),
      sq("p2", "murder", "Claw", 3), sq("p2", "carnage", "Claw", 4), sq("p2", "slaughter", undefined, 5),
    ],
  };
  const engagement: GameConfig = { ...points, scenario: "fleet_engagement", options: { fleetLists: true } };
  engagement.ships = [
    ...points.ships.filter((s) => s.owner === "p1"),
    ...points.ships.filter((s) => s.owner === "p2"),
    { owner: "p1", name: "flag", classId: "dictator", commander: { kind: "admiral", leadership: 8, extraRerolls: 0 } },
    { owner: "p2", name: "flag", classId: "styx", commander: { kind: "warmaster", leadership: 8, marks: [] } },
  ];
  engagement.forces = { kind: "points", limit: 1500 };

  for (const [name, config] of [["points battle", points], ["Fleet Engagement with fleet lists", engagement]] as const) {
    test.each([1, 2, 3, 4])(`${name}, seed %i, plays to a result`, (seed) => {
      const s = playOut(seed, config);
      expect(s.result).not.toBeNull();
    }, 60_000);
  }

  test("across those games, squadrons move and fire together, and escorts are lost", () => {
    const kinds = new Set<string>();
    let volleys = 0;
    for (const seed of [1, 2, 3, 4]) {
      for (const e of playOut(seed, points).log) {
        kinds.add(e.kind);
        if (e.kind === "attack" && ((e.data["shooterIds"] as string[] | undefined)?.length ?? 0) > 1) volleys += 1;
      }
    }
    expect(kinds).toContain("escort_lost");
    expect(kinds).toContain("order_set");
    expect(kinds).toContain("allocation");
    expect(volleys).toBeGreaterThan(0);
  }, 60_000);
});
