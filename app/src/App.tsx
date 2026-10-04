import { useEffect, useMemo, useRef, useState } from "react";
import { actor, validate, type Point, type Reason, type Transform } from "@bfg/engine";
import { cruiserClash, type NewGameOptions } from "./game/config";
import { apply, canUndo, current, fromSave, start, toSave, undo, type History } from "./game/history";
import { autosave, loadAutosave } from "./game/storage";
import { Table, type Ghost } from "./table/Table";
import { mm } from "./table/view";
import { ClockBar } from "./panels/ClockBar";
import { ShipCards } from "./panels/ShipCards";
import { LogFeed } from "./panels/LogFeed";
import { Console } from "./panels/Console";
import { SetupControls } from "./panels/SetupControls";
import { NewGame } from "./panels/NewGame";
import { BracePrompt } from "./controls/BracePrompt";
import { StepControls } from "./controls/StepControls";
import { TurnBanner } from "./controls/TurnBanner";
import { usePlot } from "./plot/usePlot";
import { PlotOverlay } from "./plot/PlotOverlay";
import { FireControls } from "./fire/FireControls";
import { FireOverlay } from "./fire/FireOverlay";
import { liveAim, type Aim } from "./fire/aim";
import { bearingToward, launch, targets } from "./fire/fire";

export function App() {
  const [history, setHistory] = useState<History | null>(() => loadAutosave());
  const [choosing, setChoosing] = useState(history === null);
  const [rejection, setRejection] = useState<Reason | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [shift, setShift] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [aim, setAim] = useState<Aim | null>(null);
  const [launchBearing, setLaunchBearing] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    autosave(history);
  }, [history]);

  const state = history === null ? null : current(history);

  const run = (t: Transform): boolean => {
    if (history === null) return false;
    const r = apply(history, t);
    if (r.ok) {
      setHistory(r.history);
      setRejection(null);
    } else {
      setRejection(r.reason);
    }
    return r.ok;
  };

  const plot = usePlot(state, pointer, shift, run);

  // Shooting: the weapon being aimed, its targets, and a torpedo bearing that follows the pointer.
  const aimed = state === null ? null : liveAim(state, aim);
  const aimTargets = state !== null && aimed !== null && aimed.weapon.kind !== "torpedoes" ? targets(state, aimed.ship, aimed.weapon) : [];
  const pointerBearing = aimed !== null && aimed.weapon.kind === "torpedoes" && pointer !== null ? bearingToward(aimed.ship, aimed.weapon, pointer) : null;
  const bearing = pointerBearing ?? launchBearing;
  const fireAt = (id: string) => {
    const t = aimTargets.find((x) => x.id === id);
    const only = t?.options.length === 1 ? t.options[0] : undefined;
    if (only !== undefined) run(only.transform);
  };
  const shooting = state !== null && (state.clock.step === "direct_fire" || state.clock.step === "launch_ordnance") && state.pending.length === 0;

  // Deployment: the next ship follows the pointer.
  const deploy = useMemo(() => {
    if (state === null || state.clock.setupStep !== "deploy") return null;
    const who = actor(state);
    if (who !== "p1" && who !== "p2") return null;
    const ship = state.ships.find((s) => s.owner === who && s.status === "undeployed");
    const zone = state.setup.zones?.[who];
    if (ship === undefined || zone === undefined) return null;
    return { player: who, ship, heading: state.scenario.deploymentFacing[zone] };
  }, [state]);

  let ghost: Ghost | null = null;
  if (state !== null && deploy !== null && pointer !== null) {
    const t: Transform = { type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(pointer) };
    ghost = { shipId: deploy.ship.id, position: pointer, heading: deploy.heading, status: validate(state, t).ok ? "ok" : "bad" };
  } else if (plot !== null && (plot.path.length > 0 || plot.preview.length > 0)) {
    const v = plot.preview.length > 0 ? plot.previewVerdict : plot.verdict;
    const end = plot.previewStats.end;
    ghost = { shipId: plot.ship.id, position: end.position, heading: end.heading, status: v.kind === "ok" ? "ok" : v.kind === "short" ? "short" : "bad" };
  }

  const startGame = (o: NewGameOptions) => {
    setHistory(start(cruiserClash(o)));
    setChoosing(false);
    setRejection(null);
  };

  const exportGame = () => {
    if (history === null) return;
    const blob = new Blob([JSON.stringify(toSave(history), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bfg-${history.config.createdAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importGame = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      parsed = null;
    }
    const loaded = fromSave(parsed);
    if (loaded === null) {
      setRejection({ code: "MALFORMED", message: "That file isn't a saved game this version can replay." });
      return;
    }
    setHistory(loaded);
    setChoosing(false);
    setRejection(null);
  };

  return (
    <div className="app">
      <header>
        <h1>Battlefleet Gothic</h1>
        {state !== null && !choosing && <ClockBar state={state} />}
        <nav className="buttons">
          {history !== null && !choosing && (
            <>
              <button type="button" disabled={!canUndo(history)} onClick={() => setHistory(undo(history))} title="Undo, back to the last dice roll">
                Undo
              </button>
              <button type="button" onClick={exportGame}>
                Export
              </button>
            </>
          )}
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importGame(f);
              e.target.value = "";
            }}
          />
          {!choosing && (
            <button type="button" onClick={() => setChoosing(true)}>
              New game
            </button>
          )}
        </nav>
      </header>

      {choosing || state === null ? (
        <main className="center">
          <NewGame onStart={startGame} {...(history !== null ? { onCancel: () => setChoosing(false) } : {})} />
          {rejection && <p className="rejection">{rejection.message}</p>}
        </main>
      ) : (
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
                if (deploy !== null) run({ type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(p) });
                else if (plot !== null) plot.click(p, s);
                else if (aimed !== null && aimed.weapon.kind === "torpedoes") run(launch(aimed.ship, aimed.weapon, bearingToward(aimed.ship, aimed.weapon, p)));
              }}
            >
              {plot !== null && <PlotOverlay state={state} plot={plot} />}
              {aimed !== null && <FireOverlay state={state} ship={aimed.ship} weapon={aimed.weapon} bearing={aimed.weapon.kind === "torpedoes" ? bearing : null} />}
            </Table>
          </section>
          <aside className="side">
            <section className="actions">
              <TurnBanner state={state} />
              {state.pending.length > 0 ? (
                <BracePrompt state={state} onApply={run} />
              ) : state.clock.stage === "setup" ? (
                <SetupControls state={state} onApply={run} />
              ) : shooting ? (
                <FireControls state={state} aimed={aimed} onAim={setAim} onApply={run} bearing={bearing} />
              ) : state.clock.stage === "battle" ? (
                <StepControls state={state} onApply={run} onHighlight={setHighlight} plot={plot} />
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
              <Console state={state} onApply={run} />
            </section>
            <ShipCards state={state} selectedShipId={selected} onSelect={setSelected} />
            <LogFeed state={state} />
          </aside>
        </main>
      )}
    </div>
  );
}
