/** Engine constants (validator spec §2.1). Distances in cm. */

/** Tolerance for every geometric comparison (state spec §2). */
export const EPS = 0.001;

export const BASE_RADIUS = { small: 1.6, large: 3.0 } as const; // 32 mm / 60 mm bases (p. 44)
export const BM_RADIUS = 1.25; // state N1: 2.5 cm diameter
export const TORPEDO_WIDTH = 2.5; // p. 76
export const SHORT_RANGE = 15; // p. 62
export const LONG_RANGE = 30; // p. 62
export const DEFENCES_MOVE = 5; // p. 53
export const TURN_DISTANCE = { battleship: 15, cruiser: 10, escort: 0 } as const; // p. 54
export const BM_SLOWDOWN = 5; // p. 69
export const TELEPORT_RANGE = 10; // teleport attacks, pp. 91–92
export const MAX_LEADERSHIP = 10; // p. 48
