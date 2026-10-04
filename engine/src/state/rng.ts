/**
 * Dice (state spec §10.3, reducer spec §2.1): mulberry32 over the in-state RngState.
 *
 * The functions take an RngState and return the drawn value(s) plus the next
 * RngState. They never mutate their input.
 */
import type { RngState } from "./types";

/** A fresh generator for a game seed (uint32). */
export function createRng(seed: number): RngState {
  const s = seed >>> 0;
  return { algorithm: "mulberry32", seed: s, state: s, draws: 0 };
}

/** One uint32 draw. */
export function nextUint32(rng: RngState): { value: number; rng: RngState } {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, rng: { ...rng, state, draws: rng.draws + 1 } };
}

/** Largest multiple of 6 that fits in 2^32: rejection threshold for an unbiased D6. */
const D6_LIMIT = 4294967292;

/** One D6, by rejection sampling: no modulo bias. */
export function d6(rng: RngState): { value: number; rng: RngState } {
  let current = rng;
  for (;;) {
    const draw = nextUint32(current);
    current = draw.rng;
    if (draw.value < D6_LIMIT) return { value: (draw.value % 6) + 1, rng: current };
  }
}

/** n D6, drawn left to right. nD6(0) draws nothing. */
export function nD6(rng: RngState, n: number): { values: number[]; rng: RngState } {
  const values: number[] = [];
  let current = rng;
  for (let i = 0; i < n; i++) {
    const roll = d6(current);
    values.push(roll.value);
    current = roll.rng;
  }
  return { values, rng: current };
}

/** One D3: ceil(D6 / 2). */
export function d3(rng: RngState): { value: number; rng: RngState } {
  const roll = d6(rng);
  return { value: Math.ceil(roll.value / 2), rng: roll.rng };
}
