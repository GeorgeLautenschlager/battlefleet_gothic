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

describe("full games with fleets", () => {
  const matchups: [string, GameConfig][] = [
    ["4 Lunars vs 4 Murders", fleets({ ...IMPERIAL, n: 4 }, { ...CHAOS, n: 4 })],
    ["3 Murders vs 3 Lunars", fleets({ ...CHAOS, n: 3 }, { ...IMPERIAL, n: 3 })],
    ["mirror: 2 Lunars a side", fleets({ ...IMPERIAL, n: 2 }, { ...IMPERIAL, n: 2 })],
    ["mirror: 4 Murders a side", fleets({ ...CHAOS, n: 4 }, { ...CHAOS, n: 4 })],
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
