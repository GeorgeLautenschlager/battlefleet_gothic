import { useRef, useState, type ReactNode } from "react";
import { constants, type GameState, type Point } from "@bfg/engine";
import { ShipGlyph } from "./ShipGlyph";
import { pointerToTable, toSvg, type View } from "./view";

export type Ghost = { shipId: string; position: Point; heading: number; status: "ok" | "short" | "bad" };

type Props = {
  state: GameState;
  /** A ship being placed or plotted, drawn translucent. */
  ghost?: Ghost | null;
  selectedShipId?: string | null;
  /** Blast Markers or salvos to pick out (e.g. while ordering removals). */
  highlight?: string[];
  /** Return true if the click was used up, so it doesn't also count as a table click. */
  onSelectShip?: (id: string) => boolean;
  onSelectSalvo?: (id: string) => void;
  /** `shift`: the Shift key was held. */
  onPointer?: (p: Point | null, shift: boolean) => void;
  onTableClick?: (p: Point, shift: boolean) => void;
  children?: ReactNode;
};

const GRID = 10; // cm

export function Table({ state, ghost = null, selectedShipId = null, highlight = [], onSelectShip, onSelectSalvo, onPointer, onTableClick, children }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const view: View = state.table;
  const { width, height } = view;

  const at = (e: React.PointerEvent | React.MouseEvent): Point | null =>
    svgRef.current === null ? null : pointerToTable(svgRef.current, view, e.clientX, e.clientY);

  const lines: ReactNode[] = [];
  for (let x = GRID; x < width; x += GRID) lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} />);
  for (let y = GRID; y < height; y += GRID) lines.push(<line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} />);

  const showZones = state.clock.stage === "setup";
  const ghostShip = ghost === null ? undefined : state.ships.find((s) => s.id === ghost.shipId);

  return (
    <svg
      ref={svgRef}
      className="table"
      viewBox={`-2 -2 ${width + 4} ${height + 4}`}
      role="img"
      aria-label={`Table, ${width} by ${height} cm`}
      onPointerMove={(e) => {
        const p = at(e);
        setHover(p);
        onPointer?.(p, e.shiftKey);
      }}
      onPointerLeave={() => {
        setHover(null);
        onPointer?.(null, false);
      }}
      onClick={(e) => {
        const p = at(e);
        if (p !== null && onTableClick) onTableClick(p, e.shiftKey);
      }}
    >
      <rect className="space" x={0} y={0} width={width} height={height} />
      <g className="grid">{lines}</g>

      {showZones &&
        (["A", "B"] as const).map((zone) => {
          const r = state.scenario.deploymentZones[zone];
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

      {state.blastMarkers.map((bm) => {
        const p = toSvg(view, bm.position);
        return (
          <circle
            key={bm.id}
            className={highlight.includes(bm.id) ? "blast-marker highlight" : "blast-marker"}
            cx={p.x}
            cy={p.y}
            r={constants.BM_RADIUS}
          />
        );
      })}

      {state.ordnance.map((o) => {
        const p = toSvg(view, o.position);
        return (
          <g
            key={o.id}
            className={`salvo ${o.owner}${highlight.includes(o.id) ? " highlight" : ""}`}
            transform={`translate(${p.x} ${p.y}) rotate(${o.heading})`}
            onClick={onSelectSalvo ? () => onSelectSalvo(o.id) : undefined}
          >
            <line x1={-o.width / 2} y1={0} x2={o.width / 2} y2={0} />
            <path d="M-0.8,-0.4 L0,-2 L0.8,-0.4" />
            <text y={2.6} textAnchor="middle" transform={`rotate(${-o.heading} 0 2.6)`}>
              {o.strength}
            </text>
          </g>
        );
      })}

      {state.ships.map((s) =>
        s.position === null || s.heading === null ? null : (
          <ShipGlyph
            key={s.id}
            ship={{ ...s, position: s.position, heading: s.heading }}
            view={view}
            selected={s.id === selectedShipId}
            targeted={highlight.includes(s.id)}
            {...(onSelectShip ? { onSelect: onSelectShip } : {})}
          />
        ),
      )}

      {ghost !== null && ghostShip !== undefined && (
        <ShipGlyph ship={{ ...ghostShip, position: ghost.position, heading: ghost.heading }} view={view} ghost={ghost.status} />
      )}

      {children}

      {hover !== null && (
        <text className="coords" x={width - 1} y={height - 1} textAnchor="end">
          {hover.x.toFixed(1)}, {hover.y.toFixed(1)} cm
        </text>
      )}
    </svg>
  );
}
