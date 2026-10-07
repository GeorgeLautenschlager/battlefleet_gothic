/**
 * One game's server-side logic (network/SPEC.md §8.2): the lobby, then the
 * authoritative engine. No Cloudflare APIs: messages in, addressed messages
 * out, and `data` to persist. Randomness, hashing and time come in as `Deps`.
 */
import { newGame, reduce, validate, type FactionId, type Forces, type GameConfig, type GameState, type PlanetSize, type PlayerId, type ScenarioId, type Scoring, type Transform } from "@bfg/engine";
import { cleanName, cruiserClash, fleetProblem, hasAttacker } from "./config";
import {
  MAX_MESSAGES_PER_SECOND,
  MAX_NAME_LENGTH,
  MAX_SOCKETS_PER_SEAT,
  PROTOCOL,
  parseClientMessage,
  shipEntry,
  type ErrorCode,
  type Lobby,
  type Presence,
  type Reason,
  type RejectCode,
  type RoomStatus,
  type ServerMessage,
  type RoomOptions,
  type ShipEntry,
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

/** A seat: who holds it, and once they've joined, their name and fleet. */
export type SeatRecord = { tokenHash: string; name: string | null; faction: FactionId | null; ships: ShipEntry[] };

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
  /** Ships a side, set by the host. */
  count: number;
  options: RoomOptions;
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

const CRUISER_CLASH: Forces = { kind: "cruiser_clash" };

const trimShips = (ships: ShipEntry[]): ShipEntry[] => ships.map((s) => ({ ...shipEntry(s), name: s.name.trim() }));

/** The host's fleet sets the number of ships a side. */
/** `boarding`, `carriers`, `scenario`, `forces` and `scoring` are optional: pages from before they existed create Cruiser Clash games without them. */
export type CreateRequest = {
  name: string;
  side: PlayerId;
  faction: FactionId;
  ships: ShipEntry[];
  ramming: boolean;
  boarding?: boolean;
  carriers?: boolean;
  scenario?: ScenarioId;
  fleetLists?: boolean;
  forces?: Forces;
  scoring?: Scoring;
  /** The Bait and The Raiders: the attacker's seat (T93, T100). */
  attacker?: PlayerId;
  /** A planet in the table centre (T107). */
  planet?: PlanetSize;
};
export type Created = { data: RoomData; seat: PlayerId; token: string; inviteToken: string };
export type CreateError = { error: "INVALID_NAME" | "INVALID_SIDE" | "INVALID_FLEET"; message?: string };

/** A new game in its lobby, with the host's seat filled (spec §3, D3). */
export async function createRoom(req: CreateRequest, deps: Deps): Promise<Created | CreateError> {
  if (req.side !== "p1" && req.side !== "p2") return { error: "INVALID_SIDE" };
  const name = cleanName(req.name);
  if (name === null) return { error: "INVALID_NAME" };
  const forces = req.forces ?? CRUISER_CLASH;
  const scenario: ScenarioId =
    req.scenario === "fleet_engagement" || req.scenario === "the_bait" || req.scenario === "raiders" || req.scenario === "surprise_attack" ? req.scenario : "cruiser_clash";
  const fleetLists = req.fleetLists === true && forces.kind === "points"; // points battles only (T58)
  // The Bait, The Raiders and Surprise Attack: the host names the attacker (the pursuers, the raiders, the attackers: T93, T100, T114, D37).
  const attacker: PlayerId | undefined = hasAttacker(scenario) ? (req.attacker === "p1" ? "p1" : "p2") : undefined;
  const problem = fleetProblem(req.faction, req.ships, req.ships.length, req.carriers ?? false, forces, scenario, fleetLists, attacker !== undefined && attacker !== req.side);
  if (problem !== null) return { error: "INVALID_FLEET", message: problem };
  const token = toBase64Url(deps.randomBytes(16));
  const inviteToken = toBase64Url(deps.randomBytes(16));
  const guest: PlayerId = req.side === "p1" ? "p2" : "p1";
  const now = deps.now();
  const seats = {
    [req.side]: { tokenHash: await deps.sha256(token), name, faction: req.faction, ships: trimShips(req.ships) },
    [guest]: { tokenHash: await deps.sha256(inviteToken), name: null, faction: null, ships: [] },
  } as Record<PlayerId, SeatRecord>;
  const data: RoomData = {
    gameId: toBase64Url(deps.randomBytes(12)),
    createdAt: now,
    lastActivity: now,
    endedAt: null,
    status: "lobby",
    seats,
    count: req.ships.length,
    options: {
      ramming: req.ramming,
      boarding: req.boarding ?? false,
      carriers: req.carriers ?? false,
      fleetLists,
      scenario,
      forces,
      // Every scenario but Cruiser Clash is victory points (transform §5).
      scoring: scenario === "cruiser_clash" ? (req.scoring ?? "cruiser_clash") : "victory_points",
      ...(attacker !== undefined ? { attacker } : {}),
      // Surprise Attack's planet comes from the points limit (T114).
      ...(scenario !== "surprise_attack" && (req.planet === "small" || req.planet === "medium" || req.planet === "large") ? { planet: req.planet } : {}),
    },
    config: null,
    transforms: [],
    snapshot: null,
  };
  return { data, seat: req.side, token, inviteToken };
}

/** Older rooms, read as current: protocol 1 rooms (one Lunar vs one Murder, `shipName` per seat), and rooms without a boarding or carriers option. */
export function upgradeRoomData(data: RoomData): RoomData {
  if (typeof data.count === "number") {
    // Rooms from before boarding or carriers existed don't have those options: they stay off.
    const options = data.options as Partial<RoomData["options"]>;
    return {
      ...data,
      options: {
        ramming: options.ramming ?? true,
        boarding: options.boarding ?? false,
        carriers: options.carriers ?? false,
        fleetLists: options.fleetLists ?? false,
        scenario: options.scenario ?? "cruiser_clash",
        forces: options.forces ?? CRUISER_CLASH,
        scoring: options.scoring ?? "cruiser_clash",
      },
    };
  }
  const legacy = (p: PlayerId, seat: SeatRecord & { shipName?: string | null }): SeatRecord => ({
    tokenHash: seat.tokenHash,
    name: seat.name,
    faction: seat.name === null ? null : p === "p1" ? "imperial_navy" : "chaos",
    ships: seat.shipName ? [{ name: seat.shipName, classId: p === "p1" ? "lunar" : "murder" }] : [],
  });
  return { ...data, count: 1, options: { ramming: true, boarding: false, carriers: false, fleetLists: false, scenario: "cruiser_clash", forces: CRUISER_CLASH, scoring: "cruiser_clash" }, seats: { p1: legacy("p1", data.seats.p1), p2: legacy("p2", data.seats.p2) } };
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
        return this.join(conn, seat, msg.token, msg.name, msg.faction, msg.ships);
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

  private async join(conn: string, seat: PlayerId, token: string, rawName: string, faction: FactionId, ships: ShipEntry[]): Promise<Outgoing[]> {
    if ((await this.deps.sha256(token)) !== this.data.seats[seat].tokenHash) {
      return this.fail(conn, "UNKNOWN_TOKEN", "That token isn't this seat's");
    }
    if (this.data.status !== "lobby") return this.reject(conn, "", "ALREADY_STARTED", "The game has already started");
    const name = cleanName(rawName);
    if (name === null) return this.reject(conn, "", "INVALID_NAME", `Names need 1–${MAX_NAME_LENGTH} characters`);
    const { attacker } = this.data.options;
    const problem = fleetProblem(faction, ships, this.data.count, this.data.options.carriers, this.data.options.forces, this.data.options.scenario, this.data.options.fleetLists, attacker !== undefined && attacker !== seat);
    if (problem !== null) return this.reject(conn, "", "INVALID_FLEET", problem);
    const other = this.data.seats[seat === "p1" ? "p2" : "p1"];
    const taken = trimShips(ships).find((s) => other.ships.some((o) => o.name === s.name));
    if (taken !== undefined) return this.reject(conn, "", "INVALID_NAME", `${taken.name} is already a ship in this game`);
    this.data.seats[seat] = { ...this.data.seats[seat], name, faction, ships: trimShips(ships) };
    this.touch();
    const out: Outgoing[] = [{ to: this.seated(), message: { type: "lobby", ...this.lobby() } }];
    if (SEATS.every((p) => this.data.seats[p].name !== null)) out.push(...this.start());
    return out;
  }

  /** Both seats named: the server picks the seed and the game begins (spec §3, §5). */
  private start(): Outgoing[] {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = this.deps.randomBytes(4);
    const seed = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    const fleet = (p: PlayerId) => {
      const s = this.data.seats[p];
      if (s.name === null || s.faction === null) throw new Error(`${p} hasn't joined`);
      return { name: s.name, faction: s.faction, ships: s.ships };
    };
    const config = cruiserClash({ p1: fleet("p1"), p2: fleet("p2") }, seed, new Date(this.deps.now()).toISOString(), this.data.options);
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
    const seat = (p: PlayerId) => {
      const s = this.data.seats[p];
      return { name: s.name, faction: s.faction, ships: s.ships, joined: s.name !== null };
    };
    return { seats: { p1: seat("p1"), p2: seat("p2") }, count: this.data.count, options: this.data.options };
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
