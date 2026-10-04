import { geometry, type GameState, type Point, type Ship, type Weapon } from "@bfg/engine";
import { toSvg, type View } from "../table/view";
import { QUADRANT_SPAN } from "./fire";

/** An arc wedge from `centre`, between absolute table bearings a1 → a2 (clockwise). */
function wedge(view: View, centre: Point, r: number, a1: number, a2: number): string {
  const at = (a: number) => {
    const d = geometry.headingVector(a);
    return toSvg(view, { x: centre.x + r * d.x, y: centre.y + r * d.y });
  };
  const c = toSvg(view, centre);
  const [p, q] = [at(a1), at(a2)];
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M${c.x},${c.y} L${p.x},${p.y} A${r},${r} 0 ${large} 1 ${q.x},${q.y} Z`;
}

/** The aimed weapon's arcs out to its range (or a torpedo's run), and a torpedo's planned path. */
export function FireOverlay({ state, ship, weapon, bearing }: { state: GameState; ship: Ship; weapon: Weapon; bearing: number | null }) {
  if (ship.position === null || ship.heading === null) return null;
  const view: View = state.table;
  const reach = weapon.kind === "torpedoes" ? (weapon.speed ?? 0) : (weapon.range ?? 0);
  const heading = ship.heading;
  const pos = ship.position;
  let run = null;
  if (weapon.kind === "torpedoes" && bearing !== null) {
    const h = heading + bearing;
    const d = geometry.headingVector(h);
    const across = geometry.headingVector(h + 90);
    const w = 1.25; // half of the 2.5 cm salvo width
    const end = { x: pos.x + reach * d.x, y: pos.y + reach * d.y };
    const bar = (p: Point) => {
      const [a, b] = [toSvg(view, { x: p.x - w * across.x, y: p.y - w * across.y }), toSvg(view, { x: p.x + w * across.x, y: p.y + w * across.y })];
      return `M${a.x},${a.y} L${b.x},${b.y}`;
    };
    const [s, e] = [toSvg(view, pos), toSvg(view, end)];
    run = <path className="torpedo-run" d={`M${s.x},${s.y} L${e.x},${e.y} ${bar(pos)} ${bar(end)}`} />;
  }
  return (
    <g className="fire-overlay" pointerEvents="none">
      {weapon.arcs.map((q) => {
        const [from, to] = QUADRANT_SPAN[q];
        return <path key={q} className={`arc ${weapon.kind}`} d={wedge(view, pos, reach, heading + from, heading + to)} />;
      })}
      {run}
    </g>
  );
}
