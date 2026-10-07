/** The mine or minefield about to be placed, following the pointer (T144–T146). */
import { constants, type GameState, type Point } from "@bfg/engine";
import { fieldAt, type PlaceAim } from "../game/place";
import { toSvg, type View } from "./view";

export function PlacementOverlay({ state, aim, at, ok }: { state: GameState; aim: PlaceAim; at: Point; ok: boolean }) {
  const view: View = state.table;
  const rect = fieldAt(state, aim, at);
  if (rect !== null) {
    const corner = toSvg(view, { x: rect.x, y: rect.y + rect.height });
    return <rect className={`minefield ghost${ok ? "" : " bad"}`} x={corner.x} y={corner.y} width={rect.width} height={rect.height} />;
  }
  const p = toSvg(view, at);
  return (
    <g className={`mine ghost${ok ? "" : " bad"}`} transform={`translate(${p.x} ${p.y})`}>
      <circle r={constants.MINE_RADIUS} />
    </g>
  );
}
