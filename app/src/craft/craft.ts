/**
 * Attack craft helpers for the UI: building launches, which waves can move,
 * waypoints within a wave's speed, and the CAP choices the engine accepts.
 * Legality is always the engine's; this only builds candidates and asks it.
 */
import { actor, craft, geometry, validate } from "@bfg/engine";
import type { AttackCraftWave, CraftRole, GameState, LaunchAttackCraft, MoveOrdnance, Point, Ship } from "@bfg/engine";

export const ROLE_NAMES: Record<CraftRole, string> = { fighter: "fighters", bomber: "bombers", assault_boat: "assault boats" };
export const ROLE_LETTER: Record<CraftRole, string> = { fighter: "F", bomber: "B", assault_boat: "A" };

export type Counts = Record<CraftRole, number>;
export const NO_CRAFT: Counts = { fighter: 0, bomber: 0, assault_boat: 0 };

/** A sensible first offer: the bays filled, half fighters and half bombers. */
export function defaultCounts(ship: Ship, capacity: number): Counts {
  const roles = craft.rolesCarried(ship);
  const fighters = roles.includes("fighter") ? Math.ceil(capacity / 2) : 0;
  const bombers = roles.includes("bomber") ? capacity - fighters : 0;
  return { fighter: fighters, bomber: bombers, assault_boat: 0 };
}

/**
 * One strike wave of everything in `counts` (fighters first, so they're lost
 * last, T25), and `capFighters` more fighters on CAP over the carrier.
 */
export function launchTransform(ship: Ship, counts: Counts, capFighters: number, recall: string[]): LaunchAttackCraft {
  const roles: CraftRole[] = (["fighter", "bomber", "assault_boat"] as const).flatMap((r) => Array<CraftRole>(counts[r]).fill(r));
  const waves = [
    ...(roles.length > 0 ? [{ roles, cap: false }] : []),
    ...(capFighters > 0 ? [{ roles: Array<CraftRole>(capFighters).fill("fighter"), cap: true }] : []),
  ];
  return { type: "launch_attack_craft", player: ship.owner, shipId: ship.id, waves, recall };
}

const isWave = (o: GameState["ordnance"][number]): o is AttackCraftWave => o.kind === "attack_craft";

/** The player's waves in flight (not CAP): the ones a launch may recall. */
export const freeWaves = (state: GameState, player: string): AttackCraftWave[] =>
  state.ordnance.filter(isWave).filter((w) => w.owner === player && w.cap === null);

/** CAP fighters over a ship, in ordnance order. */
export const capOver = (state: GameState, shipId: string): AttackCraftWave[] => state.ordnance.filter(isWave).filter((w) => w.cap === shipId);

/**
 * Waves the acting player can fly now: their own, unmoved this step; CAP
 * fighters only in the opponent's Ordnance Phase (p. 82).
 */
export function movableWaves(state: GameState): AttackCraftWave[] {
  const step = state.clock.step;
  if (state.clock.stage !== "battle" || (step !== "active_ordnance" && step !== "inactive_ordnance") || state.pending.length > 0) return [];
  const mover = actor(state);
  return state.ordnance
    .filter(isWave)
    .filter((w) => w.owner === mover && !state.turnState.ordnanceMoved.includes(w.id) && (w.cap === null || step === "inactive_ordnance"));
}

export function pathLength(from: Point, path: readonly Point[]): number {
  let total = 0;
  let at = from;
  for (const p of path) {
    total += geometry.distance(at, p);
    at = p;
  }
  return total;
}

const round = (p: Point): Point => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/**
 * The waypoint a click at `target` adds: rounded to the millimetre, pulled
 * back toward the last point if it would take the path past the wave's speed,
 * and kept on the table.
 */
export function nextWaypoint(state: GameState, wave: AttackCraftWave, path: readonly Point[], target: Point): Point {
  const from = path[path.length - 1] ?? wave.position;
  const left = craft.waveSpeed(wave) - pathLength(wave.position, path);
  const d = geometry.distance(from, target);
  const reach = Math.max(0, left - 0.1); // room for rounding
  const f = d > reach && d > 0 ? reach / d : 1;
  const p = round({ x: from.x + f * (target.x - from.x), y: from.y + f * (target.y - from.y) });
  return { x: Math.min(state.table.width, Math.max(0, p.x)), y: Math.min(state.table.height, Math.max(0, p.y)) };
}

export function moveTransform(state: GameState, wave: AttackCraftWave, path: Point[], cap?: string): MoveOrdnance {
  const player = actor(state);
  return { type: "move_ordnance", player: player === "p2" ? "p2" : "p1", ordnanceId: wave.id, path, ...(cap === undefined ? {} : { cap }) };
}

/** Friendly ships this path would let the wave fly CAP over: it's all fighters and ends touching them. */
export function capChoices(state: GameState, wave: AttackCraftWave, path: Point[]): Ship[] {
  if (wave.squadrons.some((s) => s.role !== "fighter")) return [];
  return state.ships.filter((s) => s.owner === wave.owner && s.status === "active" && validate(state, moveTransform(state, wave, path, s.id)).ok);
}

/** "Fortitude's Fury, Starhawk" */
export function waveName(state: GameState, wave: AttackCraftWave): string {
  const from = state.ships.find((s) => s.id === wave.launchedBy)?.name;
  return `${from ? `${from}'s ` : ""}${wave.squadrons.map((s) => s.name).join(", ")}`;
}

/** Where to draw marker `i` of `n` inside a wave's footprint: a compact grid, 1.4 cm apart. */
export function markerOffset(i: number, n: number): Point {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: (col - (cols - 1) / 2) * 1.4, y: (row - (rows - 1) / 2) * 1.4 };
}

/** Where to draw CAP fighter `i` of `n` around its ship: on a ring just outside the base. */
export function capOffset(i: number, n: number, baseRadius: number): Point {
  const angle = (2 * Math.PI * i) / Math.max(1, n) + Math.PI / 4;
  const r = baseRadius + 1.1;
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}
