import { actor, engagement, type Formation, type GameState, type PlayerId, type Transform } from "@bfg/engine";
import type { SetupPreview } from "../table/Zones";
import { sendAs, type Seat } from "../game/source";
import { pick, undeployed } from "../game/pick";
import { ShipPicker } from "../controls/ShipPicker";
import { playerName } from "../players";

const ROLLS = {
  roll_leadership: "Roll Leadership",
  roll_zones: "Roll for deployment zones",
  roll_deploy_order: "Roll off: who deploys first",
  roll_setup: "Roll off: who picks the set-up",
  roll_first_turn: "Roll off: who chooses first turn",
} as const;

const FORMATIONS: { id: Formation; name: string; blurb: string }[] = [
  { id: "sphere", name: "Sphere", blurb: "envelops the enemy; vulnerable to a wedge" },
  { id: "wedge", name: "Wedge", blurb: "packed tight, breaks thin lines; easily surrounded" },
  { id: "cross", name: "Cross", blurb: "a parallel broadside line" },
];
const COLOUR = { white: "white", dark: "dark grey" } as const;
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/**
 * The setup steps: dice rolls, Fleet Engagement's formations and set-up
 * (pp. 142–143), deployment, and the first-turn choice.
 * `focus`: the ship picked to deploy next. `onPreview`: the set-up the chooser is looking at.
 */
const FACINGS = [
  { heading: 0, name: "Face the top edge" },
  { heading: 90, name: "Face the right edge" },
  { heading: 180, name: "Face the bottom edge" },
  { heading: 270, name: "Face the left edge" },
] as const;

export function SetupControls({
  state,
  seat,
  onApply,
  focus,
  onFocus,
  onPreview = () => {},
}: {
  state: GameState;
  seat: Seat;
  onApply: (t: Transform) => void;
  focus: string | null;
  onFocus: (id: string) => void;
  onPreview?: (preview: SetupPreview | null) => void;
}) {
  const step = state.clock.setupStep;
  if (step === null) return null;
  if (step === "choose_formation") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    return (
      <>
        <p className="hint">
          <strong>{playerName(state, who)}</strong>, pick your fleet's formation in secret
          {who === "p1" ? `: ${playerName(state, other(who))}, look away.` : `. ${playerName(state, other(who))} has picked.`}
        </p>
        <div className="buttons formations">
          {FORMATIONS.map((f) => (
            <button key={f.id} type="button" onClick={() => onApply({ type: "choose_formation", player: who, formation: f.id })} title={f.blurb}>
              {f.name}
            </button>
          ))}
        </div>
        <p className="muted small">{FORMATIONS.map((f) => `${f.name}: ${f.blurb}`).join(". ")}.</p>
      </>
    );
  }
  if (step === "choose_facing") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const surprise = state.setup.raid?.surpriseTurns ?? null;
    return (
      <>
        <p className="hint">
          <strong>{playerName(state, who)}</strong>, your fleet is at anchor: pick the table edge every ship faces. The raiders can come from any edge.
        </p>
        <div className="buttons">
          {FACINGS.map((f) => (
            <button key={f.heading} type="button" onClick={() => onApply({ type: "choose_facing", player: who, heading: f.heading })}>
              {f.name}
            </button>
          ))}
        </div>
        {surprise !== null && (
          <p className="muted small">
            Caught napping: your ships take −1 Leadership for the first {surprise} turn{surprise === 1 ? "" : "s"}.
          </p>
        )}
      </>
    );
  }
  if (step === "choose_setup") {
    const chooser = state.setup.engagement?.setupChooser ?? null;
    if (chooser === null) return null;
    const options = engagement.setupOptions(state);
    return (
      <>
        <p className="hint">
          {playerName(state, chooser)} won the roll-off and picks the set-up (hover to see it on the table):
        </p>
        <div className="buttons">
          {options.map((o) => (
            <button
              key={`${o.map}-${o.colours.p1}`}
              type="button"
              onPointerEnter={() => onPreview(o)}
              onPointerLeave={() => onPreview(null)}
              onFocus={() => onPreview(o)}
              onBlur={() => onPreview(null)}
              onClick={() => {
                onPreview(null);
                onApply({ type: "choose_setup", player: chooser, map: o.map, colour: o.colours[chooser] });
              }}
            >
              Map {o.map}, {playerName(state, chooser)} {COLOUR[o.colours[chooser]]}
            </button>
          ))}
        </div>
      </>
    );
  }
  if (step === "deploy") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const waiting = undeployed(state, who);
    const ship = pick(waiting, focus);
    const zone = state.setup.zones?.[who];
    const e = state.setup.engagement;
    const where =
      e !== undefined && e.map !== null && e.colours !== null
        ? `inside one of your ${COLOUR[e.colours[who]]} divisions on map ${e.map} (each needs a ship before any gets a second)`
        : `inside zone ${zone}`;
    return (
      <>
        <p className="hint">
          {playerName(state, who)}: click {where} to deploy <strong>{ship?.name}</strong>.
        </p>
        <ShipPicker ships={waiting} current={ship?.id} verb="Deploy" onPick={onFocus} />
      </>
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
  const e = state.setup.engagement;
  const formations = step === "roll_setup" && e !== undefined && e.formations.p1 !== null && e.formations.p2 !== null ? e.formations : null;
  return (
    <>
      {formations !== null && (
        <p className="hint">
          {playerName(state, "p1")}: {formations.p1}; {playerName(state, "p2")}: {formations.p2}. On offer:{" "}
          {engagement
            .setupOptions(state)
            .map((o) => `map ${o.map} (${playerName(state, "p1")} ${COLOUR[o.colours.p1]})`)
            .join(" or ")}
          .{engagement.isSplit(state) ? " A split: the faster fleet gets +1." : ""}
        </p>
      )}
      <div className="buttons">
        <button type="button" className="primary" onClick={() => onApply({ type: step, player: sendAs(seat) })}>
          {ROLLS[step]}
        </button>
      </div>
    </>
  );
}
