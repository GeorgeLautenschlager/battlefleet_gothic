/**
 * The network protocol (network/SPEC.md §4): every message between a client
 * and a game room. Plain JSON, one `type` per message.
 */
import type { CommanderConfig, FactionId, Forces, GameConfig, GameState, PlanetSize, PlayerId, ScenarioId, Scoring, Transform } from "@bfg/engine";

/** Bumped on any incompatible change to these messages. 2: fleets (several ships a side, any faction). */
export const PROTOCOL = 2;

/** Limits (spec §9). */
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_MESSAGES_PER_SECOND = 20;
export const MAX_SOCKETS_PER_SEAT = 2;
export const MAX_NAME_LENGTH = 40;
/** Cruiser Clash (p. 128): 1–4 cruisers a side. */
export const MAX_SHIPS = 4;
/** Ships a side in a points battle (the app's limit too). */
export const MAX_POINTS_SHIPS = 16;

/** One ship a player brings: its name and its class in the engine catalogue. */
/** `options`: the class's option ids (transform §5, T57); `commander`: aboard, with fleet lists (T60); `squadron`: its squadron's name (T76); `reserve`: The Bait's reinforcements (T93). */
export type ShipEntry = { name: string; classId: string; options?: string[]; commander?: CommanderConfig; squadron?: string; reserve?: boolean };

// --- Client → server (§4.1)

export type Hello = { type: "hello"; token: string; protocol: number; engine: string };
export type Join = { type: "join"; token: string; name: string; faction: FactionId; ships: ShipEntry[] };
export type Propose = { type: "propose"; id: string; base: number; transform: Transform };
export type Undo = { type: "undo"; id: string; seq: number };
export type Ping = { type: "ping" };

export type ClientMessage = Hello | Join | Propose | Undo | Ping;

// --- Server → client (§4.2)

export type SeatInfo = { name: string | null; faction: FactionId | null; ships: ShipEntry[]; joined: boolean };
/**
 * The game's rules. `carriers`: one carrier each over the 185-point cap (p. 129).
 * `scenario`: Cruiser Clash or Fleet Engagement; `forces`: Cruiser Clash or a points battle; `scoring`: Cruiser Clash or victory points (transform §5).
 */
/** `fleetLists`: points battles follow the fleet lists, with commanders (T58). `attacker`: The Bait's pursuers, The Raiders' raiders, Surprise Attack's attackers, Blockade Run's runners (state N47, N56, N72, N81). `planet`: one in the table centre (T107). */
export type RoomOptions = { ramming: boolean; boarding: boolean; carriers: boolean; fleetLists: boolean; scenario: ScenarioId; forces: Forces; scoring: Scoring; attacker?: PlayerId; planet?: PlanetSize; planetHolder?: PlayerId };
/** `count`: ships a side, set by the host (Cruiser Clash; a points battle leaves each side its own); `options`: the game's rules. */
export type Lobby = { seats: Record<PlayerId, SeatInfo>; count: number; options: RoomOptions };
export type Presence = Record<PlayerId, boolean>;
export type RoomStatus = "lobby" | "active" | "ended";

export type Reason = { code: string; message: string; details?: { [key: string]: unknown } };

export type Welcome = {
  type: "welcome";
  seat: PlayerId;
  status: RoomStatus;
  seq: number;
  /** Redacted; null in the lobby. */
  state: GameState | null;
  lobby: Lobby;
  presence: Presence;
  engine: string;
};
export type LobbyMessage = { type: "lobby" } & Lobby;
export type Applied = {
  type: "applied";
  /** The proposer's message id. */
  id: string;
  seq: number;
  by: PlayerId;
  transform: Transform;
  rolled: boolean;
  state: GameState;
};
export type Rejected = { type: "rejected"; id: string; reason: Reason };
export type Undone = { type: "undone"; seq: number; state: GameState };
export type PresenceMessage = { type: "presence" } & Presence;
export type Ended = { type: "ended"; seed: number; config: GameConfig; transforms: Transform[] };
export type ErrorMessage = { type: "error"; code: ErrorCode; message: string };
export type Pong = { type: "pong" };

export type ServerMessage = Welcome | LobbyMessage | Applied | Rejected | Undone | PresenceMessage | Ended | ErrorMessage | Pong;

/** Protocol failures: the server sends `error` and closes the socket. */
export type ErrorCode =
  | "MALFORMED_MESSAGE"
  | "MESSAGE_TOO_LARGE"
  | "RATE_LIMITED"
  | "HELLO_FIRST"
  | "UNKNOWN_TOKEN"
  | "PROTOCOL_MISMATCH"
  | "ENGINE_MISMATCH"
  | "TOO_MANY_CONNECTIONS";

/** Rejections of one proposal or undo; the socket stays open. Validator codes pass through as well. */
export type RejectCode =
  | "NOT_STARTED"
  | "GAME_OVER"
  | "STALE"
  | "NOT_YOUR_SEAT"
  | "ALREADY_APPLIED"
  | "NOT_LATEST"
  | "NOT_YOURS"
  | "ROLLED_DICE"
  | "ALREADY_STARTED"
  | "INVALID_NAME"
  | "INVALID_FLEET"
  | "ENGINE_ERROR";

// --- Shape checks. Transforms themselves are checked by the engine's validator (G1, MALFORMED).

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A list of ships, shape only: names and classes are checked by the room. */
/** Just the fields a ship entry has. */
export const shipEntry = (s: ShipEntry): ShipEntry => ({
  name: s.name,
  classId: s.classId,
  ...(s.options !== undefined ? { options: [...s.options] } : {}),
  ...(s.commander !== undefined ? { commander: JSON.parse(JSON.stringify(s.commander)) as CommanderConfig } : {}),
  ...(s.squadron !== undefined ? { squadron: s.squadron } : {}),
  ...(s.reserve === true ? { reserve: true } : {}),
});

const MARKS = ["slaanesh", "khorne", "tzeentch", "nurgle"];
const isMark = (v: unknown): boolean => typeof v === "string" && MARKS.includes(v);

/** A commander's shape (the engine checks the rules). */
function isCommander(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (v["kind"] === "admiral") return [8, 9, 10].includes(v["leadership"] as number) && [0, 1, 2, 3].includes(v["extraRerolls"] as number);
  if (v["kind"] === "warmaster") return [8, 9].includes(v["leadership"] as number) && Array.isArray(v["marks"]) && v["marks"].length <= 4 && v["marks"].every(isMark);
  if (v["kind"] === "lord") return v["mark"] === null || isMark(v["mark"]);
  return false;
}

export function isShipList(v: unknown): v is ShipEntry[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_POINTS_SHIPS &&
    v.every(
      (s) =>
        isObject(s) &&
        isString(s["name"]) &&
        isString(s["classId"], 40) &&
        (s["options"] === undefined || (Array.isArray(s["options"]) && s["options"].length <= 8 && s["options"].every((o) => isString(o, 40)))) &&
        (s["commander"] === undefined || isCommander(s["commander"])) &&
        (s["squadron"] === undefined || isString(s["squadron"], 30)) &&
        (s["reserve"] === undefined || typeof s["reserve"] === "boolean"),
    )
  );
}

/** Parse one raw client message, or say why not. */
export function parseClientMessage(raw: string): ClientMessage | { error: ErrorCode } {
  if (raw.length > MAX_MESSAGE_BYTES) return { error: "MESSAGE_TOO_LARGE" };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { error: "MALFORMED_MESSAGE" };
  }
  if (!isObject(v)) return { error: "MALFORMED_MESSAGE" };
  switch (v["type"]) {
    case "hello":
      return isString(v["token"]) && typeof v["protocol"] === "number" && isString(v["engine"])
        ? { type: "hello", token: v["token"], protocol: v["protocol"], engine: v["engine"] }
        : { error: "MALFORMED_MESSAGE" };
    case "join":
      return isString(v["token"]) && isString(v["name"]) && isString(v["faction"], 40) && isShipList(v["ships"])
        ? {
            type: "join",
            token: v["token"],
            name: v["name"],
            faction: v["faction"] as FactionId,
            ships: v["ships"].map(shipEntry),
          }
        : { error: "MALFORMED_MESSAGE" };
    case "propose":
      return isString(v["id"], 64) && isCount(v["base"]) && isObject(v["transform"])
        ? { type: "propose", id: v["id"], base: v["base"], transform: v["transform"] as Transform }
        : { error: "MALFORMED_MESSAGE" };
    case "undo":
      return isString(v["id"], 64) && isCount(v["seq"]) ? { type: "undo", id: v["id"], seq: v["seq"] } : { error: "MALFORMED_MESSAGE" };
    case "ping":
      return { type: "ping" };
    default:
      return { error: "MALFORMED_MESSAGE" };
  }
}
