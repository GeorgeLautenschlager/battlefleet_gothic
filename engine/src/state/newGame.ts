/**
 * The newGame factory (transform spec §5). Not a transform: there's no state
 * to validate against yet, so a bad config throws instead of returning a reason.
 */
import { boardingModifier, CATALOGUE } from "./catalogue";
import { EngineError } from "./derived";
import { cloneJson } from "./json";
import { createRng } from "./rng";
import type { FactionId, GameState, PlayerId, Ship, ShipTurnState, TurnState } from "./types";

export type GameConfig = {
  seed: number;
  createdAt: string;
  options?: { ramming?: boolean; boarding?: boolean; carriers?: boolean };
  players: {
    p1: { name: string; faction: FactionId };
    p2: { name: string; faction: FactionId };
  };
  ships: { owner: PlayerId; name: string; classId: string }[];
};

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
  const counts = { p1: 0, p2: 0 };
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
    if (entry.profile.points > CRUISER_CLASH.maxPoints) {
      // "One carrier each" (p. 129): a ship with launch bays may go over the cap, one per side.
      const carrier = entry.profile.weapons.some((w) => w.kind === "launch_bay");
      if (!carriers || !carrier) {
        throw new EngineError(`ships[${i}]: ${entry.profile.points} pts exceeds the ${CRUISER_CLASH.maxPoints} pt cap`);
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
    const side = config.ships.filter((s) => s.owner === player).map((s) => CATALOGUE[s.classId]);
    const points = side.reduce((n, e) => n + (e?.profile.points ?? 0), 0);
    for (const entry of new Set(side)) {
      if (entry?.limit === undefined) continue;
      const allowed = entry.limit.max * Math.ceil(points / entry.limit.perPoints);
      const n = side.filter((e) => e === entry).length;
      if (n > allowed) throw new EngineError(`${player} may field at most ${allowed} × ${entry.profile.className} in ${points} pts`);
    }
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

/** Create a Cruiser Clash game at setup / roll_leadership (transform spec §5). */
export function newGame(config: GameConfig): GameState {
  validateConfig(config);

  const ships: Ship[] = config.ships.map((spec, i) => {
    const entry = CATALOGUE[spec.classId];
    if (entry === undefined) throw new EngineError(`unknown class ${spec.classId}`); // checked above
    const profile = cloneJson(entry.profile);
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
    scenario: {
      id: "cruiser_clash",
      maxRounds: 8,
      scoring: "cruiser_clash",
      // Interpretation #6: 180 × 120 table, 90 × 30 zones centred on the long edges.
      deploymentZones: {
        A: { x: 45, y: 90, width: 90, height: 30 },
        B: { x: 45, y: 0, width: 90, height: 30 },
      },
      deploymentFacing: { A: 180, B: 0 },
    },
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
