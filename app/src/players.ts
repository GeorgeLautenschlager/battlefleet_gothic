import type { FactionId, GameState, PlayerId } from "@bfg/engine";

export const playerName = (state: GameState, p: PlayerId): string => state.players[p].name;

const FACTIONS: Partial<Record<FactionId, string>> = { imperial_navy: "Imperial Navy", chaos: "Chaos" };

export const factionName = (f: FactionId): string => FACTIONS[f] ?? f.replaceAll("_", " ");

/** CSS class carrying the player's colour. */
export const playerClass = (p: PlayerId): string => (p === "p1" ? "p1" : "p2");
