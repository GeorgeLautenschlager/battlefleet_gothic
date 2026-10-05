/** Phase 1's only matchup, as the app builds it: p1 is the Imperial Lunar, p2 the Chaos Murder. */
import type { GameConfig, PlayerId } from "@bfg/engine";

export type SeatNames = Record<PlayerId, { name: string; shipName: string }>;

export function cruiserClash(seats: SeatNames, seed: number, createdAt: string): GameConfig {
  return {
    seed,
    createdAt,
    players: {
      p1: { name: seats.p1.name, faction: "imperial_navy" },
      p2: { name: seats.p2.name, faction: "chaos" },
    },
    ships: [
      { owner: "p1", name: seats.p1.shipName, classId: "lunar" },
      { owner: "p2", name: seats.p2.shipName, classId: "murder" },
    ],
  };
}
