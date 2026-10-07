/** Engine constants (validator spec §2.1). Distances in cm. */

/** Tolerance for every geometric comparison (state spec §2). */
export const EPS = 0.001;

export const BASE_RADIUS = { small: 1.6, large: 3.0 } as const; // 32 mm / 60 mm bases (p. 44)
export const BM_RADIUS = 1.25; // state N1: 2.5 cm diameter
export const TORPEDO_WIDTH = 2.5; // p. 76
export const SHORT_RANGE = 15; // p. 62
export const LONG_RANGE = 30; // p. 62
export const DEFENCES_MOVE = 5; // p. 53
export const TURN_DISTANCE = { battleship: 15, cruiser: 10, escort: 0, defence: 0 } as const; // p. 54; defences never move
export const BM_SLOWDOWN = 5; // p. 69
export const TELEPORT_RANGE = 10; // teleport attacks, pp. 91–92
export const MAX_LEADERSHIP = 10; // p. 48
export const CRAFT_RADIUS = 1; // one attack craft marker's footprint (state N8)
export const MAX_MASSED_TURRETS = 3; // p. 80
export const NOVA_RADIUS = 2.5; // the nova cannon template: 5 cm across (state N13)
export const NOVA_HOLE_RADIUS = 0.6; // its centre hole: 1.2 cm across (state N13)
export const FORMATION_RANGE = 15; // squadron formation, stem to stem (p. 96, state N35)
export const SLAANESH_RANGE = 15; // the Mark of Slaanesh, stem to stem (p. 232, state N26)
export const MINE_RADIUS = 1; // an orbital mine marker (state N109)
export const MINE_SPEED = 10; // an orbital mine's move (fleets book p. 512)
export const MINEFIELD_REACH = 15; // a minefield's nearest point from the planet's edge (state N108)
export const DETECTION_RANGE = 30; // a minefield's reach for detecting ships (state N118)
