/** The battle: table, controls, ships and log, driven by any GameSource (hot-seat or online). */
import { useMemo, useState, type ReactNode } from "react";
import { actor, validate, type Point, type Transform } from "@bfg/engine";
import { controls, waitingOn, type GameSource } from "./game/source";
import { Table, type Ghost } from "./table/Table";
import { mm } from "./table/view";
import { ShipCards } from "./panels/ShipCards";
import { LogFeed } from "./panels/LogFeed";
import { Console } from "./panels/Console";
import { SetupControls } from "./panels/SetupControls";
import { BracePrompt } from "./controls/BracePrompt";
import { StepControls } from "./controls/StepControls";
import { TurnBanner } from "./controls/TurnBanner";
import { Waiting } from "./controls/Waiting";
import { movableShips, usePlot } from "./plot/usePlot";
import { pick, undeployed } from "./game/pick";
import { PlotOverlay } from "./plot/PlotOverlay";
import { FireControls } from "./fire/FireControls";
import { FireOverlay } from "./fire/FireOverlay";
import { liveAim, type Aim } from "./fire/aim";
import { bearingToward, launch, targets } from "./fire/fire";
import { useCraftPlot } from "./craft/useCraftPlot";
import { CraftOverlay } from "./craft/CraftOverlay";
import { movableWaves } from "./craft/craft";

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
  /** The attack craft wave picked to fly next. */
  const [waveFocus, setWaveFocus] = useState<string | null>(null);

  const { state, seat, rejection } = source;
  const run = (t: Transform): Promise<boolean> => source.run(t);
  const act = (t: Transform): void => {
    void source.run(t);
  };
  // Online, only one seat's controls belong on this screen (network/SPEC.md §7.2).
  const waiting = waitingOn(state, seat);

  const plot = usePlot(waiting === null ? state : null, pointer, shift, run, focus);
  const craftPlot = useCraftPlot(waiting === null ? state : null, pointer, waveFocus);

  // Shooting: the weapon being aimed, its targets, and a torpedo bearing that follows the pointer.
  const aimed = waiting !== null ? null : liveAim(state, aim);
  const aimTargets = aimed !== null && aimed.weapon.kind !== "torpedoes" ? targets(state, aimed.ship, aimed.weapon) : [];
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
    const zone = state.setup.zones?.[who];
    if (ship === undefined || zone === undefined) return null;
    return { player: who, ship, heading: state.scenario.deploymentFacing[zone] };
  }, [state, seat, focus]);

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
  if (deploy !== null && pointer !== null) {
    const t: Transform = { type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(pointer) };
    ghost = { shipId: deploy.ship.id, position: pointer, heading: deploy.heading, status: validate(state, t).ok ? "ok" : "bad" };
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
          selectedShipId={highlighted}
          highlight={aimed !== null ? aimTargets.filter((t) => t.options.length > 0).map((t) => t.id) : highlight}
          onSelectShip={(id) => {
            if (aimed === null) return choose(id, true);
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
          }}
          onTableClick={(p, s) => {
            if (deploy !== null) act({ type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(p) });
            else if (plot !== null) plot.click(p, s);
            else if (craftPlot !== null) craftPlot.click(p);
            else if (aimed !== null && aimed.weapon.kind === "torpedoes") act(launch(aimed.ship, aimed.weapon, bearingToward(aimed.ship, aimed.weapon, p)));
          }}
        >
          {plot !== null && <PlotOverlay state={state} plot={plot} />}
          {craftPlot !== null && <CraftOverlay state={state} plot={craftPlot} />}
          {aimed !== null && <FireOverlay state={state} ship={aimed.ship} weapon={aimed.weapon} bearing={aimed.weapon.kind === "torpedoes" ? bearing : null} />}
        </Table>
      </section>
      <aside className="side">
        <section className="actions">
          {banner}
          <TurnBanner state={state} />
          {waiting !== null ? (
            <Waiting state={state} player={waiting} />
          ) : state.pending.length > 0 ? (
            <BracePrompt state={state} onApply={act} />
          ) : state.clock.stage === "setup" ? (
            <SetupControls state={state} seat={seat} onApply={act} focus={focus} onFocus={setFocus} />
          ) : shooting ? (
            <FireControls state={state} aimed={aimed} onAim={setAim} onApply={act} bearing={bearing} />
          ) : state.clock.stage === "battle" ? (
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
          ) : null}
          {state.result !== null && (
            <p className="result">
              {state.result.winner === null ? "A draw" : `${state.players[state.result.winner].name} wins`} · {state.result.scores.p1}–{state.result.scores.p2}
            </p>
          )}
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
