/**
 * Reserves (state §4, §11, N47–N52): ships that start off the table and arrive
 * along an entry edge during the battle. The Bait's reinforcements are the first.
 */
import { EPS } from "../geometry/constants";
import { norm, segmentPointDistance } from "../geometry/basic";
import { activePlayer, otherPlayer, roundOf } from "../state/derived";
import type { GameState, PlayerId, Point } from "../state/types";
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

/** Where `player`'s reserves may arrive this turn (state §11): The Bait's east edge, and the long edges opening behind it. */
export function entryEdges(state: GameState, player: PlayerId): EntryEdge[] {
  if (pursuedPlayer(state) !== player) return [];
  const { width: w, height: h } = state.table;
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

/** Nothing of `player`'s is active or waiting in reserve (state D6, N52). */
export const eliminated = (state: GameState, player: PlayerId): boolean =>
  !state.ships.some((s) => s.owner === player && (s.status === "active" || s.status === "reserve"));

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

/** The smaller angle between two headings, 0–180 (validator §2.3). */
export function angleBetween(a: number, b: number): number {
  const d = norm(a - b);
  return Math.min(d, 360 - d);
}
