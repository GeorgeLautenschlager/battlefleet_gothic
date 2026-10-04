/**
 * Game state types (game_state/SPEC.md). Every type here is plain JSON:
 * no classes, Dates, Maps, undefined or non-finite numbers.
 *
 * Section references (§n) are to the game state spec unless noted.
 */

// --- Shared primitives (§2)

export type PlayerId = "p1" | "p2";
export type Point = { x: number; y: number };
export type Quadrant = "front" | "left" | "rear" | "right";
export type BaseSize = "small" | "large";
export type ZoneId = "A" | "B";
export type FactionId =
  | "imperial_navy"
  | "chaos"
  | "eldar"
  | "dark_eldar"
  | "orks"
  | "necrons"
  | "tau"
  | "tyranids"
  | "space_marines"
  | "adeptus_mechanicus"
  | "rogue_traders"
  | "inquisition";

// --- Top level (§3)

export type GameState = {
  meta: Meta;
  scenario: Scenario;
  table: Table;
  players: { p1: Player; p2: Player };
  setup: SetupState;
  clock: Clock;
  ships: Ship[];
  blastMarkers: BlastMarker[];
  ordnance: Ordnance[];
  turnState: TurnState;
  activation: Activation | null;
  pending: PendingDecision[];
  queue: WorkItem[];
  rng: RngState;
  nextId: number;
  log: LogEntry[];
  result: GameResult | null;
};

// --- Meta, scenario, table, players (§4)

export type Meta = {
  schemaVersion: 1;
  ruleset: "bfg-remastered-1.10";
  createdAt: string;
  options: { ramming: boolean; boarding: boolean };
};

export type Rect = { x: number; y: number; width: number; height: number };

export type Scenario = {
  id: "cruiser_clash";
  maxRounds: number;
  scoring: "cruiser_clash";
  deploymentZones: { A: Rect; B: Rect };
  deploymentFacing: { A: number; B: number };
};

export type Table = { width: number; height: number };

export type Player = {
  id: PlayerId;
  name: string;
  faction: FactionId;
  factionTraits: { boardingModifier: number };
};

// --- Setup (§5)

export type DiceRoll = { p1: number; p2: number };

export type SetupState = {
  leadershipRolled: boolean;
  zoneRoll: number | null;
  zones: { p1: ZoneId; p2: ZoneId } | null;
  deployOrderRolls: DiceRoll[];
  firstDeployer: PlayerId | null;
  firstTurnRolls: DiceRoll[];
  firstTurnChooser: PlayerId | null;
  firstPlayer: PlayerId | null;
};

// --- Clock (§6)

export type Stage = "setup" | "battle" | "ended";

export type SetupStep =
  | "roll_leadership"
  | "roll_zones"
  | "roll_deploy_order"
  | "deploy"
  | "roll_first_turn"
  | "choose_first_turn";

export type Phase = "movement" | "shooting" | "ordnance" | "end";

export type Step =
  | "hulks_drift"
  | "move_ships"
  | "direct_fire"
  | "launch_ordnance"
  | "active_ordnance"
  | "inactive_ordnance"
  | "boarding"
  | "damage_control"
  | "blast_marker_removal";

export type Clock = {
  stage: Stage;
  setupStep: SetupStep | null;
  playerTurn: number;
  phase: Phase | null;
  step: Step | null;
};

// --- Ships (§7)

export type ShipStatus =
  | "undeployed"
  | "active"
  | "drifting_hulk"
  | "blazing_hulk"
  | "destroyed"
  | "disengaged";

export type Ship = {
  id: string;
  owner: PlayerId;
  name: string;
  profile: ShipProfile;
  leadership: number | null;
  status: ShipStatus;
  position: Point | null;
  heading: number | null;
  damage: number;
  criticals: Critical[];
  specialOrder: SpecialOrder | null;
  loaded: { torpedoes?: boolean };
  lastMove: { playerTurn: number; distance: number } | null;
  grapple: { withShipId: string } | null;
};

export type ShipType = "battleship" | "cruiser" | "escort";

export type ShipProfile = {
  classId: string;
  className: string;
  source: { book: "fleets"; page: number };
  points: number;
  type: ShipType;
  hits: number;
  speed: number;
  turns: 45 | 90;
  shields: number;
  armour: { front: number; left: number; rear: number; right: number };
  turrets: number;
  baseSize: BaseSize;
  weapons: Weapon[];
};

export type WeaponKind = "battery" | "lance" | "torpedoes";
export type WeaponLocation = "prow" | "port" | "starboard" | "dorsal" | "keel" | "aft";

export type Weapon = {
  id: string;
  name: string;
  kind: WeaponKind;
  location: WeaponLocation;
  arcs: Quadrant[];
  range: number | null;
  speed: number | null;
  strength: number;
};

// --- Criticals (§7.2)

export type CriticalKind =
  | "dorsal_armament"
  | "starboard_armament"
  | "port_armament"
  | "prow_armament"
  | "engine_room"
  | "fire"
  | "thrusters"
  | "bridge_smashed"
  | "shields_collapse";

export type Critical = { id: string; kind: CriticalKind; playerTurn: number };

// --- Special orders (§7.3)

export type OrderKind =
  | "all_ahead_full"
  | "come_to_new_heading"
  | "burn_retros"
  | "lock_on"
  | "reload_ordnance"
  | "brace_for_impact";

export type SpecialOrder = {
  kind: OrderKind;
  issued: number;
  expires: { playerTurn: number; at: "movement_start" | "turn_end" };
  replaced: OrderKind | null;
};

// --- Turn state (§8)

export type AttackSource =
  | { kind: "ship"; id: string }
  | { kind: "ordnance"; id: string }
  | { kind: "explosion"; id: string };

export type ShipTurnState = {
  moved: boolean;
  drifted: boolean;
  priorityTest: "passed" | "failed" | null;
  weaponsFired: string[];
  disengage: "passed" | "failed" | null;
  boardingDeclared: string | null;
  repaired: boolean;
};

export type TurnState = {
  playerTurn: number;
  commandCheckFailed: boolean;
  ships: Record<string, ShipTurnState>;
  ordnanceMoved: string[];
  braceFailures: { shipId: string; source: AttackSource }[];
  hulkRolls: { hulkId: string; source: AttackSource }[];
  blastMarkersRemoved: boolean;
};

// --- Activation and pending decisions (§9)

export type PathStep =
  | { kind: "advance"; distance: number }
  | { kind: "turn"; degrees: number };

export type Activation = {
  kind: "move";
  shipId: string;
  stage: "ordered" | "moving";
  order: OrderKind | null;
  aafExtra: number | null;
  ram: { targetId: string; testPassed: boolean; resolved: boolean } | null;
  maxDistance: number;
  minDistance: number;
  start: { position: Point; heading: number };
  distanceMoved: number;
  distanceSinceTurn: number;
  turnsMade: number;
  truncated: boolean;
  remainingPath: PathStep[];
  slowedByBlastMarkers: boolean;
  zeroShieldBMTestDone: boolean;
  disengage: boolean;
};

export type PendingDecision = {
  id: string;
  kind: "brace";
  player: PlayerId;
  shipId: string;
  source: AttackSource;
};

/** Work items (reducer spec §11). */
export type WorkItem =
  | { kind: "brace_offer"; shipId: string; source: AttackSource }
  | {
      kind: "direct_fire";
      shooterId: string;
      weaponId: string;
      target: { kind: "ship" | "ordnance"; id: string };
      arc: Quadrant;
      aspect: Quadrant | null;
    }
  | { kind: "continue_move" }
  | { kind: "ram"; rammerId: string; targetId: string }
  | { kind: "zero_shield_bm"; shipId: string }
  | { kind: "torpedo_attack"; ordnanceId: string; targetId: string; bmTested: boolean }
  | { kind: "torpedo_hit"; ordnanceId: string; targetId: string }
  | { kind: "ordnance_move"; ordnanceId: string; travelled: number; bmTested: boolean }
  | { kind: "explosion_hit"; shipId: string; centre: Point; strength: number; targetId: string }
  | { kind: "hulk_drift"; shipId: string; distance: number; travelled: number }
  | { kind: "fire_damage"; shipId: string };

// --- Blast markers, ordnance, RNG, log (§10)

export type BlastMarker = {
  id: string;
  position: Point;
  placed: number;
  cause: "shield_hit" | "hulk" | "explosion" | "nova_miss";
};

export type TorpedoSalvo = {
  id: string;
  kind: "torpedo_salvo";
  owner: PlayerId;
  launchedBy: string;
  launched: number;
  position: Point;
  heading: number;
  strength: number;
  speed: number;
  width: number;
  attacks: { targetId: string; round: number }[];
};

export type Ordnance = TorpedoSalvo;

export type RngState = {
  algorithm: "mulberry32";
  seed: number;
  state: number;
  draws: number;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LogEntry = {
  id: string;
  playerTurn: number;
  phase: Phase | null;
  kind: string;
  actor: PlayerId | null;
  data: { [key: string]: JsonValue };
};

// --- Result (§13)

export type GameResult = {
  reason: "rounds_complete" | "fleet_eliminated";
  scores: { p1: number; p2: number };
  winner: PlayerId | null;
};
