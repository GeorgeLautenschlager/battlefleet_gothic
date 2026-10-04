/** Test helpers: spec examples, seeded sampling, and states at interesting moments. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GameState } from "../src/state/types";
import { newGame, type GameConfig } from "../src/state/newGame";
import { cloneJson } from "../src/state/json";

/** The ```json blocks of a spec file, parsed, in document order. */
export function specJsonBlocks(relativePath: string): unknown[] {
  const path = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? "") as unknown);
}

/** game_state/SPEC.md §14: the full start-of-round-1 example state. */
export function specExampleState(): GameState {
  const [full] = specJsonBlocks("game_state/SPEC.md");
  return full as GameState;
}

/** Tiny seeded LCG for sampling test inputs (not the game RNG). */
export function sampler(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

export const LUNAR_VS_MURDER: GameConfig = {
  seed: 1337,
  createdAt: "2026-10-04T12:00:00Z",
  players: {
    p1: { name: "George", faction: "imperial_navy" },
    p2: { name: "Also George", faction: "chaos" },
  },
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    { owner: "p2", name: "Unclean", classId: "murder" },
  ],
};

export const freshGame = (): GameState => newGame(cloneJson(LUNAR_VS_MURDER));
