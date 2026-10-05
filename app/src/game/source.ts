/**
 * Where the game comes from (network/SPEC.md §7.1). The UI reads `state` and
 * calls `run`; it doesn't care whether that's this browser's history
 * (hot-seat) or a server (online, coming next).
 */
import { actor, type GameState, type PlayerId, type Reason, type Transform } from "@bfg/engine";

/** The player(s) this screen drives: both in hot-seat, one online. */
export type Seat = PlayerId | "both";

export type SourceStatus = "ready" | "waiting" | "offline";

export interface GameSource {
  kind: "local" | "remote";
  state: GameState;
  seat: Seat;
  /** Apply (hot-seat) or propose (online). Resolves to whether it was accepted. */
  run(t: Transform): Promise<boolean>;
  canUndo: boolean;
  undo(): void;
  /** Online: a proposal in flight ("waiting") or no connection ("offline"). Hot-seat: always "ready". */
  status: SourceStatus;
  /** Why the last action was refused, if it was. */
  rejection: Reason | null;
}

/** Whether this screen drives `player`. */
export const controls = (seat: Seat, player: PlayerId): boolean => seat === "both" || seat === player;

/**
 * The player this screen is waiting on, or null if it's this screen's move
 * (or anyone's: the setup rolls and damage control are "either").
 */
export function waitingOn(state: GameState, seat: Seat): PlayerId | null {
  const who = actor(state);
  return who === "p1" || who === "p2" ? (controls(seat, who) ? null : who) : null;
}

/** The player to send an "either" transform as: our seat online, p1 in hot-seat. */
export const sendAs = (seat: Seat): PlayerId => (seat === "both" ? "p1" : seat);
