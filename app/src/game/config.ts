/**
 * New hot-seat games: Cruiser Clash (p. 128), 1–4 cruisers a side, the same
 * number each, from either fleet, each ship of any of its fleet's cruiser
 * classes. Mirror matches are fine. With the carriers option (p. 129), a
 * side may also field its fleet's carrier.
 */
import { CATALOGUE, commanderPoints, newGame, profileWithOptions, type CommanderConfig, type FactionId, type Mark, type Forces, type GameConfig, type PlanetSize, type PlayerId, type ScenarioId, type Scoring } from "@bfg/engine";

export type Fleet = "imperial_navy" | "chaos";

/** `classId`: the fleet's standard cruiser; `classes`: every cruiser class it can field, carrier aside (those over 185 pts only in a points battle). */
export const FLEETS: Record<Fleet, { name: string; classId: string; classes: string[]; carrierClassId: string; names: string[] }> = {
  imperial_navy: {
    name: "Imperial Navy",
    classId: "lunar",
    classes: ["lunar", "gothic", "tyrant", "dominator", "dauntless", "mars", "overlord", "emperor", "retribution", "firestorm", "sword", "cobra"],
    carrierClassId: "dictator",
    names: ["Agrippa", "Hammer of Terra", "Sanctus Vigil", "Lord Valdane", "Righteous Fury", "Saint Kasimir", "Iron Litany", "Gothic Dawn"],
  },
  chaos: {
    name: "Chaos",
    classId: "murder",
    classes: ["murder", "murder_lances", "carnage", "inferno", "slaughter", "styx", "hecate", "hades", "acheron", "repulsive", "chaos_battle_barge", "despoiler", "desolator", "idolator", "infidel", "iconoclast"],
    carrierClassId: "devastation",
    names: ["Unclean", "Carrion Hymn", "Woe Eternal", "Flayed Saint", "Hungering Dark", "Ninth Wound", "Red Lament", "Sorrowmaw"],
  },
};

export const MAX_SHIPS = 4;
/** Ships a side in a points battle: the app's limit (the engine has none). */
export const MAX_POINTS_SHIPS = 16;
export const POINTS_LIMITS = [500, 750, 1000, 1500] as const;

/**
 * `classes[i]`: ship i's class; missing means the fleet's standard cruiser. `options[i]`: its option ids (T57).
 * `command`: commanders, with fleet lists. `squadrons[i]`: its squadron's name, "" for none (T76).
 */
export type Side = { name: string; fleet: Fleet; ships: string[]; classes?: string[]; options?: string[][]; command?: Command | undefined; squadrons?: string[]; reserves?: boolean[] };

/** An escort left without a squadron name joins this one (every escort is in a squadron, T76). */
export const DEFAULT_ESCORT_SQUADRON = "Escorts";

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
  /** The Bait: the pursuers (state N47); the other player is pursued and fields the bait and its reinforcements. */
  attacker?: PlayerId;
  /** A planet in the table centre (transform T107). */
  planet?: PlanetSize;
  seed?: number;
};

/** The Bait's pursued player, who fields reinforcements (T93), or null in any other battle. */
export const pursuedOf = (o: Pick<NewGameOptions, "scenario" | "attacker">): PlayerId | null =>
  o.scenario === "the_bait" ? (o.attacker === "p1" ? "p2" : "p1") : null;

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
  // Cruiser Clash: cruisers only (p. 128), within the cap; escorts and battleships wait for a points battle.
  const cruisers = FLEETS[fleet].classes.filter((id) => points || (cheapest(id) <= CRUISER_CLASH_CAP && CATALOGUE[id]?.profile.type === "cruiser"));
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

/** Each ship's options, keeping only those its (current) class has, and the first of any group (state N33). */
export const optionIds = (side: Side, carriers: boolean, points = false): string[][] => {
  const classes = classIds(side, carriers, points);
  return side.ships.map((_, i) => {
    const offered = CATALOGUE[classes[i] ?? ""]?.options ?? [];
    const groups = new Set<string>();
    return (side.options?.[i] ?? []).filter((id) => {
      const o = offered.find((x) => x.id === id);
      if (o === undefined) return false;
      if (o.group === undefined) return true;
      if (groups.has(o.group)) return false;
      groups.add(o.group);
      return true;
    });
  });
};

/** Ticking an option drops any other in its group: they replace the same weapons (state N33). */
export function withOption(classId: string, chosen: readonly string[], id: string, on: boolean): string[] {
  const rest = chosen.filter((x) => x !== id);
  if (!on) return rest;
  const offered = CATALOGUE[classId]?.options ?? [];
  const group = offered.find((o) => o.id === id)?.group;
  return [...rest.filter((x) => group === undefined || offered.find((o) => o.id === x)?.group !== group), id];
}

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

/** Each ship's squadron name, "" for none: points battles only (state N45); an unnamed escort joins the default squadron. */
export function squadronNames(side: Side, carriers: boolean, points = false): string[] {
  const classes = classIds(side, carriers, points);
  return side.ships.map((_, i) => {
    if (!points) return "";
    const name = (side.squadrons?.[i] ?? "").trim();
    return name === "" && CATALOGUE[classes[i] ?? ""]?.profile.type === "escort" ? DEFAULT_ESCORT_SQUADRON : name;
  });
}

/** A side's ships as `{ name, classId, options?, commander?, squadron?, reserve? }`: the online protocol's shape. Commanders only with fleet lists; reinforcements only for The Bait's pursued side. */
export const shipEntries = (
  side: Side,
  carriers = false,
  points = false,
  lists = false,
  reserves = false,
): { name: string; classId: string; options?: string[]; commander?: CommanderConfig; squadron?: string; reserve?: boolean }[] => {
  const classes = classIds(side, carriers, points);
  const options = optionIds(side, carriers, points);
  const command = lists ? commanders(side, carriers, points) : [];
  const squadrons = squadronNames(side, carriers, points);
  return side.ships.map((name, i) => ({
    name: name.trim(),
    classId: classes[i] ?? FLEETS[side.fleet].classId,
    ...((options[i] ?? []).length > 0 ? { options: options[i] } : {}),
    ...(command[i] !== undefined ? { commander: command[i] } : {}),
    ...((squadrons[i] ?? "") !== "" ? { squadron: squadrons[i] } : {}),
    ...(reserves && side.reserves?.[i] === true ? { reserve: true } : {}),
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

/** The side's part in a scenario with an attacker and a defender (The Bait, The Raiders). */
export type Role = { scenario: "the_bait" | "raiders"; defender: boolean };

/** This seat's role, if the scenario has them: `attacker` is the attacking seat. */
export const roleOf = (scenario: ScenarioId | undefined, attacker: PlayerId | undefined, seat: PlayerId): Role | undefined =>
  scenario === "the_bait" || scenario === "raiders" ? { scenario, defender: (attacker ?? "p2") !== seat } : undefined;

/**
 * Why one side's fleet can't play, tried against a mirror of itself (as the server checks it), or null.
 * `role`: The Bait or The Raiders; it plays its part against a lone cruiser of its fleet instead, as the server does (T93, T100).
 */
export function sideProblem(side: Side, carriers: boolean, forces?: Forces, fleetLists = false, role?: Role): string | null {
  if (role === undefined) {
    return configProblem({ p1: side, p2: { ...side, ships: side.ships.map((_, i) => `mirror ${i}`) }, ramming: true, boarding: false, carriers, fleetLists, ...(forces ? { forces } : {}) });
  }
  const standIn: Side = { name: "Stand-in", fleet: side.fleet, ships: ["(stand-in)"], classes: [FLEETS[side.fleet].classId] };
  return configProblem({ p1: side, p2: standIn, ramming: true, boarding: false, carriers, fleetLists, scenario: role.scenario, attacker: role.defender ? "p2" : "p1", ...(forces ? { forces } : {}) });
}

/** The app's fleets are the boxed game's two; anything else reads as Imperial. */
export const asFleet = (faction: string | null): Fleet => (faction === "chaos" ? "chaos" : "imperial_navy");

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  const carriers = options.carriers ?? false;
  const lists = listsOn(options);
  const pursued = pursuedOf(options);
  const ships = (owner: PlayerId) =>
    shipEntries(options[owner], carriersAllowed(options), options.forces?.kind === "points", lists, owner === pursued).map((s) => ({ owner, ...s }));
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    options: { ramming: options.ramming, boarding: options.boarding, carriers, ...(lists ? { fleetLists: true } : {}) },
    ...(options.scenario !== undefined ? { scenario: options.scenario } : {}),
    ...(options.forces !== undefined ? { forces: options.forces } : {}),
    ...(options.scoring !== undefined ? { scoring: options.scoring } : {}),
    ...(options.scenario === "the_bait" || options.scenario === "raiders" ? { attacker: options.attacker ?? "p2" } : {}),
    ...(options.planet !== undefined ? { planet: options.planet } : {}),
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
