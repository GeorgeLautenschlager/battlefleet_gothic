import { useState } from "react";
import type { NewGameOptions } from "../game/config";

export function NewGame({ onStart, onCancel, cancelLabel = "Cancel" }: { onStart: (o: NewGameOptions) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [o, setO] = useState<NewGameOptions>({ p1Name: "Player 1", p2Name: "Player 2", p1Ship: "Agrippa", p2Ship: "Unclean" });
  const field = (key: keyof NewGameOptions, label: string) => (
    <label>
      {label}
      <input value={String(o[key] ?? "")} onChange={(e) => setO({ ...o, [key]: e.target.value })} required maxLength={40} />
    </label>
  );
  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        onStart(o);
      }}
    >
      <h2>Hot-seat</h2>
      <p className="muted">Cruiser Clash: one Lunar against one Murder, on this device. Pass it over when it says so.</p>
      <fieldset className="p1">
        <legend>Imperial Navy · Lunar class cruiser</legend>
        {field("p1Name", "Admiral")}
        {field("p1Ship", "Ship name")}
      </fieldset>
      <fieldset className="p2">
        <legend>Chaos · Murder class cruiser</legend>
        {field("p2Name", "Warmaster")}
        {field("p2Ship", "Ship name")}
      </fieldset>
      <div className="buttons">
        <button type="submit" className="primary">
          Start
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}
