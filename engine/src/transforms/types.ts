/**
 * Transforms (transforms/SPEC.md): plain-data proposals, one player decision each.
 * Section references (§n) are to the transform spec.
 */
import type { CraftRole, OrderKind, PathStep, PlayerId, Point, Quadrant } from "../state/types";

type Base<T extends string> = { type: T; player: PlayerId };

// Setup (§4.1)
export type RollLeadership = Base<"roll_leadership">;
export type RollZones = Base<"roll_zones">;
export type RollDeployOrder = Base<"roll_deploy_order">;
export type DeployShip = Base<"deploy_ship"> & { shipId: string; position: Point };
export type RollFirstTurn = Base<"roll_first_turn">;
export type ChooseFirstTurn = Base<"choose_first_turn"> & { goFirst: boolean };

// Movement (§4.2)
export type DriftHulk = Base<"drift_hulk"> & { shipId: string };
/** `order` is any OrderKind so that a declared Brace is well-formed and rejected as INVALID_ORDER. */
export type DeclareOrder = Base<"declare_order"> & { shipId: string; order: OrderKind; ramTargetId?: string };
export type Move = Base<"move"> & { shipId: string; path: PathStep[]; disengage: boolean; boardTargetId?: string };
/** Take a CAP fighter off CAP at the start of its owner's Movement Phase (p. 82). */
export type ReleaseCap = Base<"release_cap"> & { ordnanceId: string };

// Shooting (§4.3)
export type FireTarget = { kind: "ship" | "ordnance"; id: string };
export type Fire = Base<"fire"> & {
  shipId: string;
  weaponId: string;
  /** More of this ship's weapons batteries fired in the same volley at the same target (T32). */
  combineWith?: string[];
  target: FireTarget;
  arc?: Quadrant;
  aspect?: Quadrant;
};
export type LaunchTorpedoes = Base<"launch_torpedoes"> & { shipId: string; weaponId: string; bearing: number };
/** Each entry is one wave (or, with `cap`, one CAP fighter per squadron); `recall` removes own waves first (p. 73). */
export type LaunchAttackCraft = Base<"launch_attack_craft"> & {
  shipId: string;
  waves: { roles: CraftRole[]; cap: boolean }[];
  recall: string[];
};
export type EndStep = Base<"end_step">;

// Ordnance (§4.4)
/** `path` and `cap` are for attack craft only: waypoints flown in order, and a friendly ship to fly CAP for at the end. */
export type MoveOrdnance = Base<"move_ordnance"> & { ordnanceId: string; path?: Point[]; cap?: string };

// Brace (§4.5)
export type AnswerBrace = Base<"answer_brace"> & { pendingId: string; attempt: boolean };

// End Phase (§4.6)
export type Repair = Base<"repair"> & { shipId: string; priority: string[] };
export type RemoveBlastMarkers = Base<"remove_blast_markers"> & { priority: string[] };
/** `priority`: the boarding ships, in fight order (separately) or damage order (together). */
export type Board = Base<"board"> & { targetId: string; together: boolean; priority: string[] };
export type Teleport = Base<"teleport"> & { shipId: string; targetId: string };

export type Transform =
  | RollLeadership
  | RollZones
  | RollDeployOrder
  | DeployShip
  | RollFirstTurn
  | ChooseFirstTurn
  | DriftHulk
  | DeclareOrder
  | Move
  | ReleaseCap
  | Fire
  | LaunchTorpedoes
  | LaunchAttackCraft
  | EndStep
  | MoveOrdnance
  | AnswerBrace
  | Repair
  | RemoveBlastMarkers
  | Board
  | Teleport;

export type TransformType = Transform["type"];
