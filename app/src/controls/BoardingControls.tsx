import { useState } from "react";
import { activePlayer, boardingsToFight, validate, type BoardingGroup, type GameState, type Transform } from "@bfg/engine";
import { Act } from "./Act";
import { PriorityList, reconcile } from "./PriorityList";

/**
 * The End Phase boarding step (transform spec §4.6): fight each declared
 * boarding action, make any teleport attacks, then finish. Grapples have
 * already fought by themselves on entering the step; the log shows them.
 */
export function BoardingControls({ state, onApply }: { state: GameState; onApply: (t: Transform) => void }) {
  const player = activePlayer(state);
  const groups = boardingsToFight(state);
  const name = (id: string) => state.ships.find((s) => s.id === id)?.name ?? id;
  const mine = state.ships.filter((s) => s.owner === player && s.status === "active");
  const enemies = state.ships.filter((s) => s.owner !== player && s.status === "active");
  const teleports = mine.flatMap((s) =>
    enemies
      .map((e): Transform => ({ type: "teleport", player, shipId: s.id, targetId: e.id }))
      .filter((t) => validate(state, t).ok),
  );
  return (
    <>
      {groups.map((g) => (
        <BoardingFight key={g.targetId} state={state} group={g} onApply={onApply} />
      ))}
      {teleports.length > 0 && (
        <div className="ship-controls">
          <h3>Teleport attacks</h3>
          <p className="muted small">A D6 against a ship whose shields are down: 1 fails, 2–6 is a critical hit of that number. Brace saves on 4+.</p>
          <div className="buttons">
            {teleports.map((t) =>
              t.type === "teleport" ? (
                <Act key={`${t.shipId}-${t.targetId}`} state={state} transform={t} onApply={onApply}>
                  {name(t.shipId)} onto {name(t.targetId)}
                </Act>
              ) : null,
            )}
          </div>
        </div>
      )}
      <div className="buttons">
        <Act state={state} transform={{ type: "end_step", player }} onApply={onApply} showReason={groups.length > 0}>
          Done boarding
        </Act>
      </div>
    </>
  );
}

function BoardingFight({ state, group, onApply }: { state: GameState; group: BoardingGroup; onApply: (t: Transform) => void }) {
  const [together, setTogether] = useState(true);
  const [order, setOrder] = useState<string[]>(group.shipIds);
  const priority = reconcile(order, group.shipIds);
  const name = (id: string) => state.ships.find((s) => s.id === id)?.name ?? id;
  const player = activePlayer(state);
  const several = group.shipIds.length > 1;
  return (
    <div className="ship-controls">
      <h3>Board {name(group.targetId)}</h3>
      {several ? (
        <>
          <div className="picker" role="group" aria-label="How to board">
            <button type="button" aria-pressed={together} className={together ? "selected" : undefined} onClick={() => setTogether(true)}>
              Together
            </button>
            <button type="button" aria-pressed={!together} className={!together ? "selected" : undefined} onClick={() => setTogether(false)}>
              Separately
            </button>
          </div>
          <p className="muted small">
            {together
              ? "One fight on your combined boarding value. If you lose, damage goes to the top ship first."
              : "One fight per ship, top first, each on its own value. Damage to the target carries over."}
          </p>
          <PriorityList items={Object.fromEntries(group.shipIds.map((id) => [id, name(id)]))} order={priority} onChange={setOrder} />
        </>
      ) : (
        <p className="muted small">
          {name(group.shipIds[0] ?? "")} against {name(group.targetId)}: boarding value (hits left, the defender adds its turrets), modifiers, a D6 each.
        </p>
      )}
      <Act state={state} transform={{ type: "board", player, targetId: group.targetId, together, priority }} onApply={onApply} primary>
        Fight
      </Act>
    </div>
  );
}
