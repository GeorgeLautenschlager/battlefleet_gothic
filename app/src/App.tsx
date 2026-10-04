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

export function App() {
  const [history, setHistory] = useState<History | null>(() => loadAutosave());
  const [choosing, setChoosing] = useState(history === null);
  const [rejection, setRejection] = useState<Reason | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => autosave(history), [history]);

  const state = history === null ? null : current(history);

  const run = (t: Transform) => {
    if (history === null) return;
    const r = apply(history, t);
    if (r.ok) {
      setHistory(r.history);
      setRejection(null);
    } else {
      setRejection(r.reason);
    }
  };

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
    ghost = { shipId: deploy.ship.id, position: pointer, heading: deploy.heading, ok: validate(state, t).ok };
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
              onSelectShip={setSelected}
              onPointer={setPointer}
              onTableClick={(p) => {
                if (deploy !== null) run({ type: "deploy_ship", player: deploy.player, shipId: deploy.ship.id, position: mm(p) });
              }}
            />
          </section>
          <aside className="side">
            <section className="actions">
              {state.clock.stage === "setup" && <SetupControls state={state} onApply={run} />}
              {state.clock.stage === "battle" && <p className="hint">Battle controls arrive in the next PR. Until then, the console below drives the game.</p>}
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
