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
  const boarding = state.turnState.ships[ship.id]?.boardingDeclared ?? null;
  const cap = state.ordnance.filter((o) => o.kind === "attack_craft" && o.cap === ship.id).length;
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
        {ship.loaded.launchBays !== undefined && <span>{ship.loaded.launchBays ? "Bays ready" : "Bays spent"}</span>}
        {cap > 0 && <span>CAP {cap}</span>}
      </div>
      {status !== "" && <div className="status">{status}</div>}
      {ship.specialOrder !== null && <div className="order">{words(ship.specialOrder.kind)}</div>}
      {ship.grapple !== null && <div className="status">Grappled with {grappledWith(state, ship).join(", ")}</div>}
      {boarding !== null && ship.grapple === null && <div className="status">Boarding {nameOf(state, boarding)}</div>}
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

const nameOf = (state: GameState, id: string): string => state.ships.find((s) => s.id === id)?.name ?? id;

/** The other ships in this ship's grapple. */
function grappledWith(state: GameState, ship: Ship): string[] {
  const g = ship.grapple;
  if (g === null) return [];
  return [g.defenderId, ...g.attackerIds].filter((id) => id !== ship.id).map((id) => nameOf(state, id));
}
