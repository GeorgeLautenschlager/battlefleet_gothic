import { useRef, useState, type ReactNode } from "react";
import { constants, craft, formation, geometry, planets, type AttackCraftWave, type GameState, type PlayerId, type Point } from "@bfg/engine";
import { capOffset, markerOffset, ROLE_LETTER } from "../craft/craft";
import { EntryEdges, Zones, type SetupPreview } from "./Zones";
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
  /** Fleet Engagement: a set-up being considered, drawn in place of the chosen map. */
  setupPreview?: SetupPreview | null;
  /** The Bait: the player whose reserves may arrive, to draw their entry edges (state §11). */
  entryFor?: PlayerId | null;
  /** More ships being placed at once: a squadron arriving (T94). */
  ghosts?: Ghost[];
  /** Return true if the click was used up, so it doesn't also count as a table click. */
  onSelectShip?: (id: string) => boolean;
  /** A salvo or wave clicked. Return true if the click was used up. */
  onSelectSalvo?: (id: string) => boolean;
  /** `shift`: the Shift key was held. */
  onPointer?: (p: Point | null, shift: boolean) => void;
  onTableClick?: (p: Point, shift: boolean) => void;
  children?: ReactNode;
};

const GRID = 10; // cm

/** Each planet's template, and its gravity well as a dashed ring (pp. 112–113). */
function Planets({ state }: { state: GameState }) {
  const view: View = state.table;
  return (
    <>
      {planets.planets(state).map((p) => {
        const c = toSvg(view, p.position);
        return (
          <g key={p.id} className="planet" data-planet={p.size}>
            <circle className="well" cx={c.x} cy={c.y} r={p.diameter / 2 + p.well} />
            <circle className="template" cx={c.x} cy={c.y} r={p.diameter / 2} />
          </g>
        );
      })}
    </>
  );
}

export function Table({ state, ghost = null, ghosts = [], selectedShipId = null, highlight = [], setupPreview = null, entryFor = null, onSelectShip, onSelectSalvo, onPointer, onTableClick, children }: Props) {
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
      <Planets state={state} />

      <defs>
        <marker id="zone-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      {showZones && <Zones state={state} preview={setupPreview} />}
      {entryFor !== null && <EntryEdges state={state} player={entryFor} />}

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
        if (o.kind === "attack_craft") return null; // drawn above the ships, below
        return (
          <g
            key={o.id}
            className={`salvo ${o.owner}${highlight.includes(o.id) ? " highlight" : ""}`}
            transform={`translate(${p.x} ${p.y}) rotate(${o.heading})`}
            onClick={
              onSelectSalvo
                ? (e) => {
                    if (onSelectSalvo(o.id)) e.stopPropagation();
                  }
                : undefined
            }
          >
            <line x1={-o.width / 2} y1={0} x2={o.width / 2} y2={0} />
            <path d="M-0.8,-0.4 L0,-2 L0.8,-0.4" />
            <text y={2.6} textAnchor="middle" transform={`rotate(${-o.heading} 0 2.6)`}>
              {o.strength}
            </text>
          </g>
        );
      })}

      {(state.squadrons ?? []).flatMap((sq) => {
        // Squadron formation (p. 96): a faint link between members in formation within 15 cm of each other.
        const crew = formation(state, sq);
        return crew.flatMap((a, i) =>
          crew.slice(i + 1).flatMap((b) => {
            if (a.position === null || b.position === null || geometry.distance(a.position, b.position) > constants.FORMATION_RANGE + 0.001) return [];
            const p = toSvg(view, a.position);
            const q = toSvg(view, b.position);
            return [<line key={`formation-${a.id}-${b.id}`} className={`formation ${sq.owner}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />];
          }),
        );
      })}

      {state.ships.flatMap((d) => {
        // Grapples: a line from the defender to each attacker locked with it.
        if (d.grapple === null || d.grapple.defenderId !== d.id || d.position === null) return [];
        const from = toSvg(view, d.position);
        return d.grapple.attackerIds.map((id) => {
          const a = state.ships.find((s) => s.id === id);
          if (a?.position == null) return null;
          const to = toSvg(view, a.position);
          return <line key={`grapple-${d.id}-${id}`} className="grapple" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
        });
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

      {/* Attack craft above the ships, so a wave on its carrier's base (or CAP) stays visible. */}
      {state.ordnance.map((o) => (o.kind === "attack_craft" ? <Wave key={o.id} state={state} wave={o} highlight={highlight.includes(o.id)} onSelect={onSelectSalvo} /> : null))}

      {ghost !== null && ghostShip !== undefined && (
        <ShipGlyph ship={{ ...ghostShip, position: ghost.position, heading: ghost.heading }} view={view} ghost={ghost.status} />
      )}
      {ghosts.map((g) => {
        const ship = state.ships.find((s) => s.id === g.shipId);
        return ship === undefined ? null : <ShipGlyph key={g.shipId} ship={{ ...ship, position: g.position, heading: g.heading }} view={view} ghost={g.status} />;
      })}

      {children}

      {hover !== null && (
        <text className="coords" x={width - 1} y={height - 1} textAnchor="end">
          {hover.x.toFixed(1)}, {hover.y.toFixed(1)} cm
        </text>
      )}
    </svg>
  );
}

/**
 * An attack craft wave: its footprint, and a marker per squadron lettered by
 * role (F fighter, B bomber, A assault boat). CAP fighters ring their ship.
 */
function Wave({ state, wave, highlight, onSelect }: { state: GameState; wave: AttackCraftWave; highlight: boolean; onSelect?: ((id: string) => boolean) | undefined }) {
  const view: View = state.table;
  let at = toSvg(view, wave.position);
  if (wave.cap !== null) {
    const ship = state.ships.find((x) => x.id === wave.cap);
    const ring = state.ordnance.filter((x) => x.kind === "attack_craft" && x.cap === wave.cap);
    const i = ring.findIndex((x) => x.id === wave.id);
    const off = capOffset(i, ring.length, constants.BASE_RADIUS[ship?.profile.baseSize ?? "small"]);
    at = { x: at.x + off.x, y: at.y - off.y };
  }
  const n = wave.squadrons.length;
  return (
    <g
      className={`wave ${wave.owner}${wave.cap !== null ? " cap" : ""}${highlight ? " highlight" : ""}`}
      transform={`translate(${at.x} ${at.y})`}
      data-wave={wave.id}
      onClick={
        onSelect
          ? (e) => {
              if (onSelect(wave.id)) e.stopPropagation();
            }
          : undefined
      }
    >
      {wave.cap === null && <circle className="footprint" r={craft.waveRadius(wave)} />}
      {wave.squadrons.map((sq, i) => {
        const o = markerOffset(i, n);
        return (
          <g key={i} transform={`translate(${o.x} ${-o.y})`}>
            <rect className={`marker ${sq.role}`} x={-0.6} y={-0.6} width={1.2} height={1.2} />
            <text y={0.4} textAnchor="middle">
              {ROLE_LETTER[sq.role]}
            </text>
          </g>
        );
      })}
    </g>
  );
}
