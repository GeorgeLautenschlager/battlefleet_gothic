import { describe, expect, test } from "vitest";
import { createRng, d3, d6, nD6, nextUint32 } from "../src/state/rng";

describe("mulberry32", () => {
  test("matches an independent reference implementation", () => {
    // Computed with a separate Python implementation of mulberry32, seed 1337.
    const expected = [792042790, 815997621, 3480950701, 2764880138, 1850162886, 1636579666, 2261569356, 2356160527];
    let rng = createRng(1337);
    for (const value of expected) {
      const draw = nextUint32(rng);
      expect(draw.value).toBe(value);
      rng = draw.rng;
    }
    expect(rng.draws).toBe(8);
  });

  test("D6 sequence for seed 1337 (reference implementation)", () => {
    const { values, rng } = nD6(createRng(1337), 12);
    expect(values).toEqual([5, 4, 2, 3, 1, 5, 1, 2, 4, 5, 2, 5]);
    expect(rng.state).toBe(503954613);
    expect(rng.seed).toBe(1337);
  });

  test("never mutates its input", () => {
    const rng = createRng(42);
    const before = JSON.stringify(rng);
    d6(rng);
    nD6(rng, 10);
    d3(rng);
    expect(JSON.stringify(rng)).toBe(before);
  });

  test("same state, same dice", () => {
    expect(nD6(createRng(7), 50).values).toEqual(nD6(createRng(7), 50).values);
  });

  test("D6 is roughly uniform", () => {
    const { values } = nD6(createRng(2026), 60000);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const v of values) counts[v - 1] = (counts[v - 1] ?? 0) + 1;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400); // > 4σ
  });

  test("D3 is ceil(D6 / 2) of the same draw", () => {
    const rng = createRng(99);
    expect(d3(rng).value).toBe(Math.ceil(d6(rng).value / 2));
  });

  test("nD6(0) draws nothing", () => {
    const rng = createRng(5);
    expect(nD6(rng, 0)).toEqual({ values: [], rng });
  });

  test("seeds are normalised to uint32", () => {
    expect(createRng(-1).seed).toBe(4294967295);
  });
});
