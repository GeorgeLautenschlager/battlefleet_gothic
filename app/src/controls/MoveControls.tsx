import { isHulk, onTable, type GameState, type OrderKind, type Ship, type Transform } from "@bfg/engine";
import { PlotPanel } from "../plot/PlotPanel";
import type { Plot } from "../plot/usePlot";
import { Act } from "./Act";

const ORDERS: { kind: OrderKind; label: string; help: string }[] = [
  { kind: "all_ahead_full", label: "All Ahead Full", help: "+4D6 cm, no turns, must move the full distance" },
  { kind: "come_to_new_heading", label: "Come To New Heading", help: "Two turns this move" },
  { kind: "burn_retros", label: "Burn Retros", help: "Half speed; may turn without moving first" },
  { kind: "lock_on", label: "Lock On", help: "Re-roll misses; can't turn" },
  { kind: "reload_ordnance", label: "Reload Ordnance", help: "Reload torpedoes" },
];

/** Movement for one ship: special orders, then the plotter. */
export function MoveControls({ state, ship, plot, onApply }: { state: GameState; ship: Ship; plot: Plot | null; onApply: (t: Transform) => void }) {
  const a = state.activation?.shipId === ship.id ? state.activation : null;
  const player = ship.owner;
  const enemies = state.ships.filter((s) => s.owner !== player && onTable(s));

  return (
    <div className="ship-controls">
      <h3>{ship.name}</h3>
      {a === null ? (
        <>
          <div className="orders">
            {ORDERS.map((o) => (
              <Act key={o.kind} state={state} transform={{ type: "declare_order", player, shipId: ship.id, order: o.kind }} onApply={onApply}>
                <span title={o.help}>{o.label}</span>
              </Act>
            ))}
            {state.meta.options.ramming &&
              enemies.map((e) => (
                <Act
                  key={e.id}
                  state={state}
                  transform={{ type: "declare_order", player, shipId: ship.id, order: "all_ahead_full", ramTargetId: e.id }}
                  onApply={onApply}
                >
                  AAF and ram {e.name}
                  {isHulk(e) ? " (hulk)" : ""}
                </Act>
              ))}
          </div>
          <p className="muted small">Orders are optional: a ship can just move.</p>
        </>
      ) : (
        <p className="muted small">
          {a.order === null ? "No order" : a.order.replaceAll("_", " ")}
          {a.aafExtra !== null ? ` (+${a.aafExtra} cm)` : ""}: move {a.minDistance === a.maxDistance ? `exactly ${a.maxDistance}` : `${a.minDistance}–${a.maxDistance}`} cm.
        </p>
      )}
      {plot !== null && plot.ship.id === ship.id && <PlotPanel plot={plot} />}
    </div>
  );
}

export const needsToMove = (state: GameState, ship: Ship): boolean =>
  ship.status === "active" && state.turnState.ships[ship.id]?.moved !== true;
