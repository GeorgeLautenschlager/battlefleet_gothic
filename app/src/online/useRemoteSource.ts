/**
 * Online play's GameSource (network/SPEC.md §4, §7): a WebSocket to the
 * game's room. The server applies every transform; this only proposes,
 * renders what comes back, and verifies the dice when the game ends.
 */
import { useEffect, useRef, useState } from "react";
import type { FactionId, GameState, PlayerId, Transform } from "@bfg/engine";
import { PROTOCOL, verifyEnded, type Lobby, type Presence, type RoomStatus, type ServerMessage, type ShipEntry, type Verification } from "@bfg/server";
import type { SavedGame } from "../game/history";
import type { GameSource, Notice } from "../game/source";
import { ENGINE_BUILD, socketUrl } from "./config";

export type RemoteConfig = { gameId: string; token: string };

export type Connection = "connecting" | "open" | "offline";

export type Remote = {
  connection: Connection;
  /** A failure retrying won't fix (a bad link, an out-of-date page). */
  fatal: Notice | null;
  seat: PlayerId | null;
  roomStatus: RoomStatus | null;
  lobby: Lobby | null;
  presence: Presence;
  /** Once the game has started. */
  source: GameSource | null;
  /** Once the game is over: the full save, and whether replaying it matches what the server sent. */
  ended: { save: SavedGame; verification: Verification } | null;
  /** The server's last refusal (in the lobby: a join it didn't accept). */
  rejection: Notice | null;
  join(name: string, faction: FactionId, ships: ShipEntry[]): void;
};

type Applied = { seq: number; by: PlayerId; rolled: boolean };
type Pending = { message: { type: "propose" | "undo"; id: string } & Record<string, unknown>; resolve: (ok: boolean) => void };

type Snapshot = {
  /** The game this snapshot belongs to; a different game starts from `initial`. */
  gameId: string | null;
  connection: Connection;
  fatal: Notice | null;
  seat: PlayerId | null;
  roomStatus: RoomStatus | null;
  lobby: Lobby | null;
  presence: Presence;
  state: GameState | null;
  seq: number;
  /** Transforms applied while we've been connected, for the undo rule. */
  applied: Applied[];
  pending: number;
  rejection: Notice | null;
  ended: Remote["ended"];
};

const FATAL = new Set(["UNKNOWN_TOKEN", "PROTOCOL_MISMATCH", "ENGINE_MISMATCH", "TOO_MANY_CONNECTIONS"]);
const OFFLINE: Notice = { code: "OFFLINE", message: "Not connected to the game server." };

const initial: Snapshot = {
  gameId: null,
  connection: "connecting",
  fatal: null,
  seat: null,
  roomStatus: null,
  lobby: null,
  presence: { p1: false, p2: false },
  state: null,
  seq: 0,
  applied: [],
  pending: 0,
  rejection: null,
  ended: null,
};

const newId = (): string => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

export function useRemoteSource(config: RemoteConfig | null): Remote | null {
  const [stored, setStored] = useState<Snapshot>(initial);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());
  /** The server's seq and whether we're welcomed, as the socket handlers last saw them. */
  const seqRef = useRef(0);
  const openRef = useRef(false);
  const gameId = config?.gameId ?? null;
  const token = config?.token ?? null;
  const snap = stored.gameId === gameId ? stored : { ...initial, gameId };

  useEffect(() => {
    if (gameId === null || token === null) return;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let state: GameState | null = null;
    const inFlight = pending.current;
    seqRef.current = 0;
    openRef.current = false;
    /** Update this game's snapshot (a fresh one if it belonged to another game). */
    const setSnap = (f: (s: Snapshot) => Snapshot) => setStored((s) => f(s.gameId === gameId ? s : { ...initial, gameId }));

    const settle = (id: string, ok: boolean) => {
      const p = inFlight.get(id);
      if (p === undefined) return;
      inFlight.delete(id);
      p.resolve(ok);
      setSnap((s) => ({ ...s, pending: inFlight.size }));
    };

    const handle = (m: ServerMessage, sock: WebSocket) => {
      switch (m.type) {
        case "welcome":
          state = m.state;
          seqRef.current = m.seq;
          openRef.current = true;
          setSnap((s) => ({
            ...s,
            connection: "open",
            seat: m.seat,
            roomStatus: m.status,
            lobby: m.lobby,
            presence: m.presence,
            state: m.state,
            seq: m.seq,
            rejection: null, // e.g. a refused join, now fixed: the game has started
            applied: [], // history before this connection is unknown here: nothing to undo yet
          }));
          // Anything still unanswered from before a reconnect goes again with its original id (spec §4.5).
          for (const p of inFlight.values()) sock.send(JSON.stringify(p.message));
          return;
        case "lobby":
          setSnap((s) => ({ ...s, lobby: { seats: m.seats, count: m.count, options: m.options } }));
          return;
        case "presence":
          setSnap((s) => ({ ...s, presence: { p1: m.p1, p2: m.p2 } }));
          return;
        case "applied":
          state = m.state;
          seqRef.current = m.seq;
          setSnap((s) => ({ ...s, state: m.state, seq: m.seq, rejection: null, applied: [...s.applied, { seq: m.seq, by: m.by, rolled: m.rolled }] }));
          settle(m.id, true);
          return;
        case "undone":
          state = m.state;
          seqRef.current = m.seq;
          setSnap((s) => ({ ...s, state: m.state, seq: m.seq, rejection: null, applied: s.applied.filter((a) => a.seq <= m.seq) }));
          // `undone` carries no id: it answers whichever undo we have in flight.
          for (const [id, p] of inFlight) if (p.message.type === "undo") settle(id, true);
          return;
        case "rejected": {
          // Already applied (a resend after a reconnect) counts as accepted.
          const ok = m.reason.code === "ALREADY_APPLIED";
          if (!ok) setSnap((s) => ({ ...s, rejection: m.reason }));
          settle(m.id, ok);
          return;
        }
        case "ended": {
          const save: SavedGame = { format: "bfg-save", version: 1, config: m.config, transforms: m.transforms };
          const verification = state === null ? { ok: false as const, problem: "no final state to check" } : verifyEnded(m, state);
          setSnap((s) => ({ ...s, roomStatus: "ended", ended: { save, verification } }));
          return;
        }
        case "error":
          if (FATAL.has(m.code)) {
            stopped = true;
            openRef.current = false;
            setSnap((s) => ({ ...s, fatal: { code: m.code, message: m.message }, connection: "offline" }));
          }
          return;
        case "pong":
          return;
      }
    };

    const connect = () => {
      const sock = new WebSocket(socketUrl(gameId));
      socket.current = sock;
      setSnap((s) => ({ ...s, connection: s.state === null && s.lobby === null ? "connecting" : s.connection }));
      sock.addEventListener("open", () => {
        attempt = 0;
        sock.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL, engine: ENGINE_BUILD }));
      });
      sock.addEventListener("message", (e) => {
        try {
          handle(JSON.parse(String(e.data)) as ServerMessage, sock);
        } catch {
          // A message we can't read: ignore it; the next full state will resync.
        }
      });
      sock.addEventListener("close", () => {
        if (socket.current === sock) socket.current = null;
        openRef.current = false;
        if (stopped) return;
        setSnap((s) => ({ ...s, connection: "offline" }));
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      });
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
      for (const p of inFlight.values()) p.resolve(false);
      inFlight.clear();
    };
  }, [gameId, token]);

  if (config === null) return null;

  const send = (message: Pending["message"]): Promise<boolean> => {
    const sock = socket.current;
    if (sock === null || sock.readyState !== WebSocket.OPEN || !openRef.current) {
      setStored((s) => ({ ...s, rejection: OFFLINE }));
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      pending.current.set(message.id, { message, resolve });
      setStored((s) => ({ ...s, pending: pending.current.size }));
      sock.send(JSON.stringify(message));
    });
  };

  const { state, seat, seq, applied, connection } = snap;
  const last = applied.at(-1);
  const canUndo = snap.roomStatus === "active" && last !== undefined && last.seq === seq && last.by === seat && !last.rolled;

  const source: GameSource | null =
    state === null || seat === null
      ? null
      : {
          kind: "remote",
          state,
          seat,
          status: connection !== "open" ? "offline" : snap.pending > 0 ? "waiting" : "ready",
          rejection: snap.rejection,
          canUndo,
          run: (t: Transform) => send({ type: "propose", id: newId(), base: seqRef.current, transform: t }),
          undo: () => {
            if (canUndo && last !== undefined) void send({ type: "undo", id: newId(), seq: last.seq });
          },
        };

  return {
    connection,
    fatal: snap.fatal,
    seat,
    roomStatus: snap.roomStatus,
    lobby: snap.lobby,
    presence: snap.presence,
    source,
    ended: snap.ended,
    rejection: snap.rejection,
    join: (name, faction, ships) => {
      socket.current?.send(JSON.stringify({ type: "join", token, name, faction, ships }));
    },
  };
}
