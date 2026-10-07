/**
 * Reserves (state §4, §11, N47–N52): ships that start off the table and arrive
 * along an entry edge during the battle. The Bait's reinforcements are the first.
 */
import { EPS } from "../geometry/constants";
import { norm, segmentPointDistance } from "../geometry/basic";
import { activePlayer, otherPlayer, roundOf } from "../state/derived";
import type { Facing, GameState, PlayerId, Point } from "../state/types";
import type { Division } from "./engagement";

/** A stretch of table edge reserves may arrive on, and the heading pointing straight into the table. */
export type EntryEdge = { from: Point; to: Point; inward: number };

/** How far each long edge opens per round after the first (p. 130, state N51). */
export const BAIT_EDGE_PER_ROUND = 30;

/** The Bait's divisions (state §4, N49–N50): the bait round the centre, the pursuers in the west strip, all facing east. */
export const BAIT_DIVISIONS = {
  pursued: [{ rect: { x: 75, y: 45, width: 30, height: 30 }, heading: 90 }],
  pursuers: [{ rect: { x: 0, y: 0, width: 30, height: 120 }, heading: 90 }],
} as const satisfies Record<string, readonly Division[]>;

/** The Bait's pursued player: the defender, who fields the bait and its reinforcements (state N47). */
export function pursuedPlayer(state: GameState): PlayerId | null {
  const attacker = state.scenario.attacker;
  return state.scenario.id === "the_bait" && attacker !== undefined ? otherPlayer(attacker) : null;
}

/** The Raiders' defender's zone (state §4, N58): every stem at least 30 cm from every edge; the heading comes from `raid.facing`. */
export const RAIDERS_ZONE = { x: 30, y: 30, width: 120, height: 60 } as const;

/** Stems of different units at least this far apart when the defender deploys (state N59). */
export const RAIDERS_SPACING = 20;

/**
 * Where `player`'s reserves may arrive this turn (state §11): The Bait's east edge, and the
 * long edges opening behind it; The Raiders' four edges, in the raiders' first turn only;
 * Surprise Attack's four edges until the attackers' first arrival picks one (N76).
 */
export function entryEdges(state: GameState, player: PlayerId): EntryEdge[] {
  const { width: w, height: h } = state.table;
  const { id } = state.scenario;
  if (id === "raiders" || id === "surprise_attack") {
    if (state.scenario.attacker !== player || state.clock.playerTurn !== 1) return [];
    const all: EntryEdge[] = [
      { from: { x: 0, y: h }, to: { x: w, y: h }, inward: 180 },
      { from: { x: w, y: 0 }, to: { x: w, y: h }, inward: 270 },
      { from: { x: 0, y: 0 }, to: { x: w, y: 0 }, inward: 0 },
      { from: { x: 0, y: 0 }, to: { x: 0, y: h }, inward: 90 },
    ];
    const chosen = state.setup.surpriseAttack?.entryEdge ?? null;
    return chosen === null ? all : all.filter((e) => e.inward === chosen);
  }
  if (pursuedPlayer(state) !== player) return [];
  const edges: EntryEdge[] = [{ from: { x: w, y: 0 }, to: { x: w, y: h }, inward: 270 }];
  const round = roundOf(state.clock.playerTurn);
  if (round >= 2) {
    const x = Math.max(0, w - BAIT_EDGE_PER_ROUND * (round - 1));
    edges.push({ from: { x, y: 0 }, to: { x: w, y: 0 }, inward: 0 }, { from: { x, y: h }, to: { x: w, y: h }, inward: 180 });
  }
  return edges;
}

export const hasReserves = (state: GameState, player: PlayerId): boolean =>
  state.ships.some((s) => s.owner === player && s.status === "reserve");

/** `player` may bring reserves on now (state §11). */
export function canArrive(state: GameState, player: PlayerId): boolean {
  return (
    state.clock.stage === "battle" &&
    state.clock.step === "move_ships" &&
    activePlayer(state) === player &&
    hasReserves(state, player) &&
    entryEdges(state, player).length > 0
  );
}

/** `player`'s reserves may stay off the table past their Movement Phase: The Bait's may; The Raiders' and Surprise Attack's all arrive (state N60, N76). */
export const reservesMayWait = (state: GameState): boolean => state.scenario.id !== "raiders" && state.scenario.id !== "surprise_attack";

/** Nothing of `player`'s is active or waiting in reserve, stationary defences not counting (state D6, N52, N102). */
export const eliminated = (state: GameState, player: PlayerId): boolean =>
  !state.ships.some((s) => s.owner === player && s.profile.type !== "defence" && (s.status === "active" || s.status === "reserve"));

export const onEntryEdge = (edges: readonly EntryEdge[], p: Point): boolean =>
  edges.some((e) => segmentPointDistance(e.from, e.to, p) <= EPS);

/** The inward headings of every table edge `p` lies on (transform T96). */
export function inwardHeadings(state: GameState, p: Point): number[] {
  const { width: w, height: h } = state.table;
  const headings: number[] = [];
  if (Math.abs(p.x) <= EPS) headings.push(90);
  if (Math.abs(p.x - w) <= EPS) headings.push(270);
  if (Math.abs(p.y) <= EPS) headings.push(0);
  if (Math.abs(p.y - h) <= EPS) headings.push(180);
  return headings;
}

/**
 * The edge a ship arriving at `position` with `heading` comes in from (state N76): the edge its stem is on,
 * or at a corner, the one it faces most nearly straight in from (the first on a tie: west, east, bottom, top).
 */
export function arrivalEdge(state: GameState, placement: { position: Point; heading: number }): Facing {
  const found = inwardHeadings(state, placement.position);
  const edges = found.length > 0 ? found : [nearestEdge(state, placement.position)];
  let best = edges[0] ?? 0;
  for (const h of edges) if (angleBetween(placement.heading, h) < angleBetween(placement.heading, best) - EPS) best = h;
  return best as Facing;
}

/** The inward heading of the table edge nearest `p` (west, east, bottom, top on a tie). */
function nearestEdge(state: GameState, p: Point): number {
  const { width: w, height: h } = state.table;
  const gaps: [number, number][] = [
    [Math.abs(p.x), 90],
    [Math.abs(w - p.x), 270],
    [Math.abs(p.y), 0],
    [Math.abs(h - p.y), 180],
  ];
  return gaps.reduce((a, b) => (b[0] < a[0] - EPS ? b : a))[1];
}

/** The smaller angle between two headings, 0–180 (validator §2.3). */
export function angleBetween(a: number, b: number): number {
  const d = norm(a - b);
  return Math.min(d, 360 - d);
}
