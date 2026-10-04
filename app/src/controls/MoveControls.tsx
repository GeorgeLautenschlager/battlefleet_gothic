import { useState } from "react";
import { isHulk, onTable, validate, type GameState, type OrderKind, type Ship, type Transform } from "@bfg/engine";
import { Act } from "./Act";

const ORDERS: { kind: OrderKind; label: string; help: string }[] = [
  { kind: "all_ahead_full", label: "All Ahead Full", help: "+4D6 cm, no turns, must move the full distance" },
  { kind: "come_to_new_heading", label: "Come To New Heading", help: "Two turns this move" },
  { kind: "burn_retros", label: "Burn Retros", help: "Half speed; may turn without moving first" },
  { kind: "lock_on", label: "Lock On", help: "Re-roll misses; can't turn" },
  { kind: "reload_ordnance", label: "Reload Ordnance", help: "Reload torpedoes" },
];

/** Movement for one ship: special orders, then (until the plotter lands) a straight-ahead move. */
export function MoveControls({ state, ship, onApply }: { state: GameState; ship: Ship; onApply: (t: Transform) => void }) {
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
      <StraightAhead state={state} ship={ship} onApply={onApply} />
    </div>
  );
}

/** A stopgap mover: N cm straight ahead, validated live. The movement plotter replaces it. */
function StraightAhead({ state, ship, onApply }: { state: GameState; ship: Ship; onApply: (t: Transform) => void }) {
  const a = state.activation?.shipId === ship.id ? state.activation : null;
  const [distance, setDistance] = useState<string>("");
  const [disengage, setDisengage] = useState(false);
  const d = Number(distance === "" ? (a?.maxDistance ?? ship.profile.speed) : distance);
  const t: Transform = { type: "move", player: ship.owner, shipId: ship.id, path: [{ kind: "advance", distance: d }], disengage };
  const v = validate(state, t);
  return (
    <form
      className="straight"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.ok) onApply(t);
      }}
    >
      <label>
        Straight ahead
        <input
          type="number"
          min={0}
          step={0.5}
          value={distance}
          placeholder={String(a?.maxDistance ?? ship.profile.speed)}
          onChange={(e) => setDistance(e.target.value)}
          aria-label="Distance in cm"
        />
        cm
      </label>
      <label className="check">
        <input type="checkbox" checked={disengage} onChange={(e) => setDisengage(e.target.checked)} /> Disengage
      </label>
      <button type="submit" className="primary" disabled={!v.ok} title={v.ok ? undefined : v.reason.message}>
        Move
      </button>
      {!v.ok && <small className="muted">{v.reason.message}</small>}
    </form>
  );
}

export const needsToMove = (state: GameState, ship: Ship): boolean =>
  ship.status === "active" && state.turnState.ships[ship.id]?.moved !== true;
