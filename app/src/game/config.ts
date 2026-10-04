/** Phase 1's only matchup: Cruiser Clash, one Lunar against one Murder. */
import type { GameConfig } from "@bfg/engine";

export type NewGameOptions = { p1Name: string; p2Name: string; p1Ship: string; p2Ship: string; seed?: number };

export function cruiserClash(options: NewGameOptions, now = new Date()): GameConfig {
  return {
    seed: options.seed ?? randomSeed(),
    createdAt: now.toISOString(),
    players: {
      p1: { name: options.p1Name, faction: "imperial_navy" },
      p2: { name: options.p2Name, faction: "chaos" },
    },
    ships: [
      { owner: "p1", name: options.p1Ship, classId: "lunar" },
      { owner: "p2", name: options.p2Ship, classId: "murder" },
    ],
  };
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1;
}
