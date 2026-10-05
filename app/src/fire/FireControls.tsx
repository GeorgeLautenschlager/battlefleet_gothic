import { activePlayer, craft, effectiveStrength, weaponDisabled, type GameState, type Ship, type Transform, type Weapon } from "@bfg/engine";
import { LaunchCraft } from "../craft/LaunchCraft";
import { Act } from "../controls/Act";
import { describeBearing, launch, targets } from "./fire";
import type { Aim } from "./aim";

type Props = {
  state: GameState;
  aimed: { ship: Ship; weapon: Weapon } | null;
  onAim: (aim: Aim | null) => void;
  onApply: (t: Transform) => void;
  /** Launch bearing under the pointer (or last seen there). */
  bearing: number;
};

const KINDS = { direct_fire: ["battery", "lance"], launch_ordnance: ["torpedoes"] } as const;

/** Shooting steps: pick a weapon, then a target (direct fire) or a bearing (torpedoes). */
export function FireControls({ state, aimed, onAim, onApply, bearing }: Props) {
  const step = state.clock.step;
  if (step !== "direct_fire" && step !== "launch_ordnance") return null;
  const player = activePlayer(state);
  const ships = state.ships.filter((s) => s.owner === player && s.status === "active");
  // With several ships, those with nothing left to fire this step fold into one line.
  const kinds: readonly Weapon["kind"][] = KINDS[step];
  const launches = (s: Ship) => step === "launch_ordnance" && craft.canLaunchCraft(state, s);
  const ready = ships.filter((s) => s.profile.weapons.some((w) => kinds.includes(w.kind) && available(state, s, w)) || launches(s));
  const done = ships.filter((s) => !ready.includes(s));
  return (
    <>
      {ready.map((ship) => (
        <ShipWeapons key={ship.id} state={state} ship={ship} kinds={kinds} aimed={aimed} onAim={onAim} onApply={onApply} bearing={bearing} />
      ))}
      {done.length > 0 && <p className="muted small">Nothing left to {step === "direct_fire" ? "fire" : "launch"}: {done.map((s) => s.name).join(", ")}</p>}
      <div className="buttons">
        <Act state={state} transform={{ type: "end_step", player }} onApply={onApply}>
          {step === "direct_fire" ? "Done shooting" : "Done launching"}
        </Act>
      </div>
    </>
  );
}

/** Can this weapon still be used this step? */
function available(state: GameState, ship: Ship, w: Weapon): boolean {
  const turn = state.turnState.ships[ship.id];
  if (turn?.disengage === "failed" || turn?.weaponsFired.includes(w.id) === true || weaponDisabled(state, ship, w)) return false;
  return w.kind !== "torpedoes" || ship.loaded.torpedoes === true;
}

function ShipWeapons({
  state,
  ship,
  kinds,
  aimed,
  onAim,
  onApply,
  bearing,
}: Omit<Props, "aimed"> & { ship: Ship; kinds: readonly Weapon["kind"][]; aimed: Props["aimed"] }) {
  const turn = state.turnState.ships[ship.id];
  const weapons = ship.profile.weapons.filter((w) => kinds.includes(w.kind));
  const carrier = state.clock.step === "launch_ordnance" && craft.canLaunchCraft(state, ship);
  const note =
    turn?.disengage === "failed"
      ? "Failed to disengage: can't fire this turn."
      : turn?.priorityTest === "failed"
        ? "Failed its Leadership test: must fire at the nearest target."
        : null;
  return (
    <div className="ship-controls">
      <h3>{ship.name}</h3>
      {note && <p className="muted small">{note}</p>}
      <div className="weapons">
        {weapons.map((w) => {
          const fired = turn?.weaponsFired.includes(w.id) === true;
          const disabled = weaponDisabled(state, ship, w);
          const empty = w.kind === "torpedoes" && ship.loaded.torpedoes !== true;
          const selected = aimed?.weapon.id === w.id && aimed.ship.id === ship.id;
          const status = fired ? "fired" : disabled ? "disabled" : empty ? "reload needed" : null;
          const range = w.kind === "torpedoes" ? `speed ${w.speed} cm` : `${w.range} cm`;
          return (
            <button
              key={w.id}
              type="button"
              className={selected ? "weapon selected" : "weapon"}
              aria-pressed={selected}
              disabled={status !== null}
              onClick={() => onAim(selected ? null : { shipId: ship.id, weaponId: w.id, playerTurn: state.clock.playerTurn, step: state.clock.step ?? "" })}
            >
              <span>{w.name}</span>
              <span className="muted">
                {status ?? `${effectiveStrength(ship, w)} · ${range}`}
              </span>
            </button>
          );
        })}
      </div>
      {carrier && <LaunchCraft key={`${ship.id}/${state.clock.playerTurn}`} state={state} ship={ship} onApply={onApply} />}
      {aimed !== null && aimed.ship.id === ship.id && aimed.weapon.kind !== "torpedoes" && (
        <TargetList state={state} ship={ship} weapon={aimed.weapon} onApply={onApply} />
      )}
      {aimed !== null && aimed.ship.id === ship.id && aimed.weapon.kind === "torpedoes" && (
        <div className="targets">
          <p className="muted small">Point at the table to aim within the {aimed.weapon.arcs.join(" / ")} arc, and click to launch.</p>
          <div className="buttons">
            <Act state={state} transform={launch(ship, aimed.weapon, bearing)} onApply={onApply} primary>
              Launch {describeBearing(bearing)}
            </Act>
            {bearing !== 0 && (
              <Act state={state} transform={launch(ship, aimed.weapon, 0)} onApply={onApply}>
                Launch dead ahead
              </Act>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TargetList({ state, ship, weapon, onApply }: { state: GameState; ship: Ship; weapon: Weapon; onApply: (t: Transform) => void }) {
  const list = targets(state, ship, weapon);
  if (list.length === 0) return <p className="muted small">No enemy on the table.</p>;
  return (
    <ul className="targets">
      {list.map((t) => (
        <li key={t.id}>
          <span>
            {t.name} <span className="muted">{Math.round(t.distance * 10) / 10} cm</span>
          </span>
          {t.options.length > 0 ? (
            <span className="buttons">
              {t.options.map((o) => (
                <button key={o.label} type="button" className="primary" onClick={() => onApply(o.transform)}>
                  {o.label}
                </button>
              ))}
            </span>
          ) : (
            <small className="muted">{t.reason}</small>
          )}
        </li>
      ))}
    </ul>
  );
}
