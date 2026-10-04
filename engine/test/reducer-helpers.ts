/** Reducer test helpers: validated play, invariant checks, and rigged dice. */
import { expect } from "vitest";
import { reduce, reduceWithDice } from "../src/reducer/reduce";
import { validate } from "../src/validator/validate";
import { checkInvariants } from "../src/state/invariants";
import { nD6 } from "../src/state/rng";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";

/** Validate (must pass), reduce, and check every invariant on the result. */
export function play(state: GameState, t: Transform): GameState {
  const verdict = validate(state, t);
  expect(verdict.ok ? "ok" : verdict.reason).toBe("ok");
  const before = JSON.stringify(state);
  const next = reduce(state, t);
  expect(JSON.stringify(state)).toBe(before); // never mutates its input
  expect(checkInvariants(next)).toEqual([]);
  return next;
}

/** Apply several transforms in order. */
export function playAll(state: GameState, ts: Transform[]): GameState {
  return ts.reduce(play, state);
}

/**
 * Point the RNG at a state whose next D6s are exactly `dice` (searching upward
 * from 1). Keeps `seed` and `draws` so the state stays readable.
 */
export function rigDice(state: GameState, dice: number[]): void {
  for (let candidate = 1; candidate < 50_000_000; candidate++) {
    const rng = { ...state.rng, state: candidate };
    const { values } = nD6(rng, dice.length);
    if (values.every((v, i) => v === dice[i])) {
      state.rng = rng;
      return;
    }
  }
  throw new Error(`no RNG state rolls ${dice.join(",")}`);
}

/** Log entries of one kind, newest last. */
export const logOf = (state: GameState, kind: string) => state.log.filter((e) => e.kind === kind);

/** Like play(), but with scripted dice: the reducer must draw exactly these, in order. */
export function playDice(state: GameState, t: Transform, dice: number[]): GameState {
  const verdict = validate(state, t);
  expect(verdict.ok ? "ok" : verdict.reason).toBe("ok");
  const before = JSON.stringify(state);
  const next = reduceWithDice(state, t, dice);
  expect(JSON.stringify(state)).toBe(before);
  expect(checkInvariants(next)).toEqual([]);
  return next;
}
