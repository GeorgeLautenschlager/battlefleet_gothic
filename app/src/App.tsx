import { useEffect, useMemo, useRef, useState } from "react";
import { actor, validate, type Point, type Reason, type Transform } from "@bfg/engine";
import { controls, waitingOn } from "./game/source";
import { useLocalSource } from "./game/useLocalSource";
import { Waiting } from "./controls/Waiting";
import { cruiserClash, type NewGameOptions } from "./game/config";
import { fromSave, start, toSave, type History } from "./game/history";
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
  const [notice, setNotice] = useState<Reason | null>(null);
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

  const source = useLocalSource(history, setHistory);
  const state = source?.state ?? null;
  const seat = source?.seat ?? "both";
  const rejection = source?.rejection ?? notice;
  const run = (t: Transform): Promise<boolean> => source?.run(t) ?? Promise.resolve(false);
  const act = (t: Transform): void => {
    void run(t);
  };
  // Online, only one seat's controls belong on this screen (spec §7.2).
  const waiting = state === null ? null : waitingOn(state, seat);

  const plot = usePlot(waiting === null ? state : null, pointer, shift, run);

  // Shooting: the weapon being aimed, its targets, and a torpedo bearing that follows the pointer.
  const aimed = state === null || waiting !== null ? null : liveAim(state, aim);
  const aimTargets = state !== null && aimed !== null && aimed.weapon.kind !== "torpedoes" ? targets(state, aimed.ship, aimed.weapon) : [];
  const pointerBearing = aimed !== null && aimed.weapon.kind === "torpedoes" && pointer !== null ? bearingToward(aimed.ship, aimed.weapon, pointer) : null;
  const bearing = pointerBearing ?? launchBearing;
  const fireAt = (id: string) => {
    const t = aimTargets.find((x) => x.id === id);
    const only = t?.options.length === 1 ? t.options[0] : undefined;
    if (only !== undefined) act(only.transform);
  };
  const shooting = state !== null && (state.clock.step === "direct_fire" || state.clock.step === "launch_ordnance") && state.pending.length === 0;

  // Deployment: the next ship follows the pointer.
  const deploy = useMemo(() => {
    if (state === null || state.clock.setupStep !== "deploy") return null;
    const who = actor(state);
    if ((who !== "p1" && who !== "p2") || !controls(seat, who)) return null;
    const ship = state.ships.find((s) => s.owner === who && s.status === "undeployed");
    const zone = state.setup.zones?.[who];
    if (ship === undefined || zone === undefined) return null;
    return { player: who, ship, heading: state.scenario.deploymentFacing[zone] };
  }, [state, seat]);

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
    setNotice(null);
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
      setNotice({ code: "MALFORMED", message: "That file isn't a saved game this version can replay." });
      return;
    }
    setHistory(loaded);
    setChoosing(false);
    setNotice(null);
  };

  return (
    <div className="app">
      <header>
        <h1>Battlefleet Gothic</h1>
        {state !== null && !choosing && <ClockBar state={state} />}
        <nav className="buttons">
          {source !== null && history !== null && !choosing && (
            <>
              <button type="button" disabled={!source.canUndo} onClick={source.undo} title="Undo, back to the last dice roll">
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
      )}
    </div>
  );
}
