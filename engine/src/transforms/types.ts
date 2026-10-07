/**
 * Transforms (transforms/SPEC.md): plain-data proposals, one player decision each.
 * Section references (§n) are to the transform spec.
 */
import type { Colour, CraftRole, Facing, Formation, OrderKind, PathStep, PlayerId, Point, Quadrant, SetupMap } from "../state/types";

type Base<T extends string> = { type: T; player: PlayerId };

// Setup (§4.1)
export type RollLeadership = Base<"roll_leadership">;
export type RollZones = Base<"roll_zones">;
export type RollDeployOrder = Base<"roll_deploy_order">;
/** `heading`: Surprise Attack's defender only, where the division sets none (T116). */
export type DeployShip = Base<"deploy_ship"> & { shipId: string; position: Point; heading?: number };
/** Place an orbital mine or the next minefield, by its centre; `turned` swaps a minefield's sides (T144–T146). */
export type PlaceDefence = Base<"place_defence"> & { kind: "orbital_mine" | "minefield"; position: Point; turned?: boolean };
export type RollFirstTurn = Base<"roll_first_turn">;
export type ChooseFirstTurn = Base<"choose_first_turn"> & { goFirst: boolean };
// Fleet Engagement's set-up (§4.1)
export type ChooseFormation = Base<"choose_formation"> & { formation: Formation };
export type RollSetup = Base<"roll_setup">;
/** `colour`: the chooser's own; the opponent takes the other. */
export type ChooseSetup = Base<"choose_setup"> & { map: SetupMap; colour: Colour };
/** The Raiders: the table edge the defender's fleet faces (T103). */
export type ChooseFacing = Base<"choose_facing"> & { heading: Facing };
/** Surprise Attack: the defender's units on full alert, by ship id (a ship in no squadron) or squadron id (T115). */
export type ChooseAlert = Base<"choose_alert"> & { units: string[] };

// Movement (§4.2)
export type DriftHulk = Base<"drift_hulk"> & { shipId: string };
/** `order` is any OrderKind so that a declared Brace is well-formed and rejected as INVALID_ORDER. */
/** `reroll`: re-roll a failed Command check or ram test with a fleet commander re-roll (§2.7). */
export type DeclareOrder = Base<"declare_order"> & { shipId: string; order: OrderKind; ramTargetId?: string; reroll?: boolean };
/** `reroll`: re-roll a failed disengage test (§2.7). */
export type Move = Base<"move"> & { shipId: string; path: PathStep[]; disengage: boolean; boardTargetId?: string; reroll?: boolean };
/** Take a CAP fighter off CAP at the start of its owner's Movement Phase (p. 82). */
export type ReleaseCap = Base<"release_cap"> & { ordnanceId: string };
/** Bring one unit of reserves on along an entry edge (T94): a ship in no squadron, or a whole squadron. */
export type Arrive = Base<"arrive"> & { placements: { shipId: string; position: Point; heading: number }[] };
/** A fire ship goes off, before its move or after it (T153). */
export type Detonate = Base<"detonate"> & { shipId: string };

// Shooting (§4.3)
export type FireTarget = { kind: "ship" | "ordnance" | "minefield"; id: string };
export type Fire = Base<"fire"> & {
  shipId: string;
  weaponId: string;
  /** More of this ship's weapons batteries fired in the same volley at the same target (T32). */
  combineWith?: string[];
  target: FireTarget;
  arc?: Quadrant;
  aspect?: Quadrant;
  /** Re-roll a failed target-priority test (§2.7). */
  reroll?: boolean;
  /** Squadron-mates' weapons joining the volley (T84). */
  withShips?: { shipId: string; weaponIds: string[] }[];
  /** A squadron target: the aspect fired at (T85). */
  targetAspect?: "closing" | "moving_away" | "abeam";
};
/** Aim a nova cannon: `aim` is where the template's centre is placed (T40). */
export type FireNovaCannon = Base<"fire_nova_cannon"> & { shipId: string; weaponId: string; aim: Point };
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
/** `reroll`: re-roll a failed brace Command check (§2.7). */
export type AnswerBrace = Base<"answer_brace"> & { pendingId: string; attempt: boolean; reroll?: boolean };

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
  | PlaceDefence
  | RollFirstTurn
  | ChooseFirstTurn
  | ChooseFormation
  | RollSetup
  | ChooseSetup
  | ChooseFacing
  | ChooseAlert
  | DriftHulk
  | DeclareOrder
  | Move
  | ReleaseCap
  | Arrive
  | Detonate
  | Fire
  | FireNovaCannon
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
