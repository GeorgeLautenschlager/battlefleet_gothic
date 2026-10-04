/**
 * The game as the app holds it: the config, the starting state, and every
 * transform applied since, each with the state it produced.
 *
 * Undo goes back one transform at a time, but never past one that rolled dice:
 * the dice are seeded, so undoing a roll and trying something else would let a
 * player peek at what's coming.
 */
import { newGame, reduce, validate } from "@bfg/engine";
import type { GameConfig, GameState, Reason, Transform } from "@bfg/engine";

export type Entry = {
  transform: Transform;
  state: GameState;
  /** Whether this transform drew any dice (and so can't be undone). */
  rolled: boolean;
};

export type History = {
  config: GameConfig;
  initial: GameState;
  entries: Entry[];
};

export type Applied = { ok: true; history: History } | { ok: false; reason: Reason };

export function start(config: GameConfig): History {
  return { config, initial: newGame(config), entries: [] };
}

export function current(history: History): GameState {
  return history.entries.at(-1)?.state ?? history.initial;
}

export function apply(history: History, transform: Transform): Applied {
  const before = current(history);
  const verdict = validate(before, transform);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const state = reduce(before, transform);
  const entry: Entry = { transform, state, rolled: state.rng.draws !== before.rng.draws };
  return { ok: true, history: { ...history, entries: [...history.entries, entry] } };
}

export function canUndo(history: History): boolean {
  const last = history.entries.at(-1);
  return last !== undefined && !last.rolled;
}

export function undo(history: History): History {
  return canUndo(history) ? { ...history, entries: history.entries.slice(0, -1) } : history;
}

// --- Saving: the config and the transforms are enough, because the engine is deterministic.

export type SavedGame = { format: "bfg-save"; version: 1; config: GameConfig; transforms: Transform[] };

export function toSave(history: History): SavedGame {
  return { format: "bfg-save", version: 1, config: history.config, transforms: history.entries.map((e) => e.transform) };
}

/** Replay a save. Null if it isn't one, or any transform no longer applies. */
export function fromSave(value: unknown): History | null {
  if (!isSave(value)) return null;
  try {
    let history = start(value.config);
    for (const t of value.transforms) {
      const next = apply(history, t);
      if (!next.ok) return null;
      history = next.history;
    }
    return history;
  } catch {
    return null; // a config newGame rejects
  }
}

function isSave(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SavedGame>;
  return v.format === "bfg-save" && v.version === 1 && typeof v.config === "object" && Array.isArray(v.transforms);
}
