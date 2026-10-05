/**
 * One game's server-side logic (network/SPEC.md §8.2): the lobby, then the
 * authoritative engine. No Cloudflare APIs: messages in, addressed messages
 * out, and `data` to persist. Randomness, hashing and time come in as `Deps`.
 */
import { newGame, reduce, validate, type GameConfig, type GameState, type PlayerId, type Transform } from "@bfg/engine";
import { cruiserClash } from "./config";
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_NAME_LENGTH,
  MAX_SOCKETS_PER_SEAT,
  PROTOCOL,
  parseClientMessage,
  type ErrorCode,
  type Lobby,
  type Presence,
  type Reason,
  type RejectCode,
  type RoomStatus,
  type ServerMessage,
} from "./protocol";
import { redactState } from "./redact";
import { replay } from "./verify";

export type Deps = {
  /** Cryptographically random bytes. */
  randomBytes(n: number): Uint8Array;
  /** Hex SHA-256 of a string. */
  sha256(text: string): Promise<string>;
  /** Milliseconds since the epoch. */
  now(): number;
  /** This server's engine build id. */
  engine: string;
};

export type SeatRecord = { tokenHash: string; name: string | null; shipName: string | null };

export type TransformRecord = {
  /** The seq this transform produced: 1 for the first. */
  seq: number;
  /** The proposer's message id, for idempotency. */
  id: string;
  by: PlayerId;
  transform: Transform;
  rolled: boolean;
  at: number;
};

/** Everything a game persists (spec §8.2). Plain JSON. */
export type RoomData = {
  gameId: string;
  createdAt: number;
  lastActivity: number;
  endedAt: number | null;
  status: RoomStatus;
  seats: Record<PlayerId, SeatRecord>;
  /** Secret until the game ends. */
  config: GameConfig | null;
  transforms: TransformRecord[];
  /** The unredacted state after `transforms`; null in the lobby. */
  snapshot: GameState | null;
};

/** A message for some connections; `close` asks the adapter to close them afterwards. */
export type Outgoing = { to: string[]; message: ServerMessage; close?: true };

const DAY = 24 * 60 * 60 * 1000;
export const IDLE_LIFETIME = 30 * DAY; // D4
export const ENDED_LIFETIME = 7 * DAY; // D4
const SEATS: readonly PlayerId[] = ["p1", "p2"];

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

const cleanName = (s: string): string | null => {
  const t = s.trim();
  return t.length > 0 && t.length <= MAX_NAME_LENGTH ? t : null;
};

export type CreateRequest = { name: string; shipName: string; side: PlayerId };
export type Created = { data: RoomData; seat: PlayerId; token: string; inviteToken: string };

/** A new game in its lobby, with the host's seat filled (spec §3, D3). */
export async function createRoom(req: CreateRequest, deps: Deps): Promise<Created | { error: "INVALID_NAME" | "INVALID_SIDE" }> {
  if (req.side !== "p1" && req.side !== "p2") return { error: "INVALID_SIDE" };
  const name = cleanName(req.name);
  const shipName = cleanName(req.shipName);
  if (name === null || shipName === null) return { error: "INVALID_NAME" };
  const token = toBase64Url(deps.randomBytes(16));
  const inviteToken = toBase64Url(deps.randomBytes(16));
  const guest: PlayerId = req.side === "p1" ? "p2" : "p1";
  const now = deps.now();
  const seats = {
    [req.side]: { tokenHash: await deps.sha256(token), name, shipName },
    [guest]: { tokenHash: await deps.sha256(inviteToken), name: null, shipName: null },
  } as Record<PlayerId, SeatRecord>;
  const data: RoomData = {
    gameId: toBase64Url(deps.randomBytes(12)),
    createdAt: now,
    lastActivity: now,
    endedAt: null,
    status: "lobby",
    seats,
    config: null,
    transforms: [],
    snapshot: null,
  };
  return { data, seat: req.side, token, inviteToken };
}

type Session = { seat: PlayerId | null; recent: number[] };

export class GameRoom {
  private readonly sessions = new Map<string, Session>();

  constructor(
    public data: RoomData,
    private readonly deps: Deps,
  ) {}

  get seq(): number {
    return this.data.transforms.length;
  }

  /** Re-attach a connection after the adapter wakes from hibernation. */
  restore(conn: string, seat: PlayerId | null): void {
    this.sessions.set(conn, { seat, recent: [] });
  }

  /** The seat a connection holds, if it has said hello. */
  seatOf(conn: string): PlayerId | null {
    return this.sessions.get(conn)?.seat ?? null;
  }

  /** When the game should be deleted (spec §8.3). */
  expiresAt(): number {
    return this.data.endedAt !== null ? this.data.endedAt + ENDED_LIFETIME : this.data.lastActivity + IDLE_LIFETIME;
  }

  leave(conn: string): Outgoing[] {
    const session = this.sessions.get(conn);
    this.sessions.delete(conn);
    return session?.seat ? [this.presenceToAll()] : [];
  }

  async receive(conn: string, raw: string): Promise<Outgoing[]> {
    const session = this.sessions.get(conn) ?? { seat: null, recent: [] };
    this.sessions.set(conn, session);

    // Rate limit (spec §9).
    const now = this.deps.now();
    session.recent = session.recent.filter((t) => now - t < 1000);
    session.recent.push(now);
    if (session.recent.length > MAX_MESSAGES_PER_SECOND) return this.fail(conn, "RATE_LIMITED", "Too many messages");

    const msg = parseClientMessage(raw);
    if ("error" in msg) return this.fail(conn, msg.error, "That message isn't one the server understands");
    if (msg.type === "ping") return [{ to: [conn], message: { type: "pong" } }];
    if (msg.type === "hello") return this.hello(conn, session, msg.token, msg.protocol, msg.engine);

    const seat = session.seat;
    if (seat === null) return this.fail(conn, "HELLO_FIRST", "Say hello first");
    switch (msg.type) {
      case "join":
        return this.join(conn, seat, msg.token, msg.name, msg.shipName);
      case "propose":
        return this.propose(conn, seat, msg.id, msg.base, msg.transform);
      case "undo":
        return this.undo(conn, seat, msg.id, msg.seq);
    }
  }

  // --- Handlers

  private async hello(conn: string, session: Session, token: string, protocol: number, engine: string): Promise<Outgoing[]> {
    if (protocol !== PROTOCOL) return this.fail(conn, "PROTOCOL_MISMATCH", "This page is out of date: reload it");
    if (engine !== this.deps.engine) return this.fail(conn, "ENGINE_MISMATCH", "This page's rules are out of date: reload it");
    const hash = await this.deps.sha256(token);
    const seat = SEATS.find((p) => this.data.seats[p].tokenHash === hash);
    if (seat === undefined) return this.fail(conn, "UNKNOWN_TOKEN", "That link isn't a seat in this game");
    const others = [...this.sessions.entries()].filter(([c, s]) => c !== conn && s.seat === seat).length;
    if (others >= MAX_SOCKETS_PER_SEAT) return this.fail(conn, "TOO_MANY_CONNECTIONS", "This seat is open in too many tabs");
    session.seat = seat;
    return [{ to: [conn], message: this.welcome(seat) }, this.presenceToAll()];
  }

  private async join(conn: string, seat: PlayerId, token: string, rawName: string, rawShip: string): Promise<Outgoing[]> {
    if ((await this.deps.sha256(token)) !== this.data.seats[seat].tokenHash) {
      return this.fail(conn, "UNKNOWN_TOKEN", "That token isn't this seat's");
    }
    if (this.data.status !== "lobby") return this.reject(conn, "", "ALREADY_STARTED", "The game has already started");
    const name = cleanName(rawName);
    const shipName = cleanName(rawShip);
    if (name === null || shipName === null) {
      return this.reject(conn, "", "INVALID_NAME", `Names need 1–${MAX_NAME_LENGTH} characters`);
    }
    this.data.seats[seat] = { ...this.data.seats[seat], name, shipName };
    this.touch();
    const out: Outgoing[] = [{ to: this.seated(), message: { type: "lobby", ...this.lobby() } }];
    if (SEATS.every((p) => this.data.seats[p].name !== null)) out.push(...this.start());
    return out;
  }

  /** Both seats named: the server picks the seed and the game begins (spec §3, §5). */
  private start(): Outgoing[] {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = this.deps.randomBytes(4);
    const seed = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    const names = Object.fromEntries(
      SEATS.map((p) => [p, { name: this.data.seats[p].name ?? p, shipName: this.data.seats[p].shipName ?? p }]),
    ) as Record<PlayerId, { name: string; shipName: string }>;
    const config = cruiserClash(names, seed, new Date(this.deps.now()).toISOString());
    this.data.config = config;
    this.data.snapshot = newGame(config);
    this.data.status = "active";
    return this.welcomeAll();
  }

  private propose(conn: string, seat: PlayerId, id: string, base: number, transform: Transform): Outgoing[] {
    const { status } = this.data;
    if (status === "lobby") return this.reject(conn, id, "NOT_STARTED", "The game hasn't started");
    if (status === "ended") return this.reject(conn, id, "GAME_OVER", "The game is over");
    const earlier = this.data.transforms.find((r) => r.id === id && r.by === seat);
    if (earlier !== undefined) {
      return this.reject(conn, id, "ALREADY_APPLIED", `Already applied as #${earlier.seq}`, { seq: earlier.seq });
    }
    if (base !== this.seq) return this.reject(conn, id, "STALE", "The game has moved on: try again", { seq: this.seq });
    if ((transform as { player?: unknown }).player !== seat) {
      return this.reject(conn, id, "NOT_YOUR_SEAT", "That isn't your side's move");
    }
    const before = this.data.snapshot as GameState;
    const verdict = validate(before, transform);
    if (!verdict.ok) return [{ to: [conn], message: { type: "rejected", id, reason: verdict.reason } }];

    let after: GameState;
    try {
      after = reduce(before, transform);
    } catch (e) {
      // An engine bug: refuse this proposal and keep the game as it was.
      return this.reject(conn, id, "ENGINE_ERROR", `The rules engine failed: ${(e as Error).message}`);
    }
    const record: TransformRecord = {
      seq: this.seq + 1,
      id,
      by: seat,
      transform,
      rolled: after.rng.draws !== before.rng.draws,
      at: this.deps.now(),
    };
    this.data.transforms.push(record);
    this.data.snapshot = after;
    this.touch();
    const out: Outgoing[] = [
      {
        to: this.seated(),
        message: { type: "applied", id, seq: record.seq, by: seat, transform, rolled: record.rolled, state: redactState(after) },
      },
    ];
    if (after.clock.stage === "ended") out.push(this.end());
    return out;
  }

  /** Spec §6, W4: only your own latest transform, and only if it rolled no dice. */
  private undo(conn: string, seat: PlayerId, id: string, seq: number): Outgoing[] {
    const { status, transforms, config } = this.data;
    if (status === "lobby") return this.reject(conn, id, "NOT_STARTED", "The game hasn't started");
    if (status === "ended") return this.reject(conn, id, "GAME_OVER", "The game is over");
    const last = transforms.at(-1);
    if (last === undefined || seq !== last.seq) return this.reject(conn, id, "NOT_LATEST", "Only the latest action can be undone");
    if (last.by !== seat) return this.reject(conn, id, "NOT_YOURS", "That was your opponent's action");
    if (last.rolled) return this.reject(conn, id, "ROLLED_DICE", "That action rolled dice: it stands");
    transforms.pop();
    if (config === null) throw new Error("an active game has a config");
    const state = replay(config, transforms.map((r) => r.transform));
    this.data.snapshot = state;
    this.touch();
    return [{ to: this.seated(), message: { type: "undone", seq: this.seq, state: redactState(state) } }];
  }

  /** The game is over: reveal everything (spec §5, W5). */
  private end(): Outgoing {
    const config = this.data.config;
    if (config === null) throw new Error("an ended game has a config");
    this.data.status = "ended";
    this.data.endedAt = this.deps.now();
    return {
      to: this.seated(),
      message: { type: "ended", seed: config.seed, config, transforms: this.data.transforms.map((r) => r.transform) },
    };
  }

  // --- Helpers

  private touch(): void {
    this.data.lastActivity = this.deps.now();
  }

  private seated(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.seat !== null).map(([c]) => c);
  }

  private lobby(): Lobby {
    const seat = (p: PlayerId) => ({ name: this.data.seats[p].name, shipName: this.data.seats[p].shipName, joined: this.data.seats[p].name !== null });
    return { seats: { p1: seat("p1"), p2: seat("p2") } };
  }

  private presence(): Presence {
    const online = (p: PlayerId) => [...this.sessions.values()].some((s) => s.seat === p);
    return { p1: online("p1"), p2: online("p2") };
  }

  private presenceToAll(): Outgoing {
    return { to: this.seated(), message: { type: "presence", ...this.presence() } };
  }

  private welcome(seat: PlayerId): ServerMessage {
    const { snapshot, status } = this.data;
    return {
      type: "welcome",
      seat,
      status,
      seq: this.seq,
      state: snapshot === null ? null : redactState(snapshot),
      lobby: this.lobby(),
      presence: this.presence(),
      engine: this.deps.engine,
    };
  }

  private welcomeAll(): Outgoing[] {
    return [...this.sessions.entries()]
      .filter(([, s]) => s.seat !== null)
      .map(([c, s]) => ({ to: [c], message: this.welcome(s.seat as PlayerId) }));
  }

  private reject(conn: string, id: string, code: RejectCode, message: string, details?: Reason["details"]): Outgoing[] {
    const reason: Reason = details === undefined ? { code, message } : { code, message, details };
    return [{ to: [conn], message: { type: "rejected", id, reason } }];
  }

  private fail(conn: string, code: ErrorCode, message: string): Outgoing[] {
    const wasSeated = this.seatOf(conn) !== null;
    this.sessions.delete(conn);
    const out: Outgoing[] = [{ to: [conn], message: { type: "error", code, message }, close: true }];
    if (wasSeated) out.push(this.presenceToAll());
    return out;
  }
}
