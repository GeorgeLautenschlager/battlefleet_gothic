import type { GameState, PlayerId } from "@bfg/engine";

export const playerName = (state: GameState, p: PlayerId): string => state.players[p].name;

/** CSS class carrying the player's colour. */
export const playerClass = (p: PlayerId): string => (p === "p1" ? "p1" : "p2");
