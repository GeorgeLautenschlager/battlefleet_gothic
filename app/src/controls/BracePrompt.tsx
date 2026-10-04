import { commandCheckLd, getShip, type GameState, type PendingDecision, type Transform } from "@bfg/engine";
import { playerClass, playerName } from "../players";
import { Act } from "./Act";

function sourceName(state: GameState, p: PendingDecision): string {
  const { source } = p;
  if (source.kind === "ordnance") {
    const salvo = state.ordnance.find((o) => o.id === source.id);
    const launcher = state.ships.find((s) => s.id === salvo?.launchedBy);
    return salvo === undefined ? "torpedoes" : `${salvo.strength} torpedoes${launcher ? ` from ${launcher.name}` : ""}`;
  }
  const ship = state.ships.find((s) => s.id === source.id);
  if (source.kind === "explosion") return `${ship?.name ?? "a ship"}'s explosion`;
  if (source.id === p.shipId) return "a Blast Marker";
  return ship?.name ?? "the enemy";
}

/** The top pending decision: brace for impact, or take it. */
export function BracePrompt({ state, onApply }: { state: GameState; onApply: (t: Transform) => void }) {
  const p = state.pending.at(-1);
  if (p === undefined) return null;
  const ship = getShip(state, p.shipId);
  const target = commandCheckLd(state, ship);
  return (
    <div className={`prompt ${playerClass(p.player)}`} role="alertdialog" aria-label="Brace for impact?">
      <p>
        <strong>{playerName(state, p.player)}</strong>: {ship.name} is under attack from {sourceName(state, p)}.
      </p>
      <p className="muted">
        Brace for impact? Command check on 2D6 against {target}. If it passes, hits are saved on 4+, but firepower is halved
        and it replaces any other order until the end of your next turn.
      </p>
      <div className="buttons">
        <Act state={state} transform={{ type: "answer_brace", player: p.player, pendingId: p.id, attempt: true }} onApply={onApply} primary>
          Brace
        </Act>
        <Act state={state} transform={{ type: "answer_brace", player: p.player, pendingId: p.id, attempt: false }} onApply={onApply}>
          Take it
        </Act>
      </div>
    </div>
  );
}
