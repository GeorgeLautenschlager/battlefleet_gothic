import { leadership, maxShields, remainingHits, type GameState, type Ship } from "@bfg/engine";
import { playerClass } from "../players";

const words = (s: string) => s.replaceAll("_", " ");

const STATUS: Record<Ship["status"], string> = {
  undeployed: "Undeployed",
  active: "",
  drifting_hulk: "Drifting hulk",
  blazing_hulk: "Blazing hulk",
  destroyed: "Destroyed",
  disengaged: "Disengaged",
};

export function ShipCards({ state, selectedShipId, onSelect }: { state: GameState; selectedShipId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="ships">
      {state.ships.map((ship) => (
        <ShipCard key={ship.id} ship={ship} state={state} selected={ship.id === selectedShipId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function ShipCard({ ship, state, selected, onSelect }: { ship: Ship; state: GameState; selected: boolean; onSelect: (id: string) => void }) {
  const hits = ship.profile.hits;
  const left = remainingHits(ship);
  const status = STATUS[ship.status];
  return (
    <button type="button" className={`card ${playerClass(ship.owner)} ${selected ? "selected" : ""}`} onClick={() => onSelect(ship.id)}>
      <div className="card-head">
        <strong>{ship.name}</strong>
        <span className="muted">{ship.profile.className}</span>
      </div>
      <div className="hits" aria-label={`${left} of ${hits} hits left`}>
        {Array.from({ length: hits }, (_, i) => (
          <span key={i} className={i < left ? "hit" : "hit lost"} />
        ))}
      </div>
      <div className="stats">
        <span>Ld {ship.leadership ?? "?"}{ship.leadership !== null && leadership(ship) !== ship.leadership ? ` (${leadership(ship)})` : ""}</span>
        <span>Shields {maxShields(ship)}</span>
        <span>Speed {ship.profile.speed}</span>
        {ship.loaded.torpedoes !== undefined && <span>{ship.loaded.torpedoes ? "Torps loaded" : "Torps empty"}</span>}
      </div>
      {status !== "" && <div className="status">{status}</div>}
      {ship.specialOrder !== null && <div className="order">{words(ship.specialOrder.kind)}</div>}
      {ship.criticals.length > 0 && (
        <ul className="crits">
          {ship.criticals.map((c) => (
            <li key={c.id}>{words(c.kind)}</li>
          ))}
        </ul>
      )}
      {state.clock.stage === "battle" && state.turnState.ships[ship.id]?.moved === true && <div className="muted">Moved</div>}
    </button>
  );
}
