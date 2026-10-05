/**
 * The network protocol (network/SPEC.md §4): every message between a client
 * and a game room. Plain JSON, one `type` per message.
 */
import type { GameConfig, GameState, PlayerId, Transform } from "@bfg/engine";

/** Bumped on any incompatible change to these messages. */
export const PROTOCOL = 1;

/** Limits (spec §9). */
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_MESSAGES_PER_SECOND = 20;
export const MAX_SOCKETS_PER_SEAT = 2;
export const MAX_NAME_LENGTH = 40;

// --- Client → server (§4.1)

export type Hello = { type: "hello"; token: string; protocol: number; engine: string };
export type Join = { type: "join"; token: string; name: string; shipName: string };
export type Propose = { type: "propose"; id: string; base: number; transform: Transform };
export type Undo = { type: "undo"; id: string; seq: number };
export type Ping = { type: "ping" };

export type ClientMessage = Hello | Join | Propose | Undo | Ping;

// --- Server → client (§4.2)

export type SeatInfo = { name: string | null; shipName: string | null; joined: boolean };
export type Lobby = { seats: Record<PlayerId, SeatInfo> };
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
  | "ENGINE_ERROR";

// --- Shape checks. Transforms themselves are checked by the engine's validator (G1, MALFORMED).

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

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
      return isString(v["token"]) && isString(v["name"]) && isString(v["shipName"])
        ? { type: "join", token: v["token"], name: v["name"], shipName: v["shipName"] }
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
