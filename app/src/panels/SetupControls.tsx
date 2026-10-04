import { actor, type GameState, type Transform } from "@bfg/engine";
import { playerName } from "../players";

const ROLLS = {
  roll_leadership: "Roll Leadership",
  roll_zones: "Roll for deployment zones",
  roll_deploy_order: "Roll off: who deploys first",
  roll_first_turn: "Roll off: who chooses first turn",
} as const;

/** The setup steps: four dice rolls, deployment, and the first-turn choice. */
export function SetupControls({ state, onApply }: { state: GameState; onApply: (t: Transform) => void }) {
  const step = state.clock.setupStep;
  if (step === null) return null;
  if (step === "deploy") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const ship = state.ships.find((s) => s.owner === who && s.status === "undeployed");
    const zone = state.setup.zones?.[who];
    return (
      <p className="hint">
        {playerName(state, who)}: click inside zone {zone} to deploy <strong>{ship?.name}</strong>.
      </p>
    );
  }
  if (step === "choose_first_turn") {
    const chooser = state.setup.firstTurnChooser;
    if (chooser === null) return null;
    return (
      <div className="buttons">
        <p className="hint">{playerName(state, chooser)} chooses:</p>
        <button type="button" onClick={() => onApply({ type: "choose_first_turn", player: chooser, goFirst: true })}>
          Go first
        </button>
        <button type="button" onClick={() => onApply({ type: "choose_first_turn", player: chooser, goFirst: false })}>
          Go second
        </button>
      </div>
    );
  }
  return (
    <div className="buttons">
      <button type="button" className="primary" onClick={() => onApply({ type: step, player: "p1" })}>
        {ROLLS[step]}
      </button>
    </div>
  );
}
