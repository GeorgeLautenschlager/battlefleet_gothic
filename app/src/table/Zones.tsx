import { engagement, geometry, reserves, type GameState, type PlayerId } from "@bfg/engine";
import { playerName } from "../players";
import { toSvg, type View } from "./view";

type Division = ReturnType<typeof engagement.deploymentDivisions>[number];
export type SetupPreview = ReturnType<typeof engagement.setupOptions>[number];

/**
 * Deployment zones during setup. Cruiser Clash: zones A and B. Fleet
 * Engagement: each player's divisions on the chosen map (or on a set-up being
 * considered), with the arrow its ships face (pp. 142–143).
 */
export function Zones({ state, preview = null }: { state: GameState; preview?: SetupPreview | null }) {
  const view: View = state.table;
  const bait = state.scenario.id === "the_bait";
  const raiders = state.scenario.id === "raiders";
  if (state.setup.engagement === undefined && !bait && !raiders) {
    return (
      <>
        {(["A", "B"] as const).map((zone) => {
          const r = state.scenario.deploymentZones?.[zone];
          if (r === undefined) return null;
          const top = toSvg(view, { x: r.x, y: r.y + r.height });
          const owner = state.setup.zones === null ? null : state.setup.zones.p1 === zone ? "p1" : "p2";
          return (
            <g key={zone} className={`zone ${owner ?? ""}`}>
              <rect x={top.x} y={top.y} width={r.width} height={r.height} />
              <text x={top.x + 1.5} y={top.y + 4}>
                Zone {zone}
              </text>
            </g>
          );
        })}
      </>
    );
  }
  const map = preview?.map ?? state.setup.engagement?.map ?? null;
  const pursued = reserves.pursuedPlayer(state);
  const label = (p: PlayerId) =>
    bait ? `${p === pursued ? "The bait" : "Pursuers"} · ${playerName(state, p)}` : raiders ? `At anchor · ${playerName(state, p)}` : `Map ${map} · ${playerName(state, p)}`;
  const divisionsOf = (p: PlayerId): readonly Division[] =>
    preview !== null ? engagement.SETUP_MAPS[preview.map][preview.colours[p]] : engagement.deploymentDivisions(state, p);
  if (map === null && !bait && !raiders) return null;
  return (
    <g className={preview !== null ? "zones preview" : "zones"}>
      {(["p1", "p2"] as const).flatMap((p) =>
        divisionsOf(p).map((d, i) => {
          const r = d.rect;
          const top = toSvg(view, { x: r.x, y: r.y + r.height });
          const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          const v = geometry.headingVector(d.heading);
          const [from, to] = [toSvg(view, c), toSvg(view, { x: c.x + 6 * v.x, y: c.y + 6 * v.y })];
          return (
            <g key={`${p}-${i}`} className={`zone ${p}`}>
              <rect x={top.x} y={top.y} width={r.width} height={r.height} />
              <line className="facing" x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#zone-arrow)" />
              {i === 0 && (
                <text x={top.x + 1.5} y={top.y + 4}>
                  {label(p)}
                </text>
              )}
            </g>
          );
        }),
      )}
    </g>
  );
}

/** Where `player`'s reserves may arrive this turn (state §11): the open stretches of table edge, with an arrow pointing in. */
export function EntryEdges({ state, player }: { state: GameState; player: PlayerId }) {
  const view: View = state.table;
  return (
    <g className={`entry-edges ${player}`}>
      {reserves.entryEdges(state, player).map((e, i) => {
        const [a, b] = [toSvg(view, e.from), toSvg(view, e.to)];
        const mid = { x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2 };
        const v = geometry.headingVector(e.inward);
        const [from, to] = [toSvg(view, mid), toSvg(view, { x: mid.x + 6 * v.x, y: mid.y + 6 * v.y })];
        return (
          <g key={i}>
            <line className="edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <line className="facing" x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#zone-arrow)" />
          </g>
        );
      })}
    </g>
  );
}
