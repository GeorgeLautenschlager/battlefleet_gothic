/** Reserves arriving (transform §4.2, T94–T97): which units wait, and where a click on the table brings one on. */
import { geometry, reserves, squadronOf, type Arrive, type GameState, type PlayerId, type Point, type Ship } from "@bfg/engine";
import { mm } from "../table/view";

/** Each unit still waiting: a ship in no squadron, or a whole squadron, in fleet order. */
export function reserveUnits(state: GameState, player: PlayerId): Ship[][] {
  const out: Ship[][] = [];
  const seen = new Set<string>();
  for (const ship of state.ships) {
    if (ship.owner !== player || ship.status !== "reserve" || seen.has(ship.id)) continue;
    const sq = squadronOf(state, ship);
    const unit = sq === undefined ? [ship] : sq.shipIds.flatMap((id) => state.ships.find((s) => s.id === id && s.status === "reserve") ?? []);
    for (const s of unit) seen.add(s.id);
    out.push(unit);
  }
  return out;
}

/** Stems this far apart along the edge: clear of each other's bases, well inside formation. */
const SPACING = 6;

/**
 * The arrival a click at `p` asks for: the nearest point on an entry edge, the
 * unit spread along that edge around it, every ship facing straight in, turned
 * by `turn` degrees (−: to port).
 */
export function arrivalAt(state: GameState, player: PlayerId, unit: readonly Ship[], p: Point, turn = 0): Arrive | null {
  const edges = reserves.entryEdges(state, player);
  let best: { edge: (typeof edges)[number]; t: number; d: number } | null = null;
  for (const edge of edges) {
    const dx = edge.to.x - edge.from.x;
    const dy = edge.to.y - edge.from.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - edge.from.x) * dx + (p.y - edge.from.y) * dy) / len2));
    const at = { x: edge.from.x + dx * t, y: edge.from.y + dy * t };
    const d = geometry.distance(at, p);
    if (best === null || d < best.d) best = { edge, t, d };
  }
  if (best === null) return null;
  const { edge, t } = best;
  const len = geometry.distance(edge.from, edge.to);
  const heading = geometry.norm(edge.inward + turn);
  // Alternate either side of the click: 0, +6, −6, +12 …, kept on the segment.
  const placements = unit.map((ship, k) => {
    const offset = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * SPACING;
    const u = len === 0 ? 0 : Math.min(1, Math.max(0, t + offset / len));
    return { shipId: ship.id, position: mm({ x: edge.from.x + (edge.to.x - edge.from.x) * u, y: edge.from.y + (edge.to.y - edge.from.y) * u }), heading };
  });
  return { type: "arrive", player, placements };
}
