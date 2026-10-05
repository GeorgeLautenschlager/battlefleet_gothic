/** @bfg/server: network play's game room, protocol, redaction and verification (network/SPEC.md). */
export * from "./protocol";
export { GameRoom, createRoom, upgradeRoomData, toBase64Url, IDLE_LIFETIME, ENDED_LIFETIME } from "./room";
export type { Deps, RoomData, SeatRecord, TransformRecord, Outgoing, CreateRequest, Created, CreateError } from "./room";
export { redactState, redactConfig } from "./redact";
export { replay, verifyEnded, type Verification } from "./verify";
export { cruiserClash, fleetProblem, type SeatFleet } from "./config";
