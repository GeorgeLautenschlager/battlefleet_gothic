/**
 * Deterministic maths (validator spec §2.8, ruling V6).
 *
 * JavaScript's Math.sin/cos/atan2/asin are "implementation-approximated" and
 * may differ in the last bit between engines. These are pure-software ports of
 * the classic fdlibm routines (Sun Microsystems, 1993), so every platform gets
 * bit-identical results. Only IEEE-exact operations are used: + − × ÷,
 * Math.sqrt / abs / round, and bit access through a DataView.
 *
 * Angles are in degrees. sinDeg/cosDeg reduce the argument in degrees first,
 * so multiples of 90° are exact: sinDeg(90) === 1, cosDeg(90) === 0.
 *
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

const DEG_TO_RAD = 0.017453292519943295; // π / 180
const RAD_TO_DEG = 57.29577951308232; // 180 / π

// ---------------------------------------------------------------------------
// Bit access (big-endian DataView: word 0 is the high word)

const view = new DataView(new ArrayBuffer(8));

function highWord(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

function lowWord(x: number): number {
  view.setFloat64(0, x);
  return view.getUint32(4);
}

function fromWords(high: number, low: number): number {
  view.setInt32(0, high);
  view.setUint32(4, low);
  return view.getFloat64(0);
}

function withLowWordZero(x: number): number {
  view.setFloat64(0, x);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

// ---------------------------------------------------------------------------
// Kernels, valid for |x| ≤ π/4 (fdlibm k_sin.c / k_cos.c, tail y = 0)

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return x; // |x| < 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - z * r); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0); // x/4
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - z * r);
}

// ---------------------------------------------------------------------------
// atan (fdlibm s_atan.c)

const ATAN_HI = [
  4.63647609000806093515e-1, // atan(0.5)
  7.85398163397448278999e-1, // atan(1)
  9.82793723247329054082e-1, // atan(1.5)
  1.57079632679489655800e0, // atan(inf)
] as const;

const ATAN_LO = [
  2.26987774529616870924e-17,
  3.06161699786838301793e-17,
  1.39033110312309984516e-17,
  6.12323399573676603587e-17,
] as const;

const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

function atan(input: number): number {
  let x = input;
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (x !== x) return x + x; // NaN
    return hx > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  let id: 0 | 1 | 2 | 3 | -1;
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        // 11/16 <= |x| < 19/16
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      // |x| < 2.4375
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      // 2.4375 <= |x| < 2^66
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id === -1) return x - x * (s1 + s2);
  const r = ATAN_HI[id] - (x * (s1 + s2) - ATAN_LO[id] - x);
  return hx < 0 ? -r : r;
}

// ---------------------------------------------------------------------------
// atan2 (fdlibm e_atan2.c), standard argument order: atan2(y, x)

const PI = 3.141592653589793; // fdlibm: 3.1415926535897931160E+00 (same double)
const PI_O_2 = 1.5707963267948965580e0;
const PI_LO = 1.2246467991473532e-16; // fdlibm: 1.2246467991473531772E-16 (same double)

function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y; // NaN
  if (x === 1) return atan(y);
  const hx = highWord(x);
  const hy = highWord(y);
  const m = (hy < 0 ? 1 : 0) | (hx < 0 ? 2 : 0); // 2·sign(x) + sign(y)

  if (y === 0) {
    switch (m) {
      case 0:
      case 1:
        return y; // atan2(±0, +anything) = ±0
      case 2:
        return PI; // atan2(+0, −anything) = π
      default:
        return -PI; // atan2(−0, −anything) = −π
    }
  }
  if (x === 0) return hy < 0 ? -PI_O_2 : PI_O_2;
  // Infinite arguments never occur in the engine (all coordinates are finite).

  const ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  const k = (iy - ix) >> 20;
  let z: number;
  let quadrant = m;
  if (k > 60) {
    // |y/x| > 2^60
    z = PI_O_2 + 0.5 * PI_LO;
    quadrant &= 1;
  } else if (hx < 0 && k < -60) {
    z = 0; // 0 > |y|/x > −2^−60
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (quadrant) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

// ---------------------------------------------------------------------------
// asin (fdlibm e_asin.c)

const PIO2_HI = 1.57079632679489655800e0;
const PIO2_LO = 6.12323399573676603587e-17;
const PIO4_HI = 7.85398163397448278999e-1;
const PS0 = 1.66666666666666657415e-1;
const PS1 = -3.25565818622400915405e-1;
const PS2 = 2.01212532134862925881e-1;
const PS3 = -4.00555345006794114027e-2;
const PS4 = 7.91534994289814532176e-4;
const PS5 = 3.47933107596021167570e-5;
const QS1 = -2.40339491173441421878e0;
const QS2 = 2.02094576023350569471e0;
const QS3 = -6.88283971605453293030e-1;
const QS4 = 7.70381505559019352791e-2;

function asin(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | lowWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO; // asin(±1) = ±π/2
    return NaN; // |x| > 1
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  // 1 > |x| >= 0.5
  const w = 1 - Math.abs(x);
  let t = w * 0.5;
  let p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  let q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    const w2 = p / q;
    t = PIO2_HI - (2 * (s + s * w2) - PIO2_LO);
  } else {
    const w2 = withLowWordZero(s);
    const c = (t - w2 * w2) / (s + w2);
    const r = p / q;
    p = 2 * s * r - (PIO2_LO - 2 * c);
    q = PIO4_HI - 2 * w2;
    t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}

// ---------------------------------------------------------------------------
// Public API: degrees

/** Reduce degrees to an octant: d ≡ 90·q + rem, rem ∈ [−45, 45], q ∈ 0..3. Exact. */
function reduceDeg(d: number): { q: number; x: number } {
  let a = d % 360;
  if (a < 0) a += 360;
  const n = Math.round(a / 90); // 0..4
  const rem = a - n * 90; // exact (Sterbenz)
  return { q: n % 4, x: rem * DEG_TO_RAD };
}

/** sin of an angle in degrees. Exact at multiples of 90°. */
export function sinDeg(d: number): number {
  const { q, x } = reduceDeg(d);
  let r: number;
  switch (q) {
    case 0:
      r = kernelSin(x);
      break;
    case 1:
      r = kernelCos(x);
      break;
    case 2:
      r = -kernelSin(x);
      break;
    default:
      r = -kernelCos(x);
  }
  return r + 0; // normalise −0 to +0 so results survive a JSON round trip
}

/** cos of an angle in degrees. Exact at multiples of 90°. */
export function cosDeg(d: number): number {
  const { q, x } = reduceDeg(d);
  let r: number;
  switch (q) {
    case 0:
      r = kernelCos(x);
      break;
    case 1:
      r = -kernelSin(x);
      break;
    case 2:
      r = -kernelCos(x);
      break;
    default:
      r = kernelSin(x);
  }
  return r + 0;
}

/** asin in degrees, for x in [−1, 1]. asinDeg(±1) = ±90 exactly. */
export function asinDeg(x: number): number {
  if (x === 1) return 90;
  if (x === -1) return -90;
  return asin(x) * RAD_TO_DEG + 0;
}

/**
 * The bearing of the vector (x, y), in degrees clockwise from +y, in (−180, 180].
 * Note the argument order: x first (validator spec §2.3). Exact on the axes.
 * atan2Deg(0, 0) is 0.
 */
export function atan2Deg(x: number, y: number): number {
  if (x === 0) return y < 0 ? 180 : 0;
  if (y === 0) return x > 0 ? 90 : -90;
  return atan2(x, y) * RAD_TO_DEG + 0;
}

/** Radian-level fdlibm functions, exported for conformance tests only. */
export const fdlibm = { kernelSin, kernelCos, atan, atan2, asin } as const;
