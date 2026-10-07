import { useState } from "react";
import { activePlayer, isHulk, removableBlastMarkers, validate, type GameState, type Transform } from "@bfg/engine";
import { OrdnanceControls } from "../craft/OrdnanceControls";
import type { CraftPlot } from "../craft/useCraftPlot";
import { capOver } from "../craft/craft";
import { playerName } from "../players";
import { Act } from "./Act";
import { MoveControls, needsToMove } from "./MoveControls";
import type { Plot } from "../plot/usePlot";
import { controls, type Seat } from "../game/source";
import { PriorityList, reconcile } from "./PriorityList";
import { ShipPicker } from "./ShipPicker";
import { BoardingControls } from "./BoardingControls";

const words = (s: string) => s.replaceAll("_", " ");
const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

type Props = {
  state: GameState;
  onApply: (t: Transform) => void;
  onHighlight: (ids: string[]) => void;
  plot?: Plot | null;
  /** The player(s) this screen drives. */
  seat?: Seat;
  /** Pick the ship to move next. */
  onFocus?: (id: string) => void;
  craftPlot?: CraftPlot | null;
  /** Pick the attack craft wave to fly next. */
  onFocusWave?: (id: string) => void;
};

/** What the acting player can do in the current battle step. */
export function StepControls({ state, onApply, onHighlight, plot = null, seat = "both", onFocus = () => {}, craftPlot = null, onFocusWave = () => {} }: Props) {
  const { step } = state.clock;
  const active = activePlayer(state);
  const mine = state.ships.filter((s) => s.owner === active);

  switch (step) {
    case "hulks_drift":
      return (
        <div className="buttons">
          {mine
            .filter((s) => isHulk(s) && state.turnState.ships[s.id]?.drifted !== true)
            .map((s) => (
              <Act key={s.id} state={state} transform={{ type: "drift_hulk", player: active, shipId: s.id }} onApply={onApply} primary>
                Drift {s.name} (4D6 cm)
              </Act>
            ))}
        </div>
      );

    case "move_ships": {
      // A ship with an order declared moves next; otherwise the player picks which.
      const open = state.activation?.shipId;
      const ships = mine.filter((s) => (open === undefined ? needsToMove(state, s) : s.id === open));
      const current = ships.find((s) => s.id === plot?.ship.id) ?? ships[0];
      // Fire ships may go off before or after their move, not halfway (state N121, T153).
      const torches = state.activation === null ? mine.filter((s) => s.status === "active" && s.profile.traits?.fireShip === true) : [];
      // CAP can be released only before any ship moves (p. 82).
      const releases = mine.flatMap((s) =>
        capOver(state, s.id).map((w) => ({ wave: w, ship: s, transform: { type: "release_cap" as const, player: active, ordnanceId: w.id } })),
      );
      return (
        <>
          {releases.some((r) => validate(state, r.transform).ok) && (
            <div className="buttons">
              {releases.map((r) => (
                <Act key={r.wave.id} state={state} transform={r.transform} onApply={onApply}>
                  Release {r.wave.squadrons[0]?.name ?? "fighter"} from CAP over {r.ship.name}
                </Act>
              ))}
            </div>
          )}
          {torches.length > 0 && (
            <div className="buttons detonate">
              {torches.map((s) => (
                <Act key={s.id} state={state} transform={{ type: "detonate", player: active, shipId: s.id }} onApply={onApply}>
                  <span title="D3 fires aboard every ship within 3D6 cm; escorts and ordnance there are destroyed">Detonate {s.name}</span>
                </Act>
              ))}
            </div>
          )}
          <ShipPicker ships={ships} current={current?.id} verb="Move" onPick={onFocus} />
          {current && <MoveControls state={state} ship={current} plot={plot} onApply={onApply} />}
        </>
      );
    }


    case "active_ordnance":
    case "inactive_ordnance":
      return <OrdnanceControls state={state} plot={craftPlot} onApply={onApply} onHighlight={onHighlight} onFocus={onFocusWave} />;

    case "boarding":
      return <BoardingControls state={state} onApply={onApply} />;

    case "damage_control": {
      const needy = state.ships.filter(
        (s) =>
          controls(seat, s.owner) &&
          s.status === "active" &&
          state.turnState.ships[s.id]?.repaired !== true &&
          s.criticals.some((c) => !UNREPAIRABLE.has(c.kind)),
      );
      return (
        <>
          {needy.map((s) => (
            <RepairControls key={s.id} state={state} shipId={s.id} onApply={onApply} />
          ))}
        </>
      );
    }

    case "blast_marker_removal":
      return <BlastMarkerRemoval state={state} onApply={onApply} onHighlight={onHighlight} />;

    default:
      return null;
  }
}

function RepairControls({ state, shipId, onApply }: { state: GameState; shipId: string; onApply: (t: Transform) => void }) {
  const ship = state.ships.find((s) => s.id === shipId);
  const crits = ship?.criticals.filter((c) => !UNREPAIRABLE.has(c.kind)) ?? [];
  const ids = crits.map((c) => c.id);
  const [order, setOrder] = useState<string[]>(ids);
  if (ship === undefined) return null;
  const priority = reconcile(order, ids);
  const labels = Object.fromEntries(crits.map((c) => [c.id, words(c.kind)]));
  return (
    <div className="ship-controls">
      <h3>
        {ship.name} <span className="muted">({playerName(state, ship.owner)})</span>
      </h3>
      <p className="muted small">Each 6 repairs one critical, top of the list first.</p>
      <PriorityList items={labels} order={priority} onChange={setOrder} />
      <Act state={state} transform={{ type: "repair", player: ship.owner, shipId: ship.id, priority }} onApply={onApply} primary>
        Roll repairs
      </Act>
    </div>
  );
}

function BlastMarkerRemoval({ state, onApply, onHighlight }: Props) {
  const ids = removableBlastMarkers(state);
  const [order, setOrder] = useState<string[]>(ids);
  const priority = reconcile(order, ids);
  const labels = Object.fromEntries(
    priority.map((id, i) => {
      const bm = state.blastMarkers.find((b) => b.id === id);
      return [id, bm === undefined ? id : `Marker ${i + 1} at (${Math.round(bm.position.x)}, ${Math.round(bm.position.y)})`];
    }),
  );
  const player = activePlayer(state);
  return (
    <div className="ship-controls">
      <p className="muted small">Roll a D6 and remove that many free-floating Blast Markers, top of the list first. Hover to find one.</p>
      <PriorityList items={labels} order={priority} onChange={setOrder} onHover={(id) => onHighlight(id === null ? [] : [id])} />
      <Act state={state} transform={{ type: "remove_blast_markers", player, priority }} onApply={onApply} primary>
        Roll for removal
      </Act>
    </div>
  );
}
