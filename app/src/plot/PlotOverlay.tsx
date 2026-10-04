import { geometry, type GameState } from "@bfg/engine";
import { toSvg, type View } from "../table/view";
import { segments } from "./plot";
import type { Plot } from "./usePlot";

const ray = (from: { x: number; y: number }, heading: number, length: number) => {
  const d = geometry.headingVector(heading);
  return { x: from.x + length * d.x, y: from.y + length * d.y };
};

/** The planned path, the pointer preview, and guides for how far and where the ship may turn. */
export function PlotOverlay({ state, plot }: { state: GameState; plot: Plot }) {
  const view: View = state.table;
  const s = (p: { x: number; y: number }) => toSvg(view, p);
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, cls: string, key: string | number) => {
    const [p, q] = [s(a), s(b)];
    return <line key={key} className={cls} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
  };
  const { stats: st, ship } = plot;
  const committed = segments(ship, plot.path);
  const previewSegs = plot.preview.length === 0 ? [] : segments(ship, [...plot.path, ...plot.preview]);

  // Guides from the end of the committed path.
  const remaining = Math.max(0, st.max - st.total);
  const end = st.end;
  const turnsLeft = st.turnsUsed < st.turnsAllowed;
  const untilTurn = Math.max(0, st.turnDistance - st.sinceTurn);
  const guides = [];
  if (remaining > 0) guides.push(line(end.position, ray(end.position, end.heading, remaining), "plot-guide", "reach"));
  if (turnsLeft && st.canTurnHere) {
    const arm = Math.min(remaining, 8);
    guides.push(line(end.position, ray(end.position, end.heading - ship.profile.turns, arm), "plot-turn", "port"));
    guides.push(line(end.position, ray(end.position, end.heading + ship.profile.turns, arm), "plot-turn", "stbd"));
  } else if (turnsLeft && untilTurn > 0 && untilTurn <= remaining) {
    const at = s(ray(end.position, end.heading, untilTurn));
    guides.push(<circle key="turn-at" className="plot-turn-at" cx={at.x} cy={at.y} r={0.6} />);
  }

  return (
    <g className="plot" pointerEvents="none">
      {guides}
      {previewSegs.map((seg, i) => line(seg.from, seg.to, `plot-preview ${plot.previewVerdict.kind}`, `p${i}`))}
      {committed.map((seg, i) => line(seg.from, seg.to, "plot-path", `c${i}`))}
    </g>
  );
}
