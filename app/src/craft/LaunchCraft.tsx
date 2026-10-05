import { useState } from "react";
import { craft, craftInPlay, fleetBays, launchCapacity, type CraftRole, type GameState, type Ship, type Transform } from "@bfg/engine";
import { Act } from "../controls/Act";
import { defaultCounts, freeWaves, launchTransform, ROLE_NAMES, waveName, type Counts } from "./craft";

/**
 * A carrier's launch (p. 73): how many squadrons of each kind in one strike
 * wave, fighters on CAP over the carrier, and waves in flight to recall to
 * stay inside the fleet's limit.
 */
export function LaunchCraft({ state, ship, onApply }: { state: GameState; ship: Ship; onApply: (t: Transform) => void }) {
  const capacity = launchCapacity(ship);
  const roles = craft.rolesCarried(ship);
  const [counts, setCounts] = useState<Counts>(() => defaultCounts(ship, capacity));
  const [cap, setCap] = useState(0);
  const [recall, setRecall] = useState<string[]>([]);
  const inFlight = freeWaves(state, ship.owner);
  const recalling = recall.filter((id) => inFlight.some((w) => w.id === id));
  const total = roles.reduce((n, r) => n + counts[r], 0) + cap;
  const inPlay = craftInPlay(state, ship.owner);
  const limit = fleetBays(state, ship.owner);
  const set = (role: CraftRole, n: number) => setCounts({ ...counts, [role]: Math.max(0, n) });

  return (
    <div className="launch-craft">
      <p className="muted small">
        Launch bays: {capacity} squadron{capacity === 1 ? "" : "s"} · fleet {inPlay} of {limit} in play
      </p>
      {roles.map((role) => (
        <Counter key={role} label={`${craft.craftFor(ship, role)?.name ?? role} ${ROLE_NAMES[role]}`} value={counts[role]} onChange={(n) => set(role, n)} max={capacity} />
      ))}
      {roles.includes("fighter") && <Counter label="Fighters on CAP over this ship" value={cap} onChange={(n) => setCap(Math.max(0, n))} max={capacity} />}
      {inFlight.length > 0 && (
        <fieldset className="recall">
          <legend className="muted small">Recall first</legend>
          {inFlight.map((w) => (
            <label key={w.id} className="check">
              <input
                type="checkbox"
                checked={recalling.includes(w.id)}
                onChange={(e) => setRecall(e.target.checked ? [...recalling, w.id] : recalling.filter((id) => id !== w.id))}
              />
              {waveName(state, w)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="buttons">
        <Act state={state} transform={launchTransform(ship, counts, cap, recalling)} onApply={onApply} primary showReason>
          Launch {total} squadron{total === 1 ? "" : "s"}
        </Act>
      </div>
    </div>
  );
}

function Counter({ label, value, onChange, max }: { label: string; value: number; onChange: (n: number) => void; max: number }) {
  return (
    <label className="counter">
      <span>{label}</span>
      <input type="number" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}
