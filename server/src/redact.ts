/** Hiding the dice (spec §5, W2): no seed or RNG state leaves the server before the game ends. */
import { cloneJson, type GameConfig, type GameState } from "@bfg/engine";

export function redactState(state: GameState): GameState {
  const out = cloneJson(state);
  out.rng = { ...out.rng, seed: 0, state: 0 };
  return out;
}

export function redactConfig(config: GameConfig): GameConfig {
  return { ...cloneJson(config), seed: 0 };
}
