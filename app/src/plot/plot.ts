/**
 * The movement plotter's maths: turning pointer positions into path steps,
 * and asking the engine what it thinks of the result. Pure functions only,
 * so it's all unit-testable. (Platform trig is fine here: these numbers only
 * propose a path; the engine walks it with its own deterministic maths.)
 */
import { geometry, moveParameters, paths, validate } from "@bfg/engine";
import type { GameState, PathStep, Point, Ship, Transform } from "@bfg/engine";

/** Below this many degrees off the bow, a click means straight ahead. */
export const STRAIGHT_SNAP = 2;

const round1 = (n: number) => Math.round(n * 10) / 10;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Signed bearing of `point` off the bow: + starboard, − port, in (−180, 180]. */
export function offBow(from: { position: Point; heading: number }, point: Point): number {
  const b = geometry.relBearing(from.position, from.heading, point);
  return b > 180 ? b - 360 : b;
}

/**
 * The steps that take the end of `path` toward `pointer`: turn toward it (up to
 * `maxTurn`), then advance as far as its projection on the new heading.
 * Straight-only (or nearly dead ahead) skips the turn.
 */
export function propose(ship: Ship, path: readonly PathStep[], pointer: Point, maxTurn: number, straightOnly = false): PathStep[] {
  const end = paths.walkShipPath(ship, path).end;
  const d = geometry.distance(end.position, pointer);
  if (d < 0.05) return [];
  const b = Math.round(offBow(end, pointer));
  const turn = straightOnly || Math.abs(b) < STRAIGHT_SNAP || maxTurn === 0 ? 0 : Math.max(-maxTurn, Math.min(maxTurn, b));
  const ahead = round1(d * Math.cos(rad(b - turn)));
  const steps: PathStep[] = [];
  if (turn !== 0) steps.push({ kind: "turn", degrees: turn });
  if (ahead > 0) steps.push({ kind: "advance", distance: ahead });
  return steps;
}

/** Append steps, merging an advance into a preceding advance and a turn into a preceding turn. */
export function append(path: readonly PathStep[], steps: readonly PathStep[]): PathStep[] {
  const out = [...path];
  for (const step of steps) {
    const last = out.at(-1);
    if (last?.kind === "advance" && step.kind === "advance") {
      out[out.length - 1] = { kind: "advance", distance: round1(last.distance + step.distance) };
    } else if (last?.kind === "turn" && step.kind === "turn") {
      const degrees = last.degrees + step.degrees;
      if (degrees === 0) out.pop();
      else out[out.length - 1] = { kind: "turn", degrees };
    } else {
      out.push(step);
    }
  }
  return out;
}

export type Verdict =
  | { kind: "ok" }
  /** Legal so far, but the ship must go further. */
  | { kind: "short"; message: string }
  | { kind: "illegal"; message: string };

/** What the engine makes of moving along `path` now. */
export function judge(state: GameState, t: Transform): Verdict {
  const v = validate(state, t);
  if (v.ok) return { kind: "ok" };
  const { code, message, details } = v.reason;
  const total = typeof details?.["total"] === "number" ? details["total"] : null;
  const needed = typeof details?.["required"] === "number" ? details["required"] : typeof details?.["limit"] === "number" ? details["limit"] : null;
  const short =
    code === "PATH_TOO_SHORT" ||
    ((code === "MUST_MOVE_FULL_DISTANCE" || code === "MUST_STOP_AT_BLAST_MARKER") && total !== null && needed !== null && total < needed);
  return short ? { kind: "short", message } : { kind: "illegal", message };
}

export type PlotStats = {
  total: number;
  min: number;
  max: number;
  turnsUsed: number;
  turnsAllowed: number;
  turnDistance: number;
  /** Forward distance since the last turn (or the start). */
  sinceTurn: number;
  /** Whether a turn may be made right here (Burn Retros may turn without moving first). */
  canTurnHere: boolean;
  end: { position: Point; heading: number };
};

export function stats(state: GameState, ship: Ship, path: readonly PathStep[]): PlotStats {
  const a = state.activation?.shipId === ship.id ? state.activation : null;
  const p = moveParameters(ship, a);
  const walk = paths.walkShipPath(ship, path);
  const lastTurn = walk.turns.at(-1);
  const sinceTurn = lastTurn === undefined ? walk.total : walk.total - distanceAtStep(walk, lastTurn.stepIndex);
  const turnsLeft = walk.turns.length < p.turnsAllowed;
  const freeTurn = p.order === "burn_retros" && sinceTurn === 0;
  return {
    total: walk.total,
    min: p.minDistance,
    max: p.maxIfBR,
    turnsUsed: walk.turns.length,
    turnsAllowed: p.turnsAllowed,
    turnDistance: p.turnDistance,
    sinceTurn,
    canTurnHere: turnsLeft && (freeTurn || sinceTurn >= p.turnDistance - 1e-6),
    end: walk.end,
  };
}

function distanceAtStep(walk: ReturnType<typeof paths.walkShipPath>, stepIndex: number): number {
  let d = 0;
  for (const leg of walk.legs) if (leg.stepIndex < stepIndex) d = leg.distanceBefore + leg.length;
  return d;
}

/** Each leg as a line segment, for drawing. */
export function segments(ship: Ship, path: readonly PathStep[]): { from: Point; to: Point }[] {
  return paths.walkShipPath(ship, path).legs.map((leg) => {
    const dir = geometry.headingVector(leg.heading);
    return { from: leg.start, to: { x: leg.start.x + leg.length * dir.x, y: leg.start.y + leg.length * dir.y } };
  });
}
