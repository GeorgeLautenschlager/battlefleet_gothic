import { describe, expect, test } from "vitest";
import { asinDeg, atan2Deg, cosDeg, fdlibm, sinDeg } from "../src/math/dmath";
import { headingVector } from "../src/geometry/basic";
import { sampler } from "./helpers";

/** Bit pattern of a double, as 16 hex digits. */
function hex(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

describe("fdlibm port", () => {
  // V8 implements Math.sin/cos/atan/atan2/asin with the same fdlibm algorithms
  // (src/base/ieee754.cc), so in Node our port must agree bit for bit. This is
  // a test of the port's fidelity; other engines' Math may legitimately differ.
  const N = 20000;

  test("kernels match fdlibm sin/cos on |x| ≤ π/4", () => {
    const rnd = sampler(1);
    for (let i = 0; i < N; i++) {
      const x = (rnd() * 2 - 1) * (Math.PI / 4);
      expect(hex(fdlibm.kernelSin(x))).toBe(hex(Math.sin(x)));
      expect(hex(fdlibm.kernelCos(x))).toBe(hex(Math.cos(x)));
    }
  });

  test("atan, atan2 and asin match fdlibm", () => {
    const rnd = sampler(2);
    for (let i = 0; i < N; i++) {
      const a = (rnd() - 0.5) * Math.pow(10, rnd() * 8 - 4);
      expect(hex(fdlibm.atan(a))).toBe(hex(Math.atan(a)));
      const y = (rnd() - 0.5) * 400;
      const x = (rnd() - 0.5) * 400;
      expect(hex(fdlibm.atan2(y, x))).toBe(hex(Math.atan2(y, x)));
      const u = rnd() * 2 - 1;
      expect(hex(fdlibm.asin(u))).toBe(hex(Math.asin(u)));
    }
  });

  test("atan2 special cases", () => {
    for (const [y, x] of [[0, 5], [-0, 5], [0, -5], [-0, -5], [3, 0], [-3, 0], [1e300, 1e-300], [1e-300, -1e300]] as const) {
      expect(hex(fdlibm.atan2(y, x))).toBe(hex(Math.atan2(y, x)));
    }
  });
});

describe("degree functions", () => {
  test("exact at multiples of 90°", () => {
    const cases: [number, number, number][] = [
      [0, 0, 1], [90, 1, 0], [180, 0, -1], [270, -1, 0], [360, 0, 1],
      [-90, -1, 0], [450, 1, 0], [-360, 0, 1], [720, 0, 1],
    ];
    for (const [d, s, c] of cases) {
      expect(sinDeg(d)).toBe(s);
      expect(cosDeg(d)).toBe(c);
    }
  });

  test("never returns −0", () => {
    for (const d of [0, -0, 180, -180, 360, 90, 270, -90]) {
      expect(Object.is(sinDeg(d), -0)).toBe(false);
      expect(Object.is(cosDeg(d), -0)).toBe(false);
    }
    expect(Object.is(atan2Deg(-0, 5), -0)).toBe(false);
  });

  test("close to the platform functions everywhere", () => {
    const rnd = sampler(3);
    for (let i = 0; i < 20000; i++) {
      const d = (rnd() - 0.5) * 2000;
      const r = (d * Math.PI) / 180;
      expect(Math.abs(sinDeg(d) - Math.sin(r))).toBeLessThan(1e-13);
      expect(Math.abs(cosDeg(d) - Math.cos(r))).toBeLessThan(1e-13);
      const x = (rnd() - 0.5) * 300;
      const y = (rnd() - 0.5) * 300;
      expect(Math.abs(atan2Deg(x, y) - (Math.atan2(x, y) * 180) / Math.PI)).toBeLessThan(1e-12);
      const u = rnd() * 2 - 1;
      expect(Math.abs(asinDeg(u) - (Math.asin(u) * 180) / Math.PI)).toBeLessThan(1e-12);
    }
  });

  test("atan2Deg uses aviation bearings: x first, 0 = +y, clockwise, exact on the axes", () => {
    expect(atan2Deg(0, 10)).toBe(0);
    expect(atan2Deg(10, 0)).toBe(90);
    expect(atan2Deg(0, -10)).toBe(180);
    expect(atan2Deg(-10, 0)).toBe(-90);
    expect(atan2Deg(0, 0)).toBe(0);
    expect(atan2Deg(1, 1)).toBeCloseTo(45, 12);
    expect(atan2Deg(-24, -4)).toBeCloseTo(-99.462322208, 8); // reducer §13 worked example: norm → 260.5°
  });

  test("asinDeg is exact at ±1 and 0", () => {
    expect(asinDeg(1)).toBe(90);
    expect(asinDeg(-1)).toBe(-90);
    expect(asinDeg(0)).toBe(0);
  });

  test("headingVector is exact on cardinal headings", () => {
    expect(headingVector(0)).toEqual({ x: 0, y: 1 });
    expect(headingVector(90)).toEqual({ x: 1, y: 0 });
    expect(headingVector(180)).toEqual({ x: 0, y: -1 });
    expect(headingVector(270)).toEqual({ x: -1, y: 0 });
  });

  // Golden bit patterns. In Node these are implied by the fdlibm tests above;
  // their job is to catch drift when the suite runs in other JS engines.
  test("golden values", () => {
    const golden: [string, number, string][] = [
      ["sinDeg(30)", sinDeg(30), "3fdfffffffffffff"],
      ["cosDeg(60)", cosDeg(60), "3fdfffffffffffff"],
      ["sinDeg(45)", sinDeg(45), "3fe6a09e667f3bcd"],
      ["cosDeg(45)", cosDeg(45), "3fe6a09e667f3bcc"],
      ["sinDeg(12.5)", sinDeg(12.5), "3fcbb44b13b62571"],
      ["cosDeg(212.75)", cosDeg(212.75), "bfeae9caa5eaf330"],
      ["atan2Deg(3, 4)", atan2Deg(3, 4), "40426f58ce59e23c"],
      ["atan2Deg(-24, -4)", atan2Deg(-24, -4), "c058dd96afe2ebd0"],
      ["asinDeg(0.5)", asinDeg(0.5), "403e000000000001"],
      ["asinDeg(1.25 / 2.85)", asinDeg(1.25 / 2.85), "403a03ad7d7a9d0d"],
    ];
    for (const [name, value, bits] of golden) expect(`${name} = ${hex(value)}`).toBe(`${name} = ${bits}`);
  });
});
