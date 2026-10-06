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
  /** Escort squadrons and capital squadrons (state §7.5). Absent when there are none, and in older saves. */
  squadrons?: ShipSquadron[];
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
  /** `carriers`: one ship with launch bays each, above the 185-point cap (p. 129). Absent in older saves: read as false. */
  /** `fleetLists`: fleets follow their fleet list, with commanders (state §4). Absent in older saves: false. */
  options: { ramming: boolean; boarding: boolean; carriers?: boolean; fleetLists?: boolean };
};

export type Rect = { x: number; y: number; width: number; height: number };

/** How the fleets were chosen (state §4). */
export type Forces = { kind: "cruiser_clash" } | { kind: "points"; limit: number };
export type Scoring = "cruiser_clash" | "victory_points";

export type Scenario = {
  id: ScenarioId;
  /** Cruiser Clash and The Raiders 8; The Bait and Fleet Engagement null: until a fleet is destroyed or gone (state N17, N53). */
  maxRounds: number | null;
  /** Absent in older saves: Cruiser Clash forces. */
  forces?: Forces;
  scoring: Scoring;
  /** Cruiser Clash only. */
  deploymentZones?: { A: Rect; B: Rect };
  /** Cruiser Clash only. */
  deploymentFacing?: { A: number; B: number };
  /** Scenarios with an attacker and a defender. The Bait: the pursuers (state N47). */
  attacker?: PlayerId;
};

export type ScenarioId = "cruiser_clash" | "the_bait" | "raiders" | "fleet_engagement";

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
  /** Fleet Engagement only (pp. 142–143). */
  engagement?: Engagement;
  /** The Raiders only (p. 131): the defender's facing and the rounds of surprise (state §5, N58, N61). */
  raid?: Raid;
};

export type Facing = 0 | 90 | 180 | 270;
export type Raid = { facing: Facing | null; surpriseTurns: number | null };

export type Formation = "sphere" | "wedge" | "cross";
export type SetupMap = "A" | "B" | "C" | "D";
export type Colour = "white" | "dark";

/** Fleet Engagement's set-up (state §5): formations, the roll-off, and the map and colours it settles. */
export type Engagement = {
  formations: { p1: Formation | null; p2: Formation | null };
  setupRolls: { rolls: DiceRoll; bonus: DiceRoll }[];
  setupChooser: PlayerId | null;
  map: SetupMap | null;
  colours: { p1: Colour; p2: Colour } | null;
};

// --- Clock (§6)

export type Stage = "setup" | "battle" | "ended";

export type SetupStep =
  | "roll_leadership"
  | "roll_zones"
  | "roll_deploy_order"
  | "choose_formation"
  | "roll_setup"
  | "choose_setup"
  | "choose_facing"
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
  /** Off the table, waiting to arrive along an entry edge (state N51): The Bait's reinforcements. */
  | "reserve"
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
  loaded: { torpedoes?: boolean; launchBays?: boolean };
  lastMove: { playerTurn: number; distance: number } | null;
  grapple: Grapple | null;
  /** An Admiral, Warmaster or Chaos Lord aboard (state §7.4). Absent in older saves: none. */
  commander?: Commander | null;
};

/** A drawn boarding action, still being fought (state §7). Every member carries an identical copy. */
export type Grapple = {
  defenderId: string;
  /** Also the order in which the attackers take boarding damage. */
  attackerIds: string[];
};

export type ShipType = "battleship" | "cruiser" | "escort";

export type ShipProfile = {
  classId: string;
  className: string;
  source: { book: "fleets"; page: number };
  points: number;
  type: ShipType;
  /** The fleet lists' kind of hull, for their ratios (state N20). Absent in older saves: "cruiser". */
  category?: ShipCategory;
  /** The option ids taken for this ship, already applied (state N21). Absent in older saves: none. */
  options?: string[];
  hits: number;
  speed: number;
  turns: 45 | 90;
  shields: number;
  armour: { front: number; left: number; rear: number; right: number };
  turrets: number;
  baseSize: BaseSize;
  weapons: Weapon[];
  /** The class's special rules from the fleet book; absent = none. */
  traits?: ShipTraits;
};

export type ShipTraits = {
  /** D6 rolled for All Ahead Full; default 4. Improved thrusters: 5 (state N10). */
  allAheadFullDice?: number;
  /** Its weapons batteries take one column shift left (Mars and Overlord option, transform T64). */
  targetingMatrix?: boolean;
  /** May not use Come to New Heading (the battleships, state N31). */
  noComeToNewHeading?: boolean;
  /** Added to its Leadership, max 10 (the Emperor's +1, state N32). */
  leadershipBonus?: number;
  /** Its batteries take no column shift for firing over 30 cm (the Idolator, p. 281). */
  noLongRangeShift?: boolean;
};

export type ShipCategory = "cruiser" | "light_cruiser" | "heavy_cruiser" | "battlecruiser" | "grand_cruiser" | "battleship" | "escort";

// --- Squadrons (§7.5)

/** A squadron of ships (state §7.5's `Squadron`; attack craft already have `Squadron`). */
export type ShipSquadron = {
  id: string;
  owner: PlayerId;
  name: string;
  /** Escorts, or capital ships squadroned before the game (p. 95). */
  type: "escort" | "capital";
  /** Its members, in config order. A capital ship that fails a disengage test leaves for good (p. 56). */
  shipIds: string[];
  /** Escort squadrons: an escort has left or disengaged, so every move must attempt it (state N41). */
  disengaging: boolean;
};

/** A squadron part-way through its Movement Phase (state §8, N37). */
export type SquadronMove = {
  squadronId: string;
  /** The order its members took together, or null. */
  order: OrderKind | null;
  /** The one All Ahead Full roll for the squadron. */
  aafExtra: number | null;
  /** The ships in formation when it began. */
  members: string[];
  /** Escort squadrons: the disengage flag its first mover chose (state N41). */
  disengage: boolean | null;
};

// --- Fleet commanders (§7.4)

export type Mark = "slaanesh" | "khorne" | "tzeentch" | "nurgle";

export type Commander = {
  /** admiral, warmaster: the fleet commander; lord: a Chaos Lord. */
  kind: "admiral" | "warmaster" | "lord";
  /** Replaces the ship's rolled Leadership, even if lower (state N22). */
  leadership: number;
  /** The commander, extra re-rolls and Marks: part of the ship's value (N25). */
  points: number;
  marks: Mark[];
  /** Re-rolls left this game (N23). */
  rerolls: number;
};

export type WeaponKind = "battery" | "lance" | "torpedoes" | "launch_bay" | "nova_cannon";
export type WeaponLocation = "prow" | "port" | "starboard" | "dorsal" | "keel" | "aft";

export type Weapon = {
  id: string;
  name: string;
  kind: WeaponKind;
  location: WeaponLocation;
  arcs: Quadrant[];
  range: number | null;
  /** Nova cannon only: 30 cm. Its range is to the template's near edge (state N13). */
  minRange?: number;
  speed: number | null;
  /** Firepower (batteries), strength (lances, torpedoes), squadrons (launch bays); 1 for a nova cannon. */
  strength: number;
  /** Launch bays only: the attack craft they carry (fleet rules). */
  craft?: CraftOption[];
};

export type CraftRole = "fighter" | "bomber" | "assault_boat";
export type CraftOption = { role: CraftRole; name: string; speed: number };

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
  boarded: boolean;
  teleported: boolean;
  repaired: boolean;
  /**
   * What its turrets (own, or massed for a friend) fired at this phase: torpedoes
   * or attack craft, never both (p. 80). Absent in older saves: read as null.
   */
  turrets?: { phase: Phase; against: TurretTarget } | null;
};

export type TurretTarget = "torpedoes" | "attack_craft";

export type TurnState = {
  playerTurn: number;
  commandCheckFailed: boolean;
  ships: Record<string, ShipTurnState>;
  ordnanceMoved: string[];
  braceFailures: { shipId: string; source: AttackSource }[];
  hulkRolls: { hulkId: string; source: AttackSource }[];
  blastMarkersRemoved: boolean;
  /** A squadron part-way through its move (state N37). Absent when none. */
  squadronMove?: SquadronMove | null;
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
  /** The move asked to re-roll a failed disengage test (transform §2.7). Absent in older saves. */
  reroll?: boolean;
  boardTargetId: string | null;
  /** The ship moves as part of this squadron's move. Absent otherwise, and in older saves. */
  squadronId?: string;
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
      /** More batteries in the same volley (T32). Absent in older saves: none. */
      combineWith?: string[];
      target: { kind: "ship" | "ordnance"; id: string };
      arc: Quadrant;
      aspect: Quadrant | null;
      /** Squadron-mates' weapons in the volley (reducer §4.5). Absent: none. */
      withShips?: { shipId: string; weaponIds: string[] }[];
      /** A squadron target's aspect fired at. */
      targetAspect?: "closing" | "moving_away" | "abeam";
    }
  | { kind: "continue_move" }
  | { kind: "ram"; rammerId: string; targetId: string }
  | { kind: "zero_shield_bm"; shipId: string }
  | { kind: "torpedo_attack"; ordnanceId: string; targetId: string; bmTested: boolean }
  | { kind: "torpedo_hit"; ordnanceId: string; targetId: string }
  | { kind: "ordnance_move"; ordnanceId: string; travelled: number; bmTested: boolean }
  | { kind: "explosion_hit"; shipId: string; centre: Point; strength: number; targetId: string }
  | { kind: "hulk_drift"; shipId: string; distance: number; travelled: number }
  | { kind: "fire_damage"; shipId: string }
  | { kind: "boarding_fight"; defenderId: string; attackerIds: string[] }
  | { kind: "boarding_critical"; shipId: string; need: number | "auto" | "none"; bonus?: number }
  | { kind: "teleport_attack"; shipId: string; targetId: string }
  | { kind: "craft_meets_ship"; ordnanceId: string; targetId: string; bmTested: boolean }
  | { kind: "craft_attack"; ordnanceId: string; targetId: string }
  | { kind: "hit_and_run"; ordnanceId: string; targetId: string }
  | { kind: "nova_cannon"; shooterId: string; weaponId: string; aim: Point; dice: number }
  | { kind: "nova_hit"; shooterId: string; shipId: string; hits: number; origin: Point };

// --- Blast markers, ordnance, RNG, log (§10)

export type BlastMarker = {
  id: string;
  position: Point;
  placed: number;
  cause: "shield_hit" | "hulk" | "explosion" | "nova_miss" | "escort_lost";
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

/** One marker of a wave (state §10.2). */
export type Squadron = { role: CraftRole; name: string; speed: number };

/** An attack craft wave: one entity, however many markers (state §10.2, transform T17). */
export type AttackCraftWave = {
  id: string;
  kind: "attack_craft";
  owner: PlayerId;
  launchedBy: string;
  launched: number;
  /** Centre of the wave's footprint. */
  position: Point;
  /** One per marker, in launch order; never empty while in play. */
  squadrons: Squadron[];
  /** The ship it flies Combat Air Patrol for (then a single fighter). */
  cap: string | null;
};

export type Ordnance = TorpedoSalvo | AttackCraftWave;

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
