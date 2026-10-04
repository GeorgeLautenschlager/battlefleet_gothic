import { describe, expect, test } from "vitest";
import { exitT, sweptCircleVsCircle, sweptSegmentVsCircle, sweptSegmentVsSegment, toLocal } from "../src/geometry/sweep";
import { segmentPointDistance, segmentTouchesCircle } from "../src/geometry/basic";

const O = { x: 50, y: 50 };
const R_SHIP = 1.6;
const R_BM = 1.25;
const TABLE = { width: 180, height: 120 };

describe("toLocal", () => {
  test("u along travel, v to starboard", () => {
    expect(toLocal(O, 0, { x: 50, y: 60 })).toEqual({ u: 10, v: 0 });
    expect(toLocal(O, 0, { x: 53, y: 50 })).toEqual({ u: 0, v: 3 }); // starboard of a ship heading north is +x
    expect(toLocal(O, 90, { x: 50, y: 47 })).toEqual({ u: 0, v: 3 }); // heading east, starboard is −y
  });
});

describe("swept circle vs circle", () => {
  test("head-on: contact when the gap closes to the sum of radii", () => {
    expect(sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 50, y: 60 }, R_BM)).toBeCloseTo(10 - 2.85, 12);
  });

  test("off-centre: contact earlier along the chord", () => {
    const t = sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 52, y: 60 }, R_BM);
    expect(t).toBeCloseTo(10 - Math.sqrt(2.85 * 2.85 - 4), 12);
  });

  test("grazing within EPS still counts; clear beyond it", () => {
    expect(sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 50 + 2.8505, y: 60 }, R_BM)).not.toBeNull();
    expect(sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 50 + 2.86, y: 60 }, R_BM)).toBeNull();
  });

  test("already touching at the start → 0; behind → none; out of reach → none", () => {
    expect(sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 50, y: 52 }, R_BM)).toBe(0);
    expect(sweptCircleVsCircle(O, 0, 20, R_SHIP, { x: 50, y: 40 }, R_BM)).toBeNull();
    expect(sweptCircleVsCircle(O, 0, 5, R_SHIP, { x: 50, y: 60 }, R_BM)).toBeNull();
  });

  test("moving away from a BM you start on still reports contact at 0", () => {
    expect(sweptCircleVsCircle(O, 0, 10, R_SHIP, { x: 50, y: 48 }, R_BM)).toBe(0);
  });

  test("works on any heading", () => {
    expect(sweptCircleVsCircle(O, 135, 30, R_SHIP, { x: 60, y: 40 }, R_SHIP)).toBeCloseTo(Math.sqrt(200) - 3.2, 10);
  });
});

describe("swept torpedo segment", () => {
  test("hits a base anywhere across its 2.5 cm width", () => {
    // Base centre 1.25 cm off the salvo's centre line: still inside the segment's width.
    expect(sweptSegmentVsCircle(O, 0, 30, 2.5, { x: 51.25, y: 70 }, R_SHIP)).toBeCloseTo(20 - R_SHIP, 12);
    // 1.25 + 1.6 = 2.85 off: the base just grazes the segment's end.
    expect(sweptSegmentVsCircle(O, 0, 30, 2.5, { x: 52.85, y: 70 }, R_SHIP)).toBeCloseTo(20, 12);
    expect(sweptSegmentVsCircle(O, 0, 30, 2.5, { x: 52.9, y: 70 }, R_SHIP)).toBeNull();
  });

  test("salvo meets salvo head-on", () => {
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 50, y: 70 }, 180, 2.5)).toBeCloseTo(20, 12);
  });

  test("salvo crosses a salvo's path at right angles", () => {
    // The stationary salvo lies along the mover's line of travel (heading 90 → its segment runs north–south).
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 50, y: 70 }, 90, 2.5)).toBeCloseTo(20 - 1.25, 12);
  });

  test("salvo passes beside a salvo", () => {
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 55, y: 70 }, 180, 2.5)).toBeNull();
    // Overlapping widths by 0.5 cm: contact.
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 52, y: 70 }, 180, 2.5)).toBeCloseTo(20, 12);
  });

  test("a salvo already overlapping at the start → 0; behind → none", () => {
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 50, y: 50 }, 90, 2.5)).toBe(0);
    expect(sweptSegmentVsSegment(O, 0, 30, 2.5, { x: 50, y: 40 }, 180, 2.5)).toBeNull();
  });
});

describe("table exit", () => {
  test("first edge crossed", () => {
    expect(exitT({ x: 90, y: 60 }, 0, 100, TABLE)).toBe(60);
    expect(exitT({ x: 90, y: 60 }, 90, 100, TABLE)).toBe(90);
    expect(exitT({ x: 90, y: 60 }, 270, 100, TABLE)).toBe(90);
    expect(exitT({ x: 175, y: 115 }, 45, 20, TABLE)).toBeCloseTo(5 * Math.SQRT2, 12);
  });

  test("staying on the table, or ending within EPS of the edge, isn't an exit", () => {
    expect(exitT({ x: 90, y: 60 }, 0, 50, TABLE)).toBeNull();
    expect(exitT({ x: 90, y: 60 }, 0, 60.0005, TABLE)).toBeNull();
  });
});

describe("segment helpers", () => {
  test("distance to a segment clamps to its ends", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(segmentPointDistance(a, b, { x: 5, y: 3 })).toBe(3);
    expect(segmentPointDistance(a, b, { x: -4, y: 3 })).toBe(5);
    expect(segmentPointDistance(a, a, { x: 3, y: 4 })).toBe(5);
    expect(segmentTouchesCircle(a, b, { x: 5, y: 3 }, 3)).toBe(true);
    expect(segmentTouchesCircle(a, b, { x: 5, y: 3.01 }, 3)).toBe(false);
  });
});
