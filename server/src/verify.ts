/**
 * End-of-game verification (spec §5, W5): replay the revealed config and
 * transforms with the local engine and check they reach the state the server
 * sent. A mismatch means a server bug or tampering.
 */
import { newGame, reduce, validate, type GameConfig, type GameState, type Transform } from "@bfg/engine";
import { redactState } from "./redact";

export function replay(config: GameConfig, transforms: readonly Transform[]): GameState {
  let state = newGame(config);
  for (const [i, t] of transforms.entries()) {
    const v = validate(state, t);
    if (!v.ok) throw new Error(`transform ${i + 1} doesn't apply: ${v.reason.code}`);
    state = reduce(state, t);
  }
  return state;
}

export type Verification = { ok: true } | { ok: false; problem: string };

export function verifyEnded(ended: { config: GameConfig; transforms: Transform[] }, finalState: GameState): Verification {
  let replayed: GameState;
  try {
    replayed = replay(ended.config, ended.transforms);
  } catch (e) {
    return { ok: false, problem: (e as Error).message };
  }
  if (JSON.stringify(redactState(replayed)) !== JSON.stringify(redactState(finalState))) {
    return { ok: false, problem: "the replayed game doesn't match the state the server sent" };
  }
  return { ok: true };
}
