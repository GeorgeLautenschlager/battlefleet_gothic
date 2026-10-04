import { useState } from "react";
import { activePlayer, actor, isHulk, removableBlastMarkers, type GameState, type Transform } from "@bfg/engine";
import { playerName } from "../players";
import { Act } from "./Act";
import { MoveControls, needsToMove } from "./MoveControls";
import type { Plot } from "../plot/usePlot";
import { PriorityList, reconcile } from "./PriorityList";

const words = (s: string) => s.replaceAll("_", " ");
const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

type Props = {
  state: GameState;
  onApply: (t: Transform) => void;
  onHighlight: (ids: string[]) => void;
  plot?: Plot | null;
};

/** What the acting player can do in the current battle step. */
export function StepControls({ state, onApply, onHighlight, plot = null }: Props) {
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
      const open = state.activation?.shipId;
      const ships = mine.filter((s) => (open === undefined ? needsToMove(state, s) : s.id === open));
      return (
        <>
          {ships.map((s) => (
            <MoveControls key={s.id} state={state} ship={s} plot={plot} onApply={onApply} />
          ))}
        </>
      );
    }


    case "active_ordnance":
    case "inactive_ordnance": {
      const mover = actor(state);
      if (mover !== "p1" && mover !== "p2") return null;
      const salvos = state.ordnance.filter((o) => o.owner === mover && !state.turnState.ordnanceMoved.includes(o.id));
      return (
        <div className="buttons">
          {salvos.map((o) => {
            const from = state.ships.find((s) => s.id === o.launchedBy)?.name ?? "torpedoes";
            return (
              <span key={o.id} onPointerEnter={() => onHighlight([o.id])} onPointerLeave={() => onHighlight([])}>
                <Act state={state} transform={{ type: "move_ordnance", player: mover, ordnanceId: o.id }} onApply={onApply} primary>
                  Move {from}'s torpedoes ({o.strength})
                </Act>
              </span>
            );
          })}
        </div>
      );
    }

    case "damage_control": {
      const needy = state.ships.filter(
        (s) => s.status === "active" && state.turnState.ships[s.id]?.repaired !== true && s.criticals.some((c) => !UNREPAIRABLE.has(c.kind)),
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
