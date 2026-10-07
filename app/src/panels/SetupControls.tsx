import { useState } from "react";
import { actor, engagement, getSquadron, planetaryDefence, surprise, type Formation, type GameState, type PlayerId, type Transform } from "@bfg/engine";
import { Act } from "../controls/Act";
import { freeHeading, type DeployAim } from "../game/deploy";
import { DEFAULT_PLACE, kindFor, leftToPlace, type PlaceAim } from "../game/place";
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

const THIRD_NAMES = ["left", "centre", "right"] as const;

/** Blockade Run: the third a blockading ship's unit rolled. */
const thirdOf = (state: GameState, ship: { id: string }): number | undefined =>
  state.setup.blockade?.thirds?.[(state.squadrons ?? []).find((sq) => sq.shipIds.includes(ship.id))?.id ?? ship.id];

const HEADING_NAMES: Record<number, string> = { 0: "(up)", 45: "", 90: "(right)", 135: "", 180: "(down)", 225: "", 270: "(left)", 315: "" };

/** Surprise Attack (T115): the defender ticks the D3 ships or squadrons on full alert; the rest go on standby. */
function AlertChoice({ state, player, onApply }: { state: GameState; player: PlayerId; onApply: (t: Transform) => void }) {
  const units = surprise.unitIds(state, player);
  const want = surprise.alertCount(state, player);
  const [chosen, setChosen] = useState<string[]>(units.slice(0, want));
  const name = (id: string) => getSquadron(state, id)?.name ?? state.ships.find((s) => s.id === id)?.name ?? id;
  return (
    <>
      <p className="hint">
        <strong>{playerName(state, player)}</strong>, you're caught at anchor round the planet. Put {want} ship{want === 1 ? "" : "s"} or squadron{want === 1 ? "" : "s"} on full alert; the
        rest are on standby until they pass a Leadership test.
      </p>
      <div className="alert-units">
        {units.map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={chosen.includes(id)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, id] : chosen.filter((c) => c !== id))}
            />{" "}
            {name(id)}
          </label>
        ))}
      </div>
      <Act state={state} transform={{ type: "choose_alert", player, units: units.filter((u) => chosen.includes(u)) }} onApply={onApply} primary showReason>
        Full alert
      </Act>
    </>
  );
}

export function SetupControls({
  state,
  seat,
  onApply,
  focus,
  onFocus,
  onPreview = () => {},
  aim,
  onAim = () => {},
  placeAim = DEFAULT_PLACE,
  onPlaceAim = () => {},
}: {
  state: GameState;
  seat: Seat;
  onApply: (t: Transform) => void;
  focus: string | null;
  onFocus: (id: string) => void;
  onPreview?: (preview: SetupPreview | null) => void;
  /** Surprise Attack's defender: the heading or the planet's side for the next ship (T116). */
  aim?: DeployAim;
  onAim?: (aim: DeployAim) => void;
  /** The planet holder: a mine or the next minefield, and which way round (T144). */
  placeAim?: PlaceAim;
  onPlaceAim?: (aim: PlaceAim) => void;
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
  if (step === "place_defences") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const { mines, fields } = leftToPlace(state);
    const kind = kindFor(state, placeAim);
    const next = fields[0];
    return (
      <>
        <p className="hint">
          <strong>{playerName(state, who)}</strong>, place your defences before the fleets deploy: click the table.{" "}
          {kind === "minefield" && next !== undefined
            ? `This minefield is ${placeAim.turned ? next.height : next.width} × ${placeAim.turned ? next.width : next.height} cm, with an edge within 15 cm of the planet.`
            : "An orbital mine goes in the planet's gravity well (the dashed ring), off the planet itself."}
        </p>
        <p className="muted small">
          Left to place: {mines} orbital mine{mines === 1 ? "" : "s"}
          {fields.length > 0 ? `, ${fields.length} minefield${fields.length === 1 ? "" : "s"} (${fields.map((f) => `${f.width} × ${f.height} cm`).join(", ")})` : ""}.
        </p>
        <div className="buttons" role="group" aria-label="Placing">
          <button type="button" aria-pressed={kind === "minefield"} disabled={fields.length === 0} onClick={() => onPlaceAim({ ...placeAim, kind: "minefield" })}>
            Minefield
          </button>
          <button type="button" aria-pressed={kind === "orbital_mine"} disabled={mines === 0} onClick={() => onPlaceAim({ ...placeAim, kind: "orbital_mine" })}>
            Orbital mine
          </button>
          {kind === "minefield" && (
            <button type="button" aria-pressed={placeAim.turned} onClick={() => onPlaceAim({ ...placeAim, turned: !placeAim.turned })}>
              Turn it
            </button>
          )}
        </div>
      </>
    );
  }
  if (step === "choose_alert") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    return <AlertChoice state={state} player={who} onApply={onApply} />;
  }
  if (step === "deploy") {
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const waiting = undeployed(state, who);
    const ship = pick(waiting, focus);
    if (ship !== undefined && aim !== undefined && freeHeading(state, who, ship)) {
      const standby = ship.standby === true;
      const first = standby && !state.ships.some((s) => s.owner === who && s.standby === true && s.status !== "undeployed");
      return (
        <>
          <p className="hint">
            {playerName(state, who)}: click to deploy <strong>{ship.name}</strong>
            {planetaryDefence(ship)
              ? ", a planetary defence: anywhere in the planet's gravity well (the dashed ring), off the planet itself, facing any way."
              : state.scenario.id === "blockade_run"
              ? `, in its ${THIRD_NAMES[thirdOf(state, ship) ?? 0]} third of the table, at least 60 cm from the runners' edge, facing any way.`
              : standby
              ? `, on standby: anywhere, broadside to the planet${first ? `, and this first one within ${surprise.STANDBY_RANGE} cm of it` : ""}.`
              : ", on full alert: anywhere at least 30 cm from the table edges, facing any way."}
          </p>
          {standby ? (
            <div className="buttons" role="group" aria-label="Planet side">
              {(["starboard", "port"] as const).map((side) => (
                <button key={side} type="button" aria-pressed={aim.planetTo === side} onClick={() => onAim({ ...aim, planetTo: side })}>
                  Planet to {side}
                </button>
              ))}
            </div>
          ) : (
            <label>
              Facing{" "}
              <select value={String(aim.facing)} onChange={(e) => onAim({ ...aim, facing: Number(e.target.value) })}>
                {[0, 45, 90, 135, 180, 225, 270, 315].map((h) => (
                  <option key={h} value={h}>
                    {h}° {HEADING_NAMES[h]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ShipPicker ships={waiting} current={ship.id} verb="Deploy" onPick={onFocus} />
        </>
      );
    }
    const zone = state.setup.zones?.[who];
    const e = state.setup.engagement;
    const where =
      e !== undefined && e.map !== null && e.colours !== null
        ? `inside one of your ${COLOUR[e.colours[who]]} divisions on map ${e.map} (each needs a ship before any gets a second)`
        : state.scenario.id === "blockade_run"
        ? "within 15 cm of the bottom edge (the runners' edge)"
        : zone !== undefined
        ? `inside zone ${zone}`
        : "inside your deployment area";
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
