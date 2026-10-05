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
import { usePlot } from "./plot/usePlot";
import { PlotOverlay } from "./plot/PlotOverlay";
import { FireControls } from "./fire/FireControls";
import { FireOverlay } from "./fire/FireOverlay";
import { liveAim, type Aim } from "./fire/aim";
import { bearingToward, launch, targets } from "./fire/fire";

/** `banner`: anything to show above the controls (online: presence, connection, verification). */
export function GameView({ source, banner }: { source: GameSource; banner?: ReactNode }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [shift, setShift] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [aim, setAim] = useState<Aim | null>(null);
  const [launchBearing, setLaunchBearing] = useState(0);

  const { state, seat, rejection } = source;
  const run = (t: Transform): Promise<boolean> => source.run(t);
  const act = (t: Transform): void => {
    void source.run(t);
  };
  // Online, only one seat's controls belong on this screen (network/SPEC.md §7.2).
  const waiting = waitingOn(state, seat);

  const plot = usePlot(waiting === null ? state : null, pointer, shift, run);

  // Shooting: the weapon being aimed, its targets, and a torpedo bearing that follows the pointer.
  const aimed = waiting !== null ? null : liveAim(state, aim);
  const aimTargets = aimed !== null && aimed.weapon.kind !== "torpedoes" ? targets(state, aimed.ship, aimed.weapon) : [];
  const pointerBearing = aimed !== null && aimed.weapon.kind === "torpedoes" && pointer !== null ? bearingToward(aimed.ship, aimed.weapon, pointer) : null;
  const bearing = pointerBearing ?? launchBearing;
  const fireAt = (id: string) => {
    const t = aimTargets.find((x) => x.id === id);
    const only = t?.options.length === 1 ? t.options[0] : undefined;
    if (only !== undefined) act(only.transform);
  };
  const shooting = (state.clock.step === "direct_fire" || state.clock.step === "launch_ordnance") && state.pending.length === 0;

  // Deployment: the next ship follows the pointer.
  const deploy = useMemo(() => {
    if (state.clock.setupStep !== "deploy") return null;
    const who = actor(state);
    if ((who !== "p1" && who !== "p2") || !controls(seat, who)) return null;
    const ship = state.ships.find((s) => s.owner === who && s.status === "undeployed");
    const zone = state.setup.zones?.[who];
    if (ship === undefined || zone === undefined) return null;
    return { player: who, ship, heading: state.scenario.deploymentFacing[zone] };
  }, [state, seat]);

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
          selectedShipId={selected}
          highlight={aimed !== null ? aimTargets.filter((t) => t.options.length > 0).map((t) => t.id) : highlight}
          onSelectShip={(id) => (aimed !== null ? fireAt(id) : setSelected(id))}
          onSelectSalvo={(id) => aimed !== null && fireAt(id)}
          onPointer={(p, s) => {
            setPointer(p);
            setShift(s);
            if (p !== null && aimed !== null && aimed.weapon.kind === "torpedoes") setLaunchBearing(bearingToward(aimed.ship, aimed.weapon, p));
          }}
          onTableClick={(p, s) => {
            if (deploy !== null) act({ type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(p) });
            else if (plot !== null) plot.click(p, s);
            else if (aimed !== null && aimed.weapon.kind === "torpedoes") act(launch(aimed.ship, aimed.weapon, bearingToward(aimed.ship, aimed.weapon, p)));
          }}
        >
          {plot !== null && <PlotOverlay state={state} plot={plot} />}
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
            <SetupControls state={state} seat={seat} onApply={act} />
          ) : shooting ? (
            <FireControls state={state} aimed={aimed} onAim={setAim} onApply={act} bearing={bearing} />
          ) : state.clock.stage === "battle" ? (
            <StepControls state={state} onApply={act} onHighlight={setHighlight} plot={plot} seat={seat} />
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
        <ShipCards state={state} selectedShipId={selected} onSelect={setSelected} />
        <LogFeed state={state} />
      </aside>
    </main>
  );
}
