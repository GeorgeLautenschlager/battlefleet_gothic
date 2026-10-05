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
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { play } from "./reducer-helpers";

function playOut(seed: number): GameState {
  let s = newGame({ ...cloneJson(LUNAR_VS_MURDER), seed });
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

