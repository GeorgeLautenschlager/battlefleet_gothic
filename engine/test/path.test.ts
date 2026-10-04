import { describe, expect, test } from "vitest";
import { bmContacts, exitDistance, legAt, touchesAnyBm, walkPath, walkShipPath } from "../src/geometry/path";
import { getShip } from "../src/state/derived";
import type { BlastMarker, GameState } from "../src/state/types";
import { specExampleState } from "./helpers";

const unclean = (s: GameState) => getShip(s, "ship-2"); // (100, 105) heading 180, small base
let n = 200;
const bm = (s: GameState, x: number, y: number): BlastMarker => {
  const marker: BlastMarker = { id: `bm-${n++}`, position: { x, y }, placed: 1, cause: "shield_hit" };
  s.blastMarkers.push(marker);
  return marker;
};

describe("walkPath", () => {
  test("the validator spec's legal example: 12.5, 45° to port, 12.5", () => {
    const s = specExampleState();
    const walk = walkShipPath(unclean(s), [
      { kind: "advance", distance: 12.5 },
      { kind: "turn", degrees: -45 },
      { kind: "advance", distance: 12.5 },
    ]);
    expect(walk.total).toBe(25);
    expect(walk.turns).toEqual([{ stepIndex: 1, degrees: -45, sinceLastTurn: 12.5 }]);
    expect(walk.legs.map((l) => [l.stepIndex, l.heading, l.distanceBefore])).toEqual([[0, 180, 0], [2, 135, 12.5]]);
    expect(walk.legs[1]!.start).toEqual({ x: 100, y: 92.5 }); // exact: cardinal heading
    expect(walk.end.heading).toBe(135);
    expect(walk.end.position.x).toBeCloseTo(100 + 12.5 * Math.SQRT1_2, 12);
    expect(walk.end.position.y).toBeCloseTo(92.5 - 12.5 * Math.SQRT1_2, 12);
  });

  test("turning too early is visible as sinceLastTurn (validator §6 example)", () => {
    const walk = walkPath({ position: { x: 0, y: 0 }, heading: 0 }, [
      { kind: "advance", distance: 5 },
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 15 },
    ]);
    expect(walk.turns[0]?.sinceLastTurn).toBe(5);
  });

  test("Burn Retros: turn in place, then two turns' distances reset", () => {
    const walk = walkPath({ position: { x: 10, y: 10 }, heading: 0 }, [
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 45 },
    ]);
    expect(walk.turns.map((t) => t.sinceLastTurn)).toEqual([0, 10]);
    expect(walk.end.heading).toBe(90);
  });

  test("an empty path stays put", () => {
    const walk = walkPath({ position: { x: 1, y: 2 }, heading: 270 }, []);
    expect(walk).toEqual({ legs: [], turns: [], total: 0, end: { position: { x: 1, y: 2 }, heading: 270 } });
  });

  test("headings normalise", () => {
    const walk = walkPath({ position: { x: 0, y: 0 }, heading: 10 }, [{ kind: "turn", degrees: -45 }]);
    expect(walk.end.heading).toBe(325);
  });

  test("legAt finds the leg containing a path distance", () => {
    const walk = walkPath({ position: { x: 0, y: 0 }, heading: 0 }, [
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 10 },
    ]);
    expect(legAt(walk, 3)?.stepIndex).toBe(0);
    expect(legAt(walk, 15)?.stepIndex).toBe(2);
    expect(legAt(walk, 25)).toBeNull();
  });
});

describe("Blast Markers along a path", () => {
  test("contacts in path order, across legs", () => {
    const s = specExampleState();
    const near = bm(s, 100, 95); // straight ahead of Unclean (heading 180)
    const far = bm(s, 100, 85);
    bm(s, 120, 95); // well clear
    const walk = walkShipPath(unclean(s), [{ kind: "advance", distance: 25 }]);
    expect(bmContacts(s.blastMarkers, unclean(s), walk)).toEqual([
      { id: near.id, distance: expect.closeTo(10 - 2.85, 12) as unknown as number },
      { id: far.id, distance: expect.closeTo(20 - 2.85, 12) as unknown as number },
    ]);
  });

  test("excluded markers are skipped (BMs the ship starts on)", () => {
    const s = specExampleState();
    const touching = bm(s, 100, 107);
    const walk = walkShipPath(unclean(s), [{ kind: "advance", distance: 10 }]);
    expect(bmContacts(s.blastMarkers, unclean(s), walk).map((c) => c)).toEqual([{ id: touching.id, distance: 0 }]);
    expect(bmContacts(s.blastMarkers, unclean(s), walk, new Set([touching.id]))).toEqual([]);
  });

  test("touchesAnyBm: moving off a BM you start on counts; staying put doesn't", () => {
    const s = specExampleState();
    bm(s, 100, 107);
    expect(touchesAnyBm(s, unclean(s), walkShipPath(unclean(s), [{ kind: "advance", distance: 10 }]))).toBe(true);
    expect(touchesAnyBm(s, unclean(s), walkShipPath(unclean(s), [{ kind: "turn", degrees: 45 }]))).toBe(false);
  });

  test("touchesAnyBm: a BM met mid-path counts; one never reached doesn't", () => {
    const s = specExampleState();
    bm(s, 100, 80);
    expect(touchesAnyBm(s, unclean(s), walkShipPath(unclean(s), [{ kind: "advance", distance: 20 }]))).toBe(false);
    expect(touchesAnyBm(s, unclean(s), walkShipPath(unclean(s), [{ kind: "advance", distance: 23 }]))).toBe(true);
  });
});

describe("exitDistance", () => {
  test("measured along the whole path", () => {
    const s = specExampleState(); // table 180 × 120
    const walk = walkPath({ position: { x: 170, y: 60 }, heading: 0 }, [
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 90 },
      { kind: "advance", distance: 20 },
    ]);
    expect(exitDistance(walk, s.table)).toBe(20);
    expect(exitDistance(walkPath({ position: { x: 90, y: 60 }, heading: 0 }, [{ kind: "advance", distance: 20 }]), s.table)).toBeNull();
  });
});
