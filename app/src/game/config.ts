/**
 * New hot-seat games: Cruiser Clash (p. 128), 1–4 cruisers a side, the same
 * number each, from either fleet, each ship of any of its fleet's cruiser
 * classes. Mirror matches are fine. With the carriers option (p. 129), a
 * side may also field its fleet's carrier.
 */
import { CATALOGUE, commanderPoints, newGame, profileWithOptions, type CommanderConfig, type FactionId, type Mark, type Forces, type GameConfig, type PlayerId, type ScenarioId, type Scoring } from "@bfg/engine";

export type Fleet = "imperial_navy" | "chaos";

/** `classId`: the fleet's standard cruiser; `classes`: every cruiser class it can field, carrier aside (those over 185 pts only in a points battle). */
export const FLEETS: Record<Fleet, { name: string; classId: string; classes: string[]; carrierClassId: string; names: string[] }> = {
  imperial_navy: {
    name: "Imperial Navy",
    classId: "lunar",
    classes: ["lunar", "gothic", "tyrant", "dominator", "mars", "overlord"],
    carrierClassId: "dictator",
    names: ["Agrippa", "Hammer of Terra", "Sanctus Vigil", "Lord Valdane", "Righteous Fury", "Saint Kasimir", "Iron Litany", "Gothic Dawn"],
  },
  chaos: {
    name: "Chaos",
    classId: "murder",
    classes: ["murder", "murder_lances", "carnage", "inferno", "slaughter", "styx", "hecate", "hades", "acheron"],
    carrierClassId: "devastation",
    names: ["Unclean", "Carrion Hymn", "Woe Eternal", "Flayed Saint", "Hungering Dark", "Ninth Wound", "Red Lament", "Sorrowmaw"],
  },
};

export const MAX_SHIPS = 4;
/** Ships a side in a points battle: the app's limit (the engine has none). */
export const MAX_POINTS_SHIPS = 8;
export const POINTS_LIMITS = [500, 750, 1000, 1500] as const;

/** `classes[i]`: ship i's class; missing means the fleet's standard cruiser. `options[i]`: its option ids (T57). `command`: commanders, with fleet lists. */
export type Side = { name: string; fleet: Fleet; ships: string[]; classes?: string[]; options?: string[][]; command?: Command | undefined };

/**
 * A side's commanders (transform §5, T60). `fleet`: the Admiral or Warmaster, or
 * none; `flagship`: the Admiral's ship (a Warmaster always takes the most
 * expensive); `lords`: Chaos Lords, by ship.
 */
export type Command = { fleet: CommanderConfig | null; flagship: number; lords: { ship: number; mark: Mark | null }[] };

/** Chaos Incursion always has its Warmaster (p. 232); an Imperial fleet starts without an Admiral. */
export const defaultCommand = (fleet: Fleet): Command =>
  fleet === "chaos" ? { fleet: { kind: "warmaster", leadership: 8, marks: [] }, flagship: 0, lords: [] } : { fleet: null, flagship: 0, lords: [] };
/**
 * `scenario`/`forces`/`scoring`: absent means classic Cruiser Clash (transform §5). Fleet Engagement is points and victory points.
 * `fleetLists`: points battles follow the fleet lists, with commanders (T58).
 */
export type NewGameOptions = {
  p1: Side;
  p2: Side;
  ramming: boolean;
  boarding: boolean;
  carriers?: boolean;
  fleetLists?: boolean;
  scenario?: ScenarioId;
  forces?: Forces;
  scoring?: Scoring;
  seed?: number;
};

/** Fleet lists apply to points battles only (T58). */
export const listsOn = (o: Pick<NewGameOptions, "fleetLists" | "forces">): boolean => o.forces?.kind === "points" && o.fleetLists === true;

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
  const cruisers = FLEETS[fleet].classes.filter((id) => points || cheapest(id) <= CRUISER_CLASH_CAP);
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

/** A class at its cheapest: with any options that cost less (the Dominator's original batteries). */
function cheapest(classId: string): number {
  const entry = CATALOGUE[classId];
  return (entry?.profile.points ?? 0) + (entry?.options ?? []).reduce((n, o) => n + Math.min(0, o.points), 0);
}

/** Each ship's options, keeping only those its (current) class has. */
export const optionIds = (side: Side, carriers: boolean, points = false): string[][] => {
  const classes = classIds(side, carriers, points);
  return side.ships.map((_, i) => {
    const offered = CATALOGUE[classes[i] ?? ""]?.options ?? [];
    return (side.options?.[i] ?? []).filter((id) => offered.some((o) => o.id === id));
  });
};

/** Ship i's profile as it would be fielded: its class with its options. */
export const shipProfileOf = (side: Side, i: number, carriers: boolean, points = false) =>
  profileWithOptions(classIds(side, carriers, points)[i] ?? FLEETS[side.fleet].classId, optionIds(side, carriers, points)[i] ?? []);

/** The most expensive ship (with its options): where a Warmaster goes (p. 232). The first on a tie. */
export function mostExpensive(side: Side, carriers: boolean, points = false): number {
  const values = side.ships.map((_, i) => shipProfileOf(side, i, carriers, points).points);
  return values.indexOf(Math.max(...values));
}

/** Each ship's commander, if any, from the side's command (lists only). A Lord on the fleet commander's ship, or a second on one ship, is dropped. */
export function commanders(side: Side, carriers: boolean, points = false): (CommanderConfig | undefined)[] {
  const out: (CommanderConfig | undefined)[] = side.ships.map(() => undefined);
  const command = side.command ?? defaultCommand(side.fleet);
  if (command.fleet !== null) {
    const at = command.fleet.kind === "warmaster" ? mostExpensive(side, carriers, points) : Math.min(command.flagship, side.ships.length - 1);
    out[at] = command.fleet;
  }
  for (const lord of command.lords) {
    if (lord.ship < out.length && out[lord.ship] === undefined) out[lord.ship] = { kind: "lord", mark: lord.mark };
  }
  return out;
}

/** What the side's commanders cost. */
export const commandPoints = (side: Side, carriers: boolean, points = false): number =>
  commanders(side, carriers, points).reduce((n, c) => n + (c !== undefined ? commanderPoints(c) : 0), 0);

/** A side's ships as `{ name, classId, options?, commander? }`: the online protocol's shape. Commanders only with fleet lists. */
export const shipEntries = (
  side: Side,
  carriers = false,
  points = false,
  lists = false,
): { name: string; classId: string; options?: string[]; commander?: CommanderConfig }[] => {
  const classes = classIds(side, carriers, points);
  const options = optionIds(side, carriers, points);
  const command = lists ? commanders(side, carriers, points) : [];
  return side.ships.map((name, i) => ({
    name: name.trim(),
    classId: classes[i] ?? FLEETS[side.fleet].classId,
    ...((options[i] ?? []).length > 0 ? { options: options[i] } : {}),
    ...(command[i] !== undefined ? { commander: command[i] } : {}),
  }));
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
export const sideProblem = (side: Side, carriers: boolean, forces?: Forces, fleetLists = false): string | null =>
  configProblem({ p1: side, p2: { ...side, ships: side.ships.map((_, i) => `mirror ${i}`) }, ramming: true, boarding: false, carriers, fleetLists, ...(forces ? { forces } : {}) });

/** The app's fleets are the boxed game's two; anything else reads as Imperial. */
export const asFleet = (faction: string | null): Fleet => (faction === "chaos" ? "chaos" : "imperial_navy");

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  const carriers = options.carriers ?? false;
  const lists = listsOn(options);
  const ships = (owner: PlayerId) => shipEntries(options[owner], carriersAllowed(options), options.forces?.kind === "points", lists).map((s) => ({ owner, ...s }));
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    options: { ramming: options.ramming, boarding: options.boarding, carriers, ...(lists ? { fleetLists: true } : {}) },
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
