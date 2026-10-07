/** The battle: table, controls, ships and log, driven by any GameSource (hot-seat or online). */
import { useMemo, useState, type ReactNode } from "react";
import { activePlayer, actor, engagement, reserves, validate, type GameState, type Point, type Transform } from "@bfg/engine";
import { controls, waitingOn, type GameSource, type Seat } from "./game/source";
import { Table, type Ghost } from "./table/Table";
import type { SetupPreview } from "./table/Zones";
import { mm } from "./table/view";
import { ShipCards } from "./panels/ShipCards";
import { Result } from "./panels/Result";
import { LogFeed } from "./panels/LogFeed";
import { Console } from "./panels/Console";
import { SetupControls } from "./panels/SetupControls";
import { BracePrompt } from "./controls/BracePrompt";
import { StepControls } from "./controls/StepControls";
import { TurnBanner } from "./controls/TurnBanner";
import { Waiting } from "./controls/Waiting";
import { movableShips, usePlot } from "./plot/usePlot";
import { pick, undeployed } from "./game/pick";
import { DEFAULT_AIM, deployAt, deployHeading as headingAt, type DeployAim } from "./game/deploy";
import { PlotOverlay } from "./plot/PlotOverlay";
import { FireControls } from "./fire/FireControls";
import { FireOverlay } from "./fire/FireOverlay";
import { liveAim, type Aim } from "./fire/aim";
import { bearingToward, launch, novaShot, novaTargets, targets } from "./fire/fire";
import { useCraftPlot } from "./craft/useCraftPlot";
import { CraftOverlay } from "./craft/CraftOverlay";
import { movableWaves } from "./craft/craft";
import { arrivalAt, reserveUnits } from "./reserves/arrival";
import { ReinforcementControls } from "./reserves/ReinforcementControls";

const REROLLABLE = new Set<Transform["type"]>(["declare_order", "fire", "move", "answer_brace"]);

/** The re-roll switch, shown while the side about to act has a fleet commander re-roll left. */
function RerollToggle({ state, seat, on, onChange }: { state: GameState; seat: Seat; on: boolean; onChange: (on: boolean) => void }) {
  const who = actor(state);
  if ((who !== "p1" && who !== "p2") || !controls(seat, who)) return null;
  const left = state.ships.filter((s) => s.owner === who && s.status === "active").reduce((n, s) => n + (s.commander?.rerolls ?? 0), 0);
  if (left === 0) return null;
  return (
    <label className="check reroll-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Re-roll failed checks with fleet commander re-rolls ({left} left)
    </label>
  );
}

/** `banner`: anything to show above the controls (online: presence, connection, verification). */
export function GameView({ source, banner }: { source: GameSource; banner?: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  /** The ship picked to deploy or move next (several ships a side). */
  const [focus, setFocus] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [shift, setShift] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [aim, setAim] = useState<Aim | null>(null);
  const [launchBearing, setLaunchBearing] = useState(0);
  /** Where the nova cannon's template was last under the pointer. */
  const [novaPoint, setNovaPoint] = useState<Point | null>(null);
  /** The attack craft wave picked to fly next. */
  const [waveFocus, setWaveFocus] = useState<string | null>(null);

  const { state, seat, rejection } = source;
  /** Fleet commander re-rolls (transform §2.7): asked for up front, on every check that can take one, while this is on. */
  const [useRerolls, setUseRerolls] = useState(true);
  const withReroll = (t: Transform): Transform => {
    if (!useRerolls || !REROLLABLE.has(t.type) || ("reroll" in t && t.reroll !== undefined)) return t;
    const asked = { ...t, reroll: true } as Transform;
    return validate(state, asked).ok ? asked : t;
  };
  const run = (t: Transform): Promise<boolean> => source.run(withReroll(t));
  const act = (t: Transform): void => {
    void source.run(withReroll(t));
  };
  // Online, only one seat's controls belong on this screen (network/SPEC.md §7.2).
  const waiting = waitingOn(state, seat);

  const plot = usePlot(waiting === null ? state : null, pointer, shift, run, focus);
  const craftPlot = useCraftPlot(waiting === null ? state : null, pointer, waveFocus);

  // Shooting: the weapon being aimed, its targets, and a torpedo bearing that follows the pointer.
  const aimed = waiting !== null ? null : liveAim(state, aim);
  const direct = aimed !== null && (aimed.weapon.kind === "battery" || aimed.weapon.kind === "lance");
  const nova = aimed !== null && aimed.weapon.kind === "nova_cannon";
  const aimTargets = aimed !== null && direct ? targets(state, aimed.ship, aimed.weapon) : [];
  const novaAim = nova ? (pointer ?? novaPoint) : null;
  const pointerBearing = aimed !== null && aimed.weapon.kind === "torpedoes" && pointer !== null ? bearingToward(aimed.ship, aimed.weapon, pointer) : null;
  const bearing = pointerBearing ?? launchBearing;
  const fireAt = (id: string) => {
    const t = aimTargets.find((x) => x.id === id);
    // One option fires; so does a combined volley when the battery alone is the only alternative.
    const volley = t?.options.length === 2 && t.options[0]?.transform.combineWith !== undefined ? t.options[0] : undefined;
    const only = t?.options.length === 1 ? t.options[0] : volley;
    if (only !== undefined) act(only.transform);
  };
  const shooting = (state.clock.step === "direct_fire" || state.clock.step === "launch_ordnance") && state.pending.length === 0;

  // Deployment: the next ship follows the pointer.
  const deploy = useMemo(() => {
    if (state.clock.setupStep !== "deploy") return null;
    const who = actor(state);
    if ((who !== "p1" && who !== "p2") || !controls(seat, who)) return null;
    const ship = pick(undeployed(state, who), focus);
    if (ship === undefined || engagement.deploymentDivisions(state, who, ship).length === 0) return null;
    return { player: who, ship };
  }, [state, seat, focus]);
  /** Surprise Attack's defender: the heading for ships on alert, the planet's side for ships on standby (T116). */
  const [deployAim, setDeployAim] = useState<DeployAim>(DEFAULT_AIM);
  // The ghost faces the arrow of the division under the pointer (Fleet Engagement), the zone's facing, or the defender's choice.
  const deployHeading = (p: Point): number => (deploy === null ? 0 : headingAt(state, deploy.player, deploy.ship, p, deployAim));
  // The Bait's reinforcements (transform §4.2): the unit picked to arrive and its facing; a table click brings it on.
  const [arrivalShip, setArrivalShip] = useState<string | null>(null);
  const [arrivalTurn, setArrivalTurn] = useState(0);
  const mover = state.clock.stage === "battle" ? activePlayer(state) : null;
  const arrivals = mover !== null && state.pending.length === 0 && reserves.canArrive(state, mover) ? mover : null;
  const arrivalsHere = arrivals !== null && waiting === null && controls(seat, arrivals);
  const arrivingUnit = arrivalsHere && arrivalShip !== null ? reserveUnits(state, arrivals).find((u) => u.some((s) => s.id === arrivalShip)) : undefined;
  const arrival = arrivingUnit !== undefined && arrivals !== null && pointer !== null ? arrivalAt(state, arrivals, arrivingUnit, pointer, arrivalTurn) : null;

  /** Fleet Engagement: the set-up the chooser is looking at, drawn on the table. */
  const [setupPreview, setSetupPreview] = useState<SetupPreview | null>(null);

  /**
   * Pick a ship (its card, or its glyph on the table). If it's one this player
   * could move next, it becomes the one to plot. From the table, that only
   * happens before a path is started: after that a click on a ship is a waypoint.
   */
  const choose = (id: string, fromTable: boolean): boolean => {
    setSelected(id);
    const candidates = waiting !== null ? [] : deploy !== null ? undeployed(state, deploy.player) : movableShips(state);
    if (!candidates.some((s) => s.id === id)) return false;
    if (fromTable && plot !== null && plot.path.length > 0 && plot.ship.id !== id) return false;
    setFocus(id);
    return true;
  };

  // The ship being deployed or plotted is the one picked out; otherwise whatever was clicked last.
  const highlighted = plot?.ship.id ?? deploy?.ship.id ?? selected;

  let ghost: Ghost | null = null;
  let ghosts: Ghost[] = [];
  if (arrival !== null) {
    const status = validate(state, arrival).ok ? "ok" : "bad";
    ghosts = arrival.placements.map((p) => ({ shipId: p.shipId, position: p.position, heading: p.heading, status }));
  } else if (deploy !== null && pointer !== null) {
    const t = deployAt(state, deploy.player, deploy.ship, mm(pointer), deployAim);
    ghost = { shipId: deploy.ship.id, position: pointer, heading: deployHeading(pointer), status: validate(state, t).ok ? "ok" : "bad" };
  } else if (plot !== null && (plot.path.length > 0 || plot.preview.length > 0)) {
    const v = plot.preview.length > 0 ? plot.previewVerdict : plot.verdict;
    const end = plot.previewStats.end;
    ghost = { shipId: plot.ship.id, position: end.position, heading: end.heading, status: v.kind === "ok" ? "ok" : v.kind === "short" ? "short" : "bad" };
  }

  return (
    <main className="play">
      <section className="board">
        <Table
          state={state}
          ghost={ghost}
          ghosts={ghosts}
          entryFor={arrivals}
          selectedShipId={highlighted}
          setupPreview={state.clock.setupStep === "choose_setup" ? setupPreview : null}
          highlight={
            aimed === null
              ? highlight
              : nova
                ? novaTargets(state, aimed.ship, aimed.weapon).filter((t) => t.shot !== null).map((t) => t.id)
                : aimTargets.filter((t) => t.options.length > 0).map((t) => t.id)
          }
          onSelectShip={(id) => {
            if (aimed === null) return choose(id, true);
            // The nova cannon drops its template on the ship's stem.
            if (nova) {
              const shot = novaTargets(state, aimed.ship, aimed.weapon).find((t) => t.id === id)?.shot;
              if (shot) act(shot);
              return true;
            }
            // A ship under the pointer is a target; for torpedoes the click is a bearing, so let it through.
            fireAt(id);
            return aimed.weapon.kind !== "torpedoes";
          }}
          onSelectSalvo={(id) => {
            if (aimed !== null) {
              fireAt(id);
              return true;
            }
            // One of your own waves to fly: pick it. Anything else is a waypoint.
            if (waiting === null && movableWaves(state).some((w) => w.id === id) && craftPlot?.wave.id !== id) {
              setWaveFocus(id);
              return true;
            }
            return false;
          }}
          onPointer={(p, s) => {
            setPointer(p);
            setShift(s);
            if (p !== null && aimed !== null && aimed.weapon.kind === "torpedoes") setLaunchBearing(bearingToward(aimed.ship, aimed.weapon, p));
            if (p !== null && nova) setNovaPoint(p);
          }}
          onTableClick={(p, s) => {
            if (deploy !== null) act(deployAt(state, deploy.player, deploy.ship, mm(p), deployAim));
            else if (arrivingUnit !== undefined && arrivals !== null) {
              const t = arrivalAt(state, arrivals, arrivingUnit, p, arrivalTurn);
              if (t !== null) void run(t).then((ok) => ok && setArrivalShip(null));
            }
            else if (plot !== null) plot.click(p, s);
            else if (craftPlot !== null) craftPlot.click(p);
            else if (aimed !== null && aimed.weapon.kind === "torpedoes") act(launch(aimed.ship, aimed.weapon, bearingToward(aimed.ship, aimed.weapon, p)));
            else if (aimed !== null && nova && validate(state, novaShot(aimed.ship, aimed.weapon, p)).ok) act(novaShot(aimed.ship, aimed.weapon, p));
          }}
        >
          {plot !== null && <PlotOverlay state={state} plot={plot} />}
          {craftPlot !== null && <CraftOverlay state={state} plot={craftPlot} />}
          {aimed !== null && (
            <FireOverlay state={state} ship={aimed.ship} weapon={aimed.weapon} bearing={aimed.weapon.kind === "torpedoes" ? bearing : null} novaAim={novaAim} />
          )}
        </Table>
      </section>
      <aside className="side">
        <section className="actions">
          {banner}
          <TurnBanner state={state} />
          <RerollToggle state={state} seat={seat} on={useRerolls} onChange={setUseRerolls} />
          {waiting !== null ? (
            <Waiting state={state} player={waiting} />
          ) : state.pending.length > 0 ? (
            <BracePrompt state={state} onApply={act} />
          ) : state.clock.stage === "setup" ? (
            <SetupControls state={state} seat={seat} onApply={act} focus={focus} onFocus={setFocus} onPreview={setSetupPreview} aim={deployAim} onAim={setDeployAim} />
          ) : shooting ? (
            <FireControls state={state} aimed={aimed} onAim={setAim} onApply={act} bearing={bearing} novaAim={novaAim} />
          ) : state.clock.stage === "battle" ? (
            <>
              {arrivalsHere && arrivals !== null && (
                <ReinforcementControls
                  state={state}
                  player={arrivals}
                  chosen={arrivingUnit?.[0]?.id ?? null}
                  onChoose={setArrivalShip}
                  turn={arrivalTurn}
                  onTurn={setArrivalTurn}
                  onApply={act}
                />
              )}
              <StepControls
                state={state}
                onApply={act}
                onHighlight={setHighlight}
                plot={plot}
                seat={seat}
                onFocus={(id) => choose(id, false)}
                craftPlot={craftPlot}
                onFocusWave={setWaveFocus}
              />
            </>
          ) : null}
          <Result state={state} />
          {rejection && (
            <p className="rejection" role="alert">
              {rejection.message}
            </p>
          )}
          <Console state={state} onApply={act} />
        </section>
        <ShipCards state={state} selectedShipId={highlighted} onSelect={(id) => void choose(id, false)} />
        <LogFeed state={state} />
      </aside>
    </main>
  );
}
