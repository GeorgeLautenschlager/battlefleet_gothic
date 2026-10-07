/** Reserves (validator spec §4.2): `arrive`, and `end_step` in `move_ships` while reserves wait. */
import { EPS, FORMATION_RANGE } from "../geometry/constants";
import { approxLe, baseRadius, distance } from "../geometry/basic";
import { onTable, squadronOf } from "../state/derived";
import { angleBetween, arrivalEdge, canArrive, entryEdges, inwardHeadings, onEntryEdge, reservesMayWait } from "../rules/reserves";
import type { GameState, Point, Ship } from "../state/types";
import type { Arrive, EndStep } from "../transforms/types";
import { OK, reject, type ValidationResult } from "./reasons";

export function checkArrive(state: GameState, t: Arrive): ValidationResult {
  // 1: at least one ship, none twice
  const ids = t.placements.map((p) => p.shipId);
  if (ids.length === 0) return reject("MALFORMED", "An arrival brings at least one ship", { field: "placements" });
  if (new Set(ids).size !== ids.length) return reject("MALFORMED", "An arrival names a ship twice", { field: "placements" });

  // 2–4: the player's ships, waiting in reserve
  const ships: Ship[] = [];
  for (const id of ids) {
    const ship = state.ships.find((s) => s.id === id);
    if (ship === undefined) return reject("UNKNOWN_SHIP", `No ship ${id}`, { shipId: id });
    if (ship.owner !== t.player) return reject("NOT_YOUR_SHIP", `${ship.name} isn't yours`, { shipId: id });
    if (ship.status !== "reserve") return reject("NOT_IN_RESERVE", `${ship.name} isn't waiting in reserve`, { shipId: id });
    ships.push(ship);
  }

  // 5: one unit, a ship in no squadron or a whole squadron (T94)
  const first = ships[0] as Ship;
  const sq = squadronOf(state, first);
  const unit = sq === undefined ? [first.id] : sq.shipIds;
  if (unit.length !== ids.length || !unit.every((id) => ids.includes(id))) {
    return reject("ARRIVE_ONE_UNIT", sq === undefined ? "Bring one ship on at a time" : `${sq.name} arrives whole`, {
      shipIds: [...unit],
    });
  }

  // 6–8: between moves, with an entry edge open
  if (state.activation !== null) return reject("ACTIVATION_OPEN", "Another ship is part-way through its move", { shipId: state.activation.shipId });
  const moving = state.turnState.squadronMove ?? null;
  if (moving !== null) return reject("SQUADRON_MOVING", "A squadron is part-way through its move", { squadronId: moving.squadronId });
  const edges = entryEdges(state, t.player);
  if (!canArrive(state, t.player)) return reject("NO_ENTRY_EDGE", "No reserves can arrive now", { edges: edgesDetail(edges) });

  // 9–10: on an entry edge, facing in (T96)
  for (const p of t.placements) {
    if (!onEntryEdge(edges, p.position)) {
      return reject("NOT_ON_ENTRY_EDGE", "Reinforcements arrive on an entry edge", { shipId: p.shipId, edges: edgesDetail(edges) });
    }
    const inward = inwardHeadings(state, p.position);
    if (p.heading < 0 || p.heading >= 360 || !inward.every((h) => angleBetween(p.heading, h) < 90 - EPS)) {
      return reject("NOT_FACING_IN", "An arriving ship must face into the table", { shipId: p.shipId });
    }
  }

  // 10a: Surprise Attack's attackers come in from one edge, the first arrival's (T119)
  if (state.scenario.id === "surprise_attack" && (state.setup.surpriseAttack?.entryEdge ?? null) === null) {
    const edge = arrivalEdge(state, t.placements[0] as Arrive["placements"][number]);
    if (t.placements.some((p) => !inwardHeadings(state, p.position).includes(edge))) {
      return reject("ONE_ENTRY_EDGE", "The attackers move on from one table edge", { entryEdge: null });
    }
  }

  // 11: a squadron's stems form one chain
  if (!oneChain(t.placements.map((p) => p.position))) {
    return reject("NOT_IN_FORMATION", `Each ship must be within ${FORMATION_RANGE} cm of another`, { shipIds: ids });
  }

  // 12: no overlapping bases, among the new ones or with any on the table
  for (const [i, p] of t.placements.entries()) {
    const ship = ships[i] as Ship;
    const r = baseRadius(ship.profile.baseSize);
    const others: { name: string; id: string; at: Point; r: number }[] = [
      ...state.ships.filter(onTable).map((s) => ({ name: s.name, id: s.id, at: s.position as Point, r: baseRadius(s.profile.baseSize) })),
      ...t.placements.slice(0, i).map((q, j) => ({ name: (ships[j] as Ship).name, id: q.shipId, at: q.position, r: baseRadius((ships[j] as Ship).profile.baseSize) })),
    ];
    const hit = others.find((o) => distance(p.position, o.at) <= r + o.r - EPS);
    if (hit !== undefined) return reject("BASES_OVERLAP", `${ship.name} would overlap ${hit.name}`, { shipId: hit.id });
  }
  return OK;
}

/** end_step in move_ships: only to leave reserves waiting, once every ship on the table has moved (T95). */
export function checkEndMovement(state: GameState, t: EndStep): ValidationResult {
  if (!canArrive(state, t.player)) return reject("NO_ENTRY_EDGE", "Every ship must move: there are no reserves to wait for", { edges: [] });
  if (!reservesMayWait(state)) return reject("RESERVES_MUST_ARRIVE", `Every ${state.scenario.id === "raiders" ? "raider moves on this turn (p. 131)" : "attacker moves on this turn (p. 132)"}`);
  if (state.activation !== null) return reject("ACTIVATION_OPEN", "A ship is part-way through its move", { shipId: state.activation.shipId });
  const moving = state.turnState.squadronMove ?? null;
  if (moving !== null) return reject("SQUADRON_MOVING", "A squadron is part-way through its move", { squadronId: moving.squadronId });
  const left = state.ships.filter((s) => s.owner === t.player && s.status === "active" && state.turnState.ships[s.id]?.moved !== true);
  if (left.length > 0) return reject("SHIPS_TO_MOVE", "Every ship on the table must move first", { shipIds: left.map((s) => s.id) });
  return OK;
}

const edgesDetail = (edges: ReturnType<typeof entryEdges>) =>
  edges.map((e) => ({ from: { ...e.from }, to: { ...e.to }, inward: e.inward }));

/** Every stem within FORMATION_RANGE of another, all in one chain (state N35). */
function oneChain(points: readonly Point[]): boolean {
  if (points.length <= 1) return true;
  const reached = new Set([0]);
  const frontier = [0];
  while (frontier.length > 0) {
    const i = frontier.pop() as number;
    for (const [j, q] of points.entries()) {
      if (!reached.has(j) && approxLe(distance(points[i] as Point, q), FORMATION_RANGE)) {
        reached.add(j);
        frontier.push(j);
      }
    }
  }
  return reached.size === points.length;
}
