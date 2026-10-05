/**
 * Transforms (transforms/SPEC.md): plain-data proposals, one player decision each.
 * Section references (§n) are to the transform spec.
 */
import type { OrderKind, PathStep, PlayerId, Point, Quadrant } from "../state/types";

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

// Shooting (§4.3)
export type FireTarget = { kind: "ship" | "ordnance"; id: string };
export type Fire = Base<"fire"> & {
  shipId: string;
  weaponId: string;
  target: FireTarget;
  arc?: Quadrant;
  aspect?: Quadrant;
};
export type LaunchTorpedoes = Base<"launch_torpedoes"> & { shipId: string; weaponId: string; bearing: number };
export type EndStep = Base<"end_step">;

// Ordnance (§4.4)
export type MoveOrdnance = Base<"move_ordnance"> & { ordnanceId: string };

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
  | Fire
  | LaunchTorpedoes
  | EndStep
  | MoveOrdnance
  | AnswerBrace
  | Repair
  | RemoveBlastMarkers
  | Board
  | Teleport;

export type TransformType = Transform["type"];
