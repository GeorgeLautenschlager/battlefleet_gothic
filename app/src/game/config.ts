/**
 * New hot-seat games: Cruiser Clash (p. 128), 1–4 cruisers a side, the same
 * number each, from either fleet. Mirror matches are fine. With the carriers
 * option (p. 129), each side's first ship may be its fleet's carrier.
 */
import { CATALOGUE, type FactionId, type GameConfig, type PlayerId } from "@bfg/engine";

export type Fleet = "imperial_navy" | "chaos";

export const FLEETS: Record<Fleet, { name: string; classId: string; carrierClassId: string; names: string[] }> = {
  imperial_navy: {
    name: "Imperial Navy",
    classId: "lunar",
    carrierClassId: "dictator",
    names: ["Agrippa", "Hammer of Terra", "Sanctus Vigil", "Lord Valdane", "Righteous Fury", "Saint Kasimir", "Iron Litany", "Gothic Dawn"],
  },
  chaos: {
    name: "Chaos",
    classId: "murder",
    carrierClassId: "devastation",
    names: ["Unclean", "Carrion Hymn", "Woe Eternal", "Flayed Saint", "Hungering Dark", "Ninth Wound", "Red Lament", "Sorrowmaw"],
  },
};

export const MAX_SHIPS = 4;

/** `carrier`: the first ship is the fleet's carrier, when the game allows carriers. */
export type Side = { name: string; fleet: Fleet; ships: string[]; carrier?: boolean };
export type NewGameOptions = { p1: Side; p2: Side; ramming: boolean; boarding: boolean; carriers?: boolean; seed?: number };

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
export const carrierClass = (fleet: Fleet) => profileOf(FLEETS[fleet].carrierClassId);

/** The class of each of a side's ships: the carrier first, if it brings one. */
export const classIds = (side: Side, carriers: boolean): string[] =>
  side.ships.map((_, i) => (i === 0 && carriers && side.carrier === true ? FLEETS[side.fleet].carrierClassId : FLEETS[side.fleet].classId));

/** A side's ships as `{ name, classId }`: the online protocol's shape. */
export const shipEntries = (side: Side, carriers = false): { name: string; classId: string }[] => {
  const classes = classIds(side, carriers);
  return side.ships.map((name, i) => ({ name: name.trim(), classId: classes[i] ?? FLEETS[side.fleet].classId }));
};

/** The app's fleets are the boxed game's two; anything else reads as Imperial. */
export const asFleet = (faction: string | null): Fleet => (faction === "chaos" ? "chaos" : "imperial_navy");

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  const carriers = options.carriers ?? false;
  const ships = (owner: PlayerId) => shipEntries(options[owner], carriers).map((s) => ({ owner, ...s }));
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    options: { ramming: options.ramming, boarding: options.boarding, carriers },
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
