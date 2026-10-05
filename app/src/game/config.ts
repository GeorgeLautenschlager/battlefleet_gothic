/**
 * New hot-seat games: Cruiser Clash (p. 128), 1–4 cruisers a side, the same
 * number each, from either fleet. Mirror matches are fine.
 */
import { CATALOGUE, type FactionId, type GameConfig, type PlayerId } from "@bfg/engine";

export type Fleet = "imperial_navy" | "chaos";

export const FLEETS: Record<Fleet, { name: string; classId: string; names: string[] }> = {
  imperial_navy: {
    name: "Imperial Navy",
    classId: "lunar",
    names: ["Agrippa", "Hammer of Terra", "Sanctus Vigil", "Lord Valdane", "Righteous Fury", "Saint Kasimir", "Iron Litany", "Gothic Dawn"],
  },
  chaos: {
    name: "Chaos",
    classId: "murder",
    names: ["Unclean", "Carrion Hymn", "Woe Eternal", "Flayed Saint", "Hungering Dark", "Ninth Wound", "Red Lament", "Sorrowmaw"],
  },
};

export const MAX_SHIPS = 4;

export type Side = { name: string; fleet: Fleet; ships: string[] };
export type NewGameOptions = { p1: Side; p2: Side; ramming: boolean; seed?: number };

/** Default ship names. In a mirror match p2 takes the second half of the list, so no name repeats. */
export function defaultNames(fleet: Fleet, n: number, mirrorP2 = false): string[] {
  const names = FLEETS[fleet].names;
  const offset = mirrorP2 ? MAX_SHIPS : 0;
  return Array.from({ length: n }, (_, i) => names[offset + i] ?? `${FLEETS[fleet].name} ${offset + i + 1}`);
}

export function shipClass(fleet: Fleet) {
  const entry = CATALOGUE[FLEETS[fleet].classId];
  if (entry === undefined) throw new Error(`no ${FLEETS[fleet].classId} in the catalogue`);
  return entry.profile;
}

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  const ships = (owner: PlayerId) => options[owner].ships.map((name) => ({ owner, name: name.trim(), classId: FLEETS[options[owner].fleet].classId }));
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    options: { ramming: options.ramming },
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
