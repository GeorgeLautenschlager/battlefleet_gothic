/**
 * New hot-seat games: Cruiser Clash (p. 128), 1–4 cruisers a side, the same
 * number each, from either fleet, each ship of any of its fleet's cruiser
 * classes. Mirror matches are fine. With the carriers option (p. 129), a
 * side may also field its fleet's carrier.
 */
import { CATALOGUE, newGame, type FactionId, type Forces, type GameConfig, type PlayerId, type ScenarioId, type Scoring } from "@bfg/engine";

export type Fleet = "imperial_navy" | "chaos";

/** `classId`: the fleet's standard cruiser; `classes`: every cruiser class it can field, carrier aside (those over 185 pts only in a points battle). */
export const FLEETS: Record<Fleet, { name: string; classId: string; classes: string[]; carrierClassId: string; names: string[] }> = {
  imperial_navy: {
    name: "Imperial Navy",
    classId: "lunar",
    classes: ["lunar", "gothic", "tyrant", "dominator_long", "dominator", "lunar_nova", "tyrant_long", "tyrant_nova", "tyrant_long_nova"],
    carrierClassId: "dictator",
    names: ["Agrippa", "Hammer of Terra", "Sanctus Vigil", "Lord Valdane", "Righteous Fury", "Saint Kasimir", "Iron Litany", "Gothic Dawn"],
  },
  chaos: {
    name: "Chaos",
    classId: "murder",
    classes: ["murder", "murder_lances", "carnage", "inferno", "slaughter"],
    carrierClassId: "devastation",
    names: ["Unclean", "Carrion Hymn", "Woe Eternal", "Flayed Saint", "Hungering Dark", "Ninth Wound", "Red Lament", "Sorrowmaw"],
  },
};

export const MAX_SHIPS = 4;
/** Ships a side in a points battle: the app's limit (the engine has none). */
export const MAX_POINTS_SHIPS = 8;
export const POINTS_LIMITS = [500, 750, 1000, 1500] as const;

/** `classes[i]`: ship i's class; missing means the fleet's standard cruiser. */
export type Side = { name: string; fleet: Fleet; ships: string[]; classes?: string[] };
/** `scenario`/`forces`/`scoring`: absent means classic Cruiser Clash (transform §5). Fleet Engagement is points and victory points. */
export type NewGameOptions = { p1: Side; p2: Side; ramming: boolean; boarding: boolean; carriers?: boolean; scenario?: ScenarioId; forces?: Forces; scoring?: Scoring; seed?: number };

/** A points battle has no per-ship cap, so carriers are always allowed there (T36). */
export const carriersAllowed = (o: Pick<NewGameOptions, "carriers" | "forces">): boolean => o.forces?.kind === "points" || o.carriers === true;

/** Default ship names. In a mirror match p2 takes the second half of the list, so no name repeats. */
export function defaultNames(fleet: Fleet, n: number, mirrorP2 = false): string[] {
  const names = FLEETS[fleet].names;
  const offset = mirrorP2 ? MAX_SHIPS : 0;
  return Array.from({ length: n }, (_, i) => names[offset + i] ?? `${FLEETS[fleet].name} ${offset + i + 1}`);
}

export function profileOf(classId: string) {
  const entry = CATALOGUE[classId];
  if (entry === undefined) throw new Error(`no ${classId} in the catalogue`);
  return entry.profile;
}

export const shipClass = (fleet: Fleet) => profileOf(FLEETS[fleet].classId);

/** Cruiser Clash's cap per ship (p. 128). Options over it (nova cannons, 45 cm Tyrant batteries) wait for a points battle. */
export const CRUISER_CLASH_CAP = 185;

/**
 * The classes a ship of this fleet may be: its cruisers (in Cruiser Clash, only
 * those within the 185-point cap), and its carrier when the game allows one.
 */
export const classChoices = (fleet: Fleet, carriers: boolean, points = false): string[] => {
  const cruisers = FLEETS[fleet].classes.filter((id) => points || profileOf(id).points <= CRUISER_CLASH_CAP);
  return carriers ? [...cruisers, FLEETS[fleet].carrierClassId] : cruisers;
};

/** The class of each of a side's ships. One picked before the rules changed (a carrier, a nova cannon) reads as the standard cruiser. */
export const classIds = (side: Side, carriers: boolean, points = false): string[] => {
  const allowed = classChoices(side.fleet, carriers, points);
  return side.ships.map((_, i) => {
    const picked = side.classes?.[i];
    return picked !== undefined && allowed.includes(picked) ? picked : FLEETS[side.fleet].classId;
  });
};

/** A side's ships as `{ name, classId }`: the online protocol's shape. */
export const shipEntries = (side: Side, carriers = false, points = false): { name: string; classId: string }[] => {
  const classes = classIds(side, carriers, points);
  return side.ships.map((name, i) => ({ name: name.trim(), classId: classes[i] ?? FLEETS[side.fleet].classId }));
};

/** Why the engine won't start this game (e.g. two carriers a side, too many lance Murders), or null. */
export function configProblem(options: NewGameOptions): string | null {
  try {
    newGame(cruiserClash({ ...options, seed: 1 }, new Date(0)));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Why one side's fleet can't play, tried against a mirror of itself (as the server checks it), or null. */
export const sideProblem = (side: Side, carriers: boolean, forces?: Forces): string | null =>
  configProblem({ p1: side, p2: { ...side, ships: side.ships.map((_, i) => `mirror ${i}`) }, ramming: true, boarding: false, carriers, ...(forces ? { forces } : {}) });

/** The app's fleets are the boxed game's two; anything else reads as Imperial. */
export const asFleet = (faction: string | null): Fleet => (faction === "chaos" ? "chaos" : "imperial_navy");

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  const carriers = options.carriers ?? false;
  const ships = (owner: PlayerId) => shipEntries(options[owner], carriersAllowed(options), options.forces?.kind === "points").map((s) => ({ owner, ...s }));
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    options: { ramming: options.ramming, boarding: options.boarding, carriers },
    ...(options.scenario !== undefined ? { scenario: options.scenario } : {}),
    ...(options.forces !== undefined ? { forces: options.forces } : {}),
    ...(options.scoring !== undefined ? { scoring: options.scoring } : {}),
    players: {
      p1: { name: options.p1.name.trim(), faction: options.p1.fleet satisfies FactionId },
      p2: { name: options.p2.name.trim(), faction: options.p2.fleet satisfies FactionId },
    },
    ships: [...ships("p1"), ...ships("p2")],
  };
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1;
}
