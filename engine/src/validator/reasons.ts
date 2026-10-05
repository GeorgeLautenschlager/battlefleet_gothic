/** Validation results and reason codes (validator spec §5). */
import type { JsonValue } from "../state/types";

export const REASON_CODES = [
  "MALFORMED",
  "GAME_OVER",
  "PENDING_DECISION",
  "NO_PENDING_DECISION",
  "NOT_TOP_PENDING",
  "NOT_YOUR_TURN",
  "WRONG_MOMENT",
  "UNKNOWN_SHIP",
  "UNKNOWN_WEAPON",
  "UNKNOWN_TARGET",
  "UNKNOWN_ORDNANCE",
  "NOT_YOUR_SHIP",
  "NOT_YOUR_ORDNANCE",
  "SHIP_NOT_ACTIVE",
  "ALREADY_DEPLOYED",
  "NOT_IN_ZONE",
  "BASES_OVERLAP",
  "NOT_A_HULK",
  "ALREADY_DRIFTED",
  "ALREADY_MOVED",
  "ACTIVATION_OPEN",
  "ORDERS_LOCKED",
  "ALREADY_ON_ORDERS",
  "INVALID_ORDER",
  "RAM_NOT_ALLOWED",
  "INVALID_RAM_TARGET",
  "INVALID_PATH_STEP",
  "TURN_TOO_SHARP",
  "TOO_MANY_TURNS",
  "TURN_TOO_EARLY",
  "PATH_TOO_LONG",
  "PATH_TOO_SHORT",
  "MUST_MOVE_FULL_DISTANCE",
  "MUST_STOP_AT_BLAST_MARKER",
  "PATH_CONTINUES_OFF_TABLE",
  "ALREADY_LEAVING_TABLE",
  "DISENGAGE_FAILED",
  "WRONG_WEAPON_KIND",
  "WEAPON_ALREADY_FIRED",
  "WEAPON_DISABLED",
  "NOT_LOADED",
  "INVALID_TARGET",
  "OUT_OF_RANGE",
  "OUT_OF_ARC",
  "ARC_CHOICE_REQUIRED",
  "INVALID_ARC_CHOICE",
  "ASPECT_CHOICE_REQUIRED",
  "INVALID_ASPECT_CHOICE",
  "LINE_OF_FIRE_BLOCKED",
  "MUST_TARGET_NEAREST",
  "BEARING_OUT_OF_ARC",
  "ORDNANCE_ALREADY_MOVED",
  "ALREADY_REPAIRED",
  "NOTHING_TO_REPAIR",
  "INVALID_PRIORITY",
  // Boarding and teleport attacks (validator spec v0.4)
  "BOARDING_OFF",
  "INVALID_BOARDING_TARGET",
  "TARGET_GRAPPLED",
  "CANNOT_BOARD_AND_LEAVE",
  "NOT_IN_CONTACT",
  "GRAPPLED",
  "BOARDING_SHIP",
  "NO_BOARDING_DECLARED",
  "BOARDING_UNRESOLVED",
  "ALREADY_TELEPORTED",
  "CANNOT_TELEPORT",
  "SHIELDS_UP",
  "TARGET_TOO_LARGE",
  // Combined battery fire (validator spec v0.6)
  "INVALID_VOLLEY",
  // Attack craft and CAP (validator spec v0.5)
  "NO_LAUNCH_BAYS",
  "EMPTY_WAVE",
  "CRAFT_NOT_CARRIED",
  "TOO_MANY_SQUADRONS",
  "FLEET_LIMIT",
  "INVALID_RECALL",
  "CAP_NOT_FIGHTERS",
  "INVALID_CAP_SHIP",
  "NOT_ON_CAP",
  "ON_CAP",
  "TOO_LATE_TO_RELEASE",
  "WRONG_ORDNANCE_MOVE",
  "PATH_OFF_TABLE",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type Reason = { code: ReasonCode; message: string; details?: { [key: string]: JsonValue } };

export type ValidationResult = { ok: true } | { ok: false; reason: Reason };

export const OK: ValidationResult = { ok: true };

export function reject(code: ReasonCode, message: string, details?: Reason["details"]): ValidationResult {
  return { ok: false, reason: details === undefined ? { code, message } : { code, message, details } };
}

/** Round for human-readable messages only (never for decisions). */
export const cm = (n: number): string => `${Math.round(n * 100) / 100} cm`;
