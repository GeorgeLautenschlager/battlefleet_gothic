/**
 * The newGame factory (transform spec §5). Not a transform: there's no state
 * to validate against yet, so a bad config throws instead of returning a reason.
 */
import { boardingModifier, CATALOGUE, profileWithOptions } from "./catalogue";
import { buildCommander, commanderPoints, fleetListProblem, type CommanderConfig } from "../rules/fleetLists";
import { EngineError } from "./derived";
import { cloneJson } from "./json";
import { createRng } from "./rng";
import { PLANET_SIZES } from "../rules/planets";
import type { FactionId, Forces, GameState, PlanetSize, PlayerId, Scenario, ScenarioId, Scoring, Ship, ShipProfile, ShipSquadron, ShipTurnState, TurnState } from "./types";

export type GameConfig = {
  seed: number;
  createdAt: string;
  /** `fleetLists`: points battles follow the Gothic War fleet lists, with commanders (T58). */
  options?: { ramming?: boolean; boarding?: boolean; carriers?: boolean; fleetLists?: boolean };
  /** Default: Cruiser Clash. Fleet Engagement and The Bait need points forces and victory points (transform §5). */
  scenario?: ScenarioId;
  /** The Bait: the pursuers (state N47); The Raiders: the raiders (N56). Required there, refused elsewhere. */
  attacker?: PlayerId;
  /** A planet in the table centre (transform T107); default none. */
  planet?: PlanetSize;
  /** Default: Cruiser Clash forces (state §4). */
  forces?: Forces;
  /** Default: Cruiser Clash scoring. */
  scoring?: Scoring;
  players: {
    p1: { name: string; faction: FactionId };
    p2: { name: string; faction: FactionId };
  };
  /** `options`: the class's option ids (transform §5, T57). `squadron`: its squadron's name (T76). `reserve`: The Bait's reinforcements (T93). */
  ships: { owner: PlayerId; name: string; classId: string; options?: string[]; commander?: CommanderConfig; squadron?: string; reserve?: boolean }[];
};

/** A ship's profile as fielded: its class with its options applied, or an EngineError. */
function shipProfile(ship: GameConfig["ships"][number], i: number): ShipProfile {
  try {
    return profileWithOptions(ship.classId, ship.options ?? []);
  } catch (e) {
    throw new EngineError(`ships[${i}]: ${(e as Error).message}`);
  }
}

/** Cruiser Clash forces (p. 128): 1–4 cruisers a side, equal numbers, ≤ 185 points each. */
const CRUISER_CLASH = { minShips: 1, maxShips: 4, maxPoints: 185 } as const;

export function emptyShipTurnState(): ShipTurnState {
  return {
    moved: false,
    drifted: false,
    priorityTest: null,
    weaponsFired: [],
    disengage: null,
    boardingDeclared: null,
    boarded: false,
    teleported: false,
    repaired: false,
    turrets: null,
  };
}

/** A fresh turnState for a player turn, with an entry for every ship (state §8). */
export function emptyTurnState(playerTurn: number, ships: readonly Ship[]): TurnState {
  const entries: TurnState["ships"] = {};
  for (const ship of ships) entries[ship.id] = emptyShipTurnState();
  return {
    playerTurn,
    commandCheckFailed: false,
    ships: entries,
    ordnanceMoved: [],
    braceFailures: [],
    hulkRolls: [],
    blastMarkersRemoved: false,
  };
}

function validateConfig(config: GameConfig): void {
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) {
    throw new EngineError(`seed must be a uint32, got ${config.seed}`);
  }
  const forces = config.forces ?? { kind: "cruiser_clash" };
  if (config.planet !== undefined && !(config.planet in PLANET_SIZES)) throw new EngineError(`a planet is small, medium or large, not ${String(config.planet)}`);
  if (forces.kind === "points" && (!Number.isInteger(forces.limit) || forces.limit <= 0)) {
    throw new EngineError(`a points limit must be a positive whole number, got ${forces.limit}`);
  }
  if (config.scenario === "fleet_engagement") {
    // "Equal points" and standard victory points (p. 142).
    if (forces.kind !== "points") throw new EngineError("Fleet Engagement is fought at a points limit");
    if (config.scoring !== undefined && config.scoring !== "victory_points") throw new EngineError("Fleet Engagement is scored with victory points");
  }
  if (config.scenario === "the_bait" || config.scenario === "raiders") {
    const name = config.scenario === "the_bait" ? "The Bait" : "The Raiders";
    if (forces.kind !== "points") throw new EngineError(`${name} is fought at a points limit`);
    if (config.scoring !== undefined && config.scoring !== "victory_points") throw new EngineError(`${name} is scored with victory points`);
    if (config.attacker !== "p1" && config.attacker !== "p2") {
      throw new EngineError(config.scenario === "the_bait" ? "The Bait needs the pursuers named as the attacker" : "The Raiders needs the raiders named as the attacker");
    }
  } else if (config.attacker !== undefined) {
    throw new EngineError("only The Bait and The Raiders have an attacker");
  }
  if (config.scenario !== "the_bait" && config.ships.some((s) => s.reserve === true)) {
    throw new EngineError(config.scenario === "raiders" ? "every raider moves on: no ship is marked as a reinforcement" : "only The Bait has reinforcements in reserve");
  }
  const counts = { p1: 0, p2: 0 };
  const points = { p1: 0, p2: 0 };
  const carriersOverCap = { p1: 0, p2: 0 };
  const carriers = config.options?.carriers ?? false;
  for (const [i, ship] of config.ships.entries()) {
    const entry = CATALOGUE[ship.classId];
    if (entry === undefined) throw new EngineError(`ships[${i}]: unknown class "${ship.classId}"`);
    const faction = config.players[ship.owner].faction;
    if (entry.faction !== faction) {
      throw new EngineError(`ships[${i}]: a ${ship.classId} can't serve in a ${faction} fleet`);
    }
    // Battleships and escorts come with points battles (T71, state N45).
    if (entry.profile.type !== "cruiser" && forces.kind !== "points") {
      throw new EngineError(`ships[${i}]: Cruiser Clash allows cruisers only`);
    }
    if (entry.legacy === true && (ship.options ?? []).length > 0) throw new EngineError(`ships[${i}]: ${ship.classId} takes no options`);
    const profile = shipProfile(ship, i);
    points[ship.owner] += profile.points + (ship.commander !== undefined ? commanderPoints(ship.commander) : 0);
    // A points battle has no per-ship cap (T36): only the side's total counts.
    if (forces.kind === "cruiser_clash" && profile.points > CRUISER_CLASH.maxPoints) {
      // "One carrier each" (p. 129): a ship with launch bays may go over the cap, one per side.
      const carrier = profile.weapons.some((w) => w.kind === "launch_bay");
      if (!carriers || !carrier) {
        throw new EngineError(`ships[${i}]: ${profile.points} pts exceeds the ${CRUISER_CLASH.maxPoints} pt cap`);
      }
      carriersOverCap[ship.owner] += 1;
      if (carriersOverCap[ship.owner] > 1) {
        throw new EngineError(`ships[${i}]: only one carrier each may go over the ${CRUISER_CLASH.maxPoints} pt cap`);
      }
    }
    counts[ship.owner] += 1;
  }
  squadronProblems(config, forces.kind === "points");
  // Rarity limits (T35): e.g. two Murder lance variants per 750 points of the side's fleet, or part.
  for (const player of ["p1", "p2"] as const) {
    const mine = config.ships.filter((s) => s.owner === player);
    const side = mine.map((s) => CATALOGUE[s.classId]);
    const points = mine.reduce((n, s) => n + profileWithOptions(s.classId, s.options ?? []).points, 0);
    for (const entry of new Set(side)) {
      if (entry?.limit === undefined) continue;
      const allowed = entry.limit.max * Math.ceil(points / entry.limit.perPoints);
      const n = side.filter((e) => e === entry).length;
      if (n > allowed) throw new EngineError(`${player} may field at most ${allowed} × ${entry.profile.className} in ${points} pts`);
    }
  }
  // Fleet lists and commanders (T58–T60): points battles only.
  if (config.options?.fleetLists === true) {
    if (forces.kind !== "points") throw new EngineError("fleet lists need a points battle");
    for (const player of ["p1", "p2"] as const) {
      const side = config.ships.flatMap((s, i) => (s.owner === player ? [{ classId: s.classId, profile: shipProfile(s, i), ...(s.commander ? { commander: s.commander } : {}) }] : []));
      const problem = fleetListProblem(config.players[player].faction, side);
      if (problem !== null) throw new EngineError(`${player}: ${problem}`);
    }
  } else if (config.ships.some((s) => s.commander !== undefined)) {
    throw new EngineError("commanders come with the fleet lists");
  }
  if (config.scenario === "the_bait" && forces.kind === "points") {
    baitForces(config, forces.limit);
    return;
  }
  if (config.scenario === "raiders" && forces.kind === "points") {
    // The defender up to the limit, the raiders up to half of it (p. 131, state N57).
    const raiders = config.attacker as PlayerId;
    for (const player of ["p1", "p2"] as const) {
      const limit = player === raiders ? Math.floor(forces.limit / 2) : forces.limit;
      if (counts[player] < 1) throw new EngineError(`${player} must field at least one ship`);
      const who = player === raiders ? "the raiders'" : "the defender's";
      if (points[player] > limit) throw new EngineError(`${who} fleet is ${points[player]} pts, over the ${limit} pt limit`);
    }
    return;
  }
  if (forces.kind === "points") {
    for (const player of ["p1", "p2"] as const) {
      if (counts[player] < 1) throw new EngineError(`${player} must field at least one ship`);
      if (points[player] > forces.limit) throw new EngineError(`${player}'s fleet is ${points[player]} pts, over the ${forces.limit} pt limit`);
    }
    return;
  }
  for (const player of ["p1", "p2"] as const) {
    const n = counts[player];
    if (n < CRUISER_CLASH.minShips || n > CRUISER_CLASH.maxShips) {
      throw new EngineError(`${player} must field 1–4 cruisers, got ${n}`);
    }
  }
  if (counts.p1 !== counts.p2) {
    throw new EngineError(`both fleets need the same number of cruisers (p1 ${counts.p1}, p2 ${counts.p2})`);
  }
}

/** A ship's points as fielded: its class, options and any commander. */
function fieldedPoints(ship: GameConfig["ships"][number], i: number): number {
  return shipProfile(ship, i).points + (ship.commander !== undefined ? commanderPoints(ship.commander) : 0);
}

/**
 * The Bait's forces (T93, state N48): the pursuers up to the limit, none in reserve; the
 * pursued player's bait one ship or one whole squadron up to half of it; their reinforcements up to the limit.
 */
function baitForces(config: GameConfig, limit: number): void {
  const pursuers = config.attacker as PlayerId;
  const pursued: PlayerId = pursuers === "p1" ? "p2" : "p1";
  const indexed = config.ships.map((ship, i) => ({ ship, i }));
  const theirs = indexed.filter((x) => x.ship.owner === pursuers);
  if (theirs.length < 1) throw new EngineError(`${pursuers} must field at least one ship`);
  if (theirs.some((x) => x.ship.reserve === true)) throw new EngineError("the pursuers have no reinforcements");
  const total = theirs.reduce((n, x) => n + fieldedPoints(x.ship, x.i), 0);
  if (total > limit) throw new EngineError(`the pursuers' fleet is ${total} pts, over the ${limit} pt limit`);

  const mine = indexed.filter((x) => x.ship.owner === pursued);
  for (const sq of squadronGroups(config).filter((g) => g.owner === pursued)) {
    const reserve = sq.members.filter((m) => m.reserve === true).length;
    if (reserve !== 0 && reserve !== sq.members.length) throw new EngineError(`squadron "${sq.name}" is all in reserve or none of it`);
  }
  const bait = mine.filter((x) => x.ship.reserve !== true);
  const names = new Set(bait.map((x) => x.ship.squadron));
  const oneUnit = bait.length === 1 ? bait[0]?.ship.squadron === undefined || names.size === 1 : names.size === 1 && !names.has(undefined);
  if (bait.length === 0 || !oneUnit) throw new EngineError("the bait is one ship or one squadron: every other ship of the pursued fleet is a reinforcement");
  const baitPoints = bait.reduce((n, x) => n + fieldedPoints(x.ship, x.i), 0);
  if (baitPoints > Math.floor(limit / 2)) throw new EngineError(`the bait is ${baitPoints} pts, over the ${Math.floor(limit / 2)} pt limit`);
  const reinforcements = mine.filter((x) => x.ship.reserve === true).reduce((n, x) => n + fieldedPoints(x.ship, x.i), 0);
  if (reinforcements > limit) throw new EngineError(`the reinforcements are ${reinforcements} pts, over the ${limit} pt limit`);
}

/** Squadrons (T76, state §7.5): escorts always in one, 1–6 (2–6 with fleet lists); capital squadrons of one type, 2+. */
function squadronProblems(config: GameConfig, points: boolean): void {
  const lists = config.options?.fleetLists === true;
  for (const [i, ship] of config.ships.entries()) {
    const type = CATALOGUE[ship.classId]?.profile.type;
    if (ship.squadron !== undefined && (typeof ship.squadron !== "string" || ship.squadron.trim() === "")) {
      throw new EngineError(`ships[${i}]: a squadron needs a name`);
    }
    if (type === "escort" && ship.squadron === undefined) throw new EngineError(`ships[${i}]: an escort must be in a squadron`);
    if (ship.squadron !== undefined && !points) throw new EngineError(`ships[${i}]: squadrons come with points battles`);
  }
  for (const sq of squadronGroups(config)) {
    const types = new Set(sq.members.map((m) => CATALOGUE[m.classId]?.profile.type));
    const n = sq.members.length;
    if (types.has("escort")) {
      if (types.size > 1) throw new EngineError(`squadron "${sq.name}": escorts and capital ships can't share a squadron`);
      const min = lists ? 2 : 1;
      if (n < min || n > 6) throw new EngineError(`squadron "${sq.name}": an escort squadron has ${min}–6 ships, not ${n}`);
    } else {
      if (types.size > 1) throw new EngineError(`squadron "${sq.name}": a capital squadron's ships are all one type`);
      if (n < 2) throw new EngineError(`squadron "${sq.name}": a capital squadron needs at least two ships`);
    }
  }
}

/** The config's squadrons in order of first appearance: ships of one owner sharing a name (T76). */
function squadronGroups(config: GameConfig): { owner: PlayerId; name: string; members: (GameConfig["ships"][number] & { index: number })[] }[] {
  const groups: { owner: PlayerId; name: string; members: (GameConfig["ships"][number] & { index: number })[] }[] = [];
  for (const [index, ship] of config.ships.entries()) {
    if (ship.squadron === undefined) continue;
    let g = groups.find((x) => x.owner === ship.owner && x.name === ship.squadron);
    if (g === undefined) groups.push((g = { owner: ship.owner, name: ship.squadron, members: [] }));
    g.members.push({ ...ship, index });
  }
  return groups;
}

/** The scenario block (state §4): Cruiser Clash's zones and 8 rounds, or The Bait's or Fleet Engagement's open-ended battle. */
function scenarioOf(config: GameConfig): Scenario {
  const forces = config.forces ?? { kind: "cruiser_clash" as const };
  if (config.scenario === "the_bait" && config.attacker !== undefined) {
    return { id: "the_bait", maxRounds: null, forces, scoring: "victory_points", attacker: config.attacker };
  }
  if (config.scenario === "raiders" && config.attacker !== undefined) {
    return { id: "raiders", maxRounds: 8, forces, scoring: "victory_points", attacker: config.attacker };
  }
  if (config.scenario === "fleet_engagement") {
    return { id: "fleet_engagement", maxRounds: null, forces, scoring: "victory_points" };
  }
  return {
    id: "cruiser_clash",
    maxRounds: 8,
    forces,
    scoring: config.scoring ?? "cruiser_clash",
    // Interpretation #6: 180 × 120 table, 90 × 30 zones centred on the long edges.
    deploymentZones: {
      A: { x: 45, y: 90, width: 90, height: 30 },
      B: { x: 45, y: 0, width: 90, height: 30 },
    },
    deploymentFacing: { A: 180, B: 0 },
  };
}

const baitPursued = (config: GameConfig): PlayerId | null =>
  config.scenario === "the_bait" ? (config.attacker === "p1" ? "p2" : "p1") : null;

const raidDefender = (config: GameConfig): PlayerId | null =>
  config.scenario === "raiders" ? (config.attacker === "p1" ? "p2" : "p1") : null;

/** Create a game at setup / roll_leadership (transform spec §5). */
export function newGame(config: GameConfig): GameState {
  validateConfig(config);

  const ships: Ship[] = config.ships.map((spec, i) => {
    const profile = cloneJson(shipProfile(spec, i)); // checked above
    const commander = spec.commander !== undefined ? buildCommander(spec.commander) : null;
    if (commander?.marks.includes("nurgle") === true) profile.hits += 1; // the Mark of Nurgle: +1 hit (state §7.4)
    const hasTorpedoes = profile.weapons.some((w) => w.kind === "torpedoes");
    const hasBays = profile.weapons.some((w) => w.kind === "launch_bay");
    return {
      id: `ship-${i + 1}`,
      owner: spec.owner,
      name: spec.name,
      profile,
      leadership: null,
      // The Bait's reinforcements, and every raider (state N60), start in reserve.
      status: spec.reserve === true || (config.scenario === "raiders" && spec.owner === config.attacker) ? "reserve" : "undeployed",
      position: null,
      heading: null,
      damage: 0,
      criticals: [],
      specialOrder: null,
      loaded: { ...(hasTorpedoes ? { torpedoes: true } : {}), ...(hasBays ? { launchBays: true } : {}) },
      lastMove: null,
      grapple: null,
      ...(commander !== null ? { commander } : {}),
    };
  });

  const squadrons: ShipSquadron[] = squadronGroups(config).map((g, k) => ({
    id: `sq-${ships.length + k + 1}`,
    owner: g.owner,
    name: g.name,
    type: g.members.every((m) => CATALOGUE[m.classId]?.profile.type === "escort") ? "escort" : "capital",
    shipIds: g.members.map((m) => `ship-${m.index + 1}`),
    disengaging: false,
  }));

  const player = (id: PlayerId) => {
    const p = config.players[id];
    return { id, name: p.name, faction: p.faction, factionTraits: { boardingModifier: boardingModifier(p.faction) } };
  };

  return {
    meta: {
      schemaVersion: 1,
      ruleset: "bfg-remastered-1.10",
      createdAt: config.createdAt,
      options: {
        ramming: config.options?.ramming ?? true,
        boarding: config.options?.boarding ?? false,
        carriers: config.options?.carriers ?? false,
        ...(config.options?.fleetLists === true ? { fleetLists: true } : {}),
      },
    },
    scenario: scenarioOf(config),
    table: {
      width: 180,
      height: 120,
      // A planet in the centre, its id after the ships' and squadrons' (transform §5, T107).
      ...(config.planet !== undefined
        ? { features: [{ kind: "planet" as const, id: `planet-${ships.length + squadrons.length + 1}`, position: { x: 90, y: 60 }, size: config.planet, ...PLANET_SIZES[config.planet] }] }
        : {}),
    },
    players: { p1: player("p1"), p2: player("p2") },
    setup: {
      leadershipRolled: false,
      zoneRoll: null,
      zones: null,
      deployOrderRolls: [],
      // The Bait: the bait deploys first and the fleeing ship goes first (state N55). The Raiders: the defender deploys, the raiders go first.
      firstDeployer: baitPursued(config) ?? raidDefender(config),
      firstTurnRolls: [],
      firstTurnChooser: null,
      firstPlayer: baitPursued(config) ?? (config.scenario === "raiders" ? (config.attacker ?? null) : null),
      ...(config.scenario === "fleet_engagement"
        ? { engagement: { formations: { p1: null, p2: null }, setupRolls: [], setupChooser: null, map: null, colours: null } }
        : {}),
      ...(config.scenario === "raiders" ? { raid: { facing: null, surpriseTurns: null } } : {}),
    },
    clock: { stage: "setup", setupStep: "roll_leadership", playerTurn: 0, phase: null, step: null },
    ships,
    ...(squadrons.length > 0 ? { squadrons } : {}),
    blastMarkers: [],
    ordnance: [],
    turnState: emptyTurnState(0, ships),
    activation: null,
    pending: [],
    queue: [],
    rng: createRng(config.seed),
    nextId: ships.length + squadrons.length + (config.planet !== undefined ? 1 : 0) + 1,
    log: [],
    result: null,
  };
}
