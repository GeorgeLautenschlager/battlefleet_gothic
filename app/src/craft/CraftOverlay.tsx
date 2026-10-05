import { craft, type GameState, type Point } from "@bfg/engine";
import { toSvg } from "../table/view";
import type { CraftPlot } from "./useCraftPlot";

/** The wave's planned flight: committed legs, the pointer preview, and its footprint where it would end. */
export function CraftOverlay({ state, plot }: { state: GameState; plot: CraftPlot }) {
  const s = (p: Point) => toSvg(state.table, p);
  const points = [plot.wave.position, ...plot.path];
  const end = points[points.length - 1] ?? plot.wave.position;
  const r = craft.waveRadius(plot.wave);
  const legs = points.slice(1).map((p, i) => {
    const [a, b] = [s(points[i] ?? p), s(p)];
    return <line key={i} className="plot-path" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
  });
  const e = s(end);
  const pv = plot.preview === null ? null : s(plot.preview);
  return (
    <g className="plot craft-plot" pointerEvents="none">
      {legs}
      {pv !== null && <line className="plot-preview ok" x1={e.x} y1={e.y} x2={pv.x} y2={pv.y} />}
      {pv !== null && <circle className="craft-ghost" cx={pv.x} cy={pv.y} r={r} />}
      {plot.path.length > 0 && <circle className="craft-ghost end" cx={e.x} cy={e.y} r={r} />}
    </g>
  );
}
