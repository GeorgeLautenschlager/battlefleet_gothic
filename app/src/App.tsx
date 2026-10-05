/**
 * The app shell: the start screen, a hot-seat game (this browser's history),
 * or an online game (a seat in a room on the server). The battle itself is
 * GameView, whichever the source.
 */
import { useEffect, useRef, useState } from "react";
import { cruiserClash, type NewGameOptions } from "./game/config";
import { fromSave, start, toSave, type History, type SavedGame } from "./game/history";
import { autosave, loadAutosave } from "./game/storage";
import type { Notice } from "./game/source";
import { useLocalSource } from "./game/useLocalSource";
import { GameView } from "./GameView";
import { ClockBar } from "./panels/ClockBar";
import { NewGame } from "./panels/NewGame";
import { ONLINE, joinFromHash } from "./online/config";
import { forgetMyGame, loadMyGames, saveMyGame, type MyGame } from "./online/myGames";
import { useRemoteSource } from "./online/useRemoteSource";
import { OnlineStart } from "./online/OnlineStart";
import { MyGames } from "./online/MyGames";
import { Lobby } from "./online/Lobby";
import { OnlineBanner } from "./online/OnlineBanner";

type Mode = { kind: "menu" } | { kind: "local" } | { kind: "online"; game: MyGame };

/** On load: an invite link wins, then a hot-seat game in progress, then the menu. */
function initialMode(history: History | null): Mode {
  const join = ONLINE ? joinFromHash(window.location.hash) : null;
  if (join !== null) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const known = loadMyGames().find((g) => g.gameId === join.gameId && g.token === join.token);
    const game: MyGame = known ?? { gameId: join.gameId, token: join.token, name: "", joinedAt: new Date().toISOString() };
    saveMyGame(game);
    return { kind: "online", game };
  }
  return history !== null ? { kind: "local" } : { kind: "menu" };
}

function download(save: SavedGame, name: string) {
  const blob = new Blob([JSON.stringify(save, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function App() {
  const [history, setHistory] = useState<History | null>(() => loadAutosave());
  const [mode, setMode] = useState<Mode>(() => initialMode(history));
  const [myGames, setMyGames] = useState<MyGame[]>(() => loadMyGames());
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    autosave(history);
  }, [history]);

  const local = useLocalSource(history, setHistory);
  const remote = useRemoteSource(mode.kind === "online" ? { gameId: mode.game.gameId, token: mode.game.token } : null);

  // Remember which seat and name an invite link turned out to be.
  const onlineGame = mode.kind === "online" ? mode.game : null;
  const mySeat = remote?.seat ?? null;
  const myName = mySeat !== null ? (remote?.lobby?.seats[mySeat].name ?? null) : null;
  useEffect(() => {
    if (onlineGame === null || mySeat === null) return;
    if (onlineGame.seat === mySeat && (myName === null || onlineGame.name === myName)) return;
    saveMyGame({ ...onlineGame, seat: mySeat, name: myName ?? onlineGame.name });
  }, [onlineGame, mySeat, myName]);

  const toMenu = () => {
    setMyGames(loadMyGames());
    setMode({ kind: "menu" });
  };

  const source = mode.kind === "local" ? local : mode.kind === "online" ? (remote?.source ?? null) : null;

  const startLocal = (o: NewGameOptions) => {
    setHistory(start(cruiserClash(o)));
    setMode({ kind: "local" });
    setNotice(null);
  };

  const openOnline = (game: MyGame) => {
    setMyGames(saveMyGame(game));
    setMode({ kind: "online", game });
    setNotice(null);
  };

  const exportGame = () => {
    if (mode.kind === "local" && history !== null) download(toSave(history), `bfg-${history.config.createdAt.slice(0, 10)}.json`);
    if (mode.kind === "online" && remote?.ended) download(remote.ended.save, `bfg-online-${mode.game.gameId}.json`);
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
    setMode({ kind: "local" });
    setNotice(null);
  };

  const canExport = (mode.kind === "local" && history !== null) || (mode.kind === "online" && remote?.ended != null);

  let body;
  if (mode.kind === "menu") {
    body = (
      <main className="center menu">
        <NewGame onStart={startLocal} {...(history !== null ? { onCancel: () => setMode({ kind: "local" }), cancelLabel: "Back to the hot-seat game" } : {})} />
        {ONLINE && <OnlineStart onCreated={openOnline} />}
        {ONLINE && <MyGames games={myGames} onResume={openOnline} onForget={(id) => setMyGames(forgetMyGame(id))} />}
        {notice && <p className="rejection">{notice.message}</p>}
      </main>
    );
  } else if (mode.kind === "online" && remote !== null && remote.source === null) {
    body = (
      <main className="center">
        {remote.fatal !== null ? (
          <section className="new-game">
            <h2>Can't open this game</h2>
            <p className="rejection">{remote.fatal.message}</p>
            {remote.fatal.code === "ENGINE_MISMATCH" || remote.fatal.code === "PROTOCOL_MISMATCH" ? (
              <button type="button" className="primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            ) : null}
          </section>
        ) : remote.roomStatus === "lobby" ? (
          <Lobby remote={remote} game={mode.game} />
        ) : (
          <p className="muted center-note">{remote.connection === "offline" ? "Can't reach the game server; retrying…" : "Connecting…"}</p>
        )}
      </main>
    );
  } else if (source !== null) {
    body = <GameView source={source} banner={mode.kind === "online" && remote !== null ? <OnlineBanner remote={remote} state={source.state} /> : undefined} />;
  } else {
    body = null;
  }

  return (
    <div className="app">
      <header>
        <h1>Battlefleet Gothic</h1>
        {source !== null && <ClockBar state={source.state} />}
        <nav className="buttons">
          {source !== null && (
            <button type="button" disabled={!source.canUndo} onClick={source.undo} title={mode.kind === "online" ? "Undo your last move, if it rolled no dice" : "Undo, back to the last dice roll"}>
              Undo
            </button>
          )}
          {mode.kind !== "menu" && (
            <button type="button" disabled={!canExport} onClick={exportGame} title={mode.kind === "online" ? "Available when the game is over" : undefined}>
              Export
            </button>
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
          {mode.kind !== "menu" && (
            <button type="button" onClick={toMenu}>
              {ONLINE ? "Games" : "New game"}
            </button>
          )}
        </nav>
      </header>
      {body}
    </div>
  );
}
