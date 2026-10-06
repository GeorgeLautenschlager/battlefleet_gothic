/**
 * The newGame factory (transform spec §5). Not a transform: there's no state
 * to validate against yet, so a bad config throws instead of returning a reason.
 */
import { boardingModifier, CATALOGUE, profileWithOptions } from "./catalogue";
import { EngineError } from "./derived";
import { cloneJson } from "./json";
import { createRng } from "./rng";
import type { FactionId, Forces, GameState, PlayerId, Scenario, ScenarioId, Scoring, Ship, ShipProfile, ShipTurnState, TurnState } from "./types";

export type GameConfig = {
  seed: number;
  createdAt: string;
  options?: { ramming?: boolean; boarding?: boolean; carriers?: boolean };
  /** Default: Cruiser Clash. Fleet Engagement needs points forces and victory points (transform §5). */
  scenario?: ScenarioId;
  /** Default: Cruiser Clash forces (state §4). */
  forces?: Forces;
  /** Default: Cruiser Clash scoring. */
  scoring?: Scoring;
  players: {
    p1: { name: string; faction: FactionId };
    p2: { name: string; faction: FactionId };
  };
  /** `options`: the class's option ids (transform §5, T57). */
  ships: { owner: PlayerId; name: string; classId: string; options?: string[] }[];
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
  if (forces.kind === "points" && (!Number.isInteger(forces.limit) || forces.limit <= 0)) {
    throw new EngineError(`a points limit must be a positive whole number, got ${forces.limit}`);
  }
  if (config.scenario === "fleet_engagement") {
    // "Equal points" and standard victory points (p. 142).
    if (forces.kind !== "points") throw new EngineError("Fleet Engagement is fought at a points limit");
    if (config.scoring !== undefined && config.scoring !== "victory_points") throw new EngineError("Fleet Engagement is scored with victory points");
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
    if (entry.profile.type !== "cruiser") {
      throw new EngineError(`ships[${i}]: Cruiser Clash allows cruisers only`);
    }
    if (entry.legacy === true && (ship.options ?? []).length > 0) throw new EngineError(`ships[${i}]: ${ship.classId} takes no options`);
    const profile = shipProfile(ship, i);
    points[ship.owner] += profile.points;
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

/** The scenario block (state §4): Cruiser Clash's zones and 8 rounds, or Fleet Engagement's maps and no round limit. */
function scenarioOf(config: GameConfig): Scenario {
  const forces = config.forces ?? { kind: "cruiser_clash" as const };
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

/** Create a game at setup / roll_leadership (transform spec §5). */
export function newGame(config: GameConfig): GameState {
  validateConfig(config);

  const ships: Ship[] = config.ships.map((spec, i) => {
    const profile = cloneJson(shipProfile(spec, i)); // checked above
    const hasTorpedoes = profile.weapons.some((w) => w.kind === "torpedoes");
    const hasBays = profile.weapons.some((w) => w.kind === "launch_bay");
    return {
      id: `ship-${i + 1}`,
      owner: spec.owner,
      name: spec.name,
      profile,
      leadership: null,
      status: "undeployed",
      position: null,
      heading: null,
      damage: 0,
      criticals: [],
      specialOrder: null,
      loaded: { ...(hasTorpedoes ? { torpedoes: true } : {}), ...(hasBays ? { launchBays: true } : {}) },
      lastMove: null,
      grapple: null,
    };
  });

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
      },
    },
    scenario: scenarioOf(config),
    table: { width: 180, height: 120 },
    players: { p1: player("p1"), p2: player("p2") },
    setup: {
      leadershipRolled: false,
      zoneRoll: null,
      zones: null,
      deployOrderRolls: [],
      firstDeployer: null,
      firstTurnRolls: [],
      firstTurnChooser: null,
      firstPlayer: null,
      ...(config.scenario === "fleet_engagement"
        ? { engagement: { formations: { p1: null, p2: null }, setupRolls: [], setupChooser: null, map: null, colours: null } }
        : {}),
    },
    clock: { stage: "setup", setupStep: "roll_leadership", playerTurn: 0, phase: null, step: null },
    ships,
    blastMarkers: [],
    ordnance: [],
    turnState: emptyTurnState(0, ships),
    activation: null,
    pending: [],
    queue: [],
    rng: createRng(config.seed),
    nextId: ships.length + 1,
    log: [],
    result: null,
  };
}
