import { constants, geometry, validate, type GameState, type Point, type Ship, type Weapon } from "@bfg/engine";
import { toSvg, type View } from "../table/view";
import { novaReach, novaShot, QUADRANT_SPAN } from "./fire";

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

/** A ring sector: between radii r1 < r2, from bearing a1 to a2 clockwise. */
function band(view: View, centre: Point, r1: number, r2: number, a1: number, a2: number): string {
  const at = (r: number, a: number) => {
    const d = geometry.headingVector(a);
    return toSvg(view, { x: centre.x + r * d.x, y: centre.y + r * d.y });
  };
  const large = a2 - a1 > 180 ? 1 : 0;
  const [p1, p2, q2, q1] = [at(r1, a1), at(r2, a1), at(r2, a2), at(r1, a2)];
  return `M${p1.x},${p1.y} L${p2.x},${p2.y} A${r2},${r2} 0 ${large} 1 ${q2.x},${q2.y} L${q1.x},${q1.y} A${r1},${r1} 0 ${large} 0 ${p1.x},${p1.y} Z`;
}

/**
 * The aimed weapon's arcs out to its range (or a torpedo's run), and a torpedo's planned path.
 * A nova cannon shows where its template's centre may go, the template under the pointer, and how far it could scatter.
 */
export function FireOverlay({ state, ship, weapon, bearing, novaAim = null }: { state: GameState; ship: Ship; weapon: Weapon; bearing: number | null; novaAim?: Point | null }) {
  if (ship.position === null || ship.heading === null) return null;
  const view: View = state.table;
  if (weapon.kind === "nova_cannon") return <NovaOverlay state={state} ship={ship} weapon={weapon} aim={novaAim} />;
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

function NovaOverlay({ state, ship, weapon, aim }: { state: GameState; ship: Ship; weapon: Weapon; aim: Point | null }) {
  const view: View = state.table;
  const pos = ship.position as Point;
  const heading = ship.heading as number;
  const r = constants.NOVA_RADIUS;
  const [inner, outer] = [(weapon.minRange ?? 0) + r, (weapon.range ?? 0) + r]; // template centres: near edge 30–150 cm away
  let template = null;
  if (aim !== null) {
    const ok = validate(state, novaShot(ship, weapon, aim)).ok;
    const c = toSvg(view, aim);
    const scatter = 6 * novaReach(ship, aim).dice;
    template = (
      <g className={ok ? "nova ok" : "nova bad"}>
        <circle className="nova-scatter" cx={c.x} cy={c.y} r={scatter + r} />
        <circle className="nova-template" cx={c.x} cy={c.y} r={r} />
        <circle className="nova-hole" cx={c.x} cy={c.y} r={constants.NOVA_HOLE_RADIUS} />
      </g>
    );
  }
  return (
    <g className="fire-overlay" pointerEvents="none">
      {weapon.arcs.map((q) => {
        const [from, to] = QUADRANT_SPAN[q];
        return <path key={q} className="arc nova_cannon" d={band(view, pos, inner, outer, heading + from, heading + to)} />;
      })}
      {template}
    </g>
  );
}
