/**
 * The reducer's working context: a deep copy of the state that handlers mutate,
 * plus dice, ids and logging (reducer spec §2, §12). Nothing outside the
 * reducer ever sees a Ctx; reduce() returns its state.
 */
import { MAX_LEADERSHIP } from "../geometry/constants";
import { d6 as rollD6 } from "../state/rng";
import type { GameState, JsonValue, PlayerId } from "../state/types";

/** A validated transform reached a part of the reducer that isn't written yet. */
export class NotImplementedError extends Error {
  override name = "NotImplementedError";
}

export class Ctx {
  /** Player whose transform led to what's being resolved; null during housekeeping. */
  actor: PlayerId | null = null;

  constructor(readonly state: GameState) {}

  // --- Dice (§2.1)

  d6(): number {
    const roll = rollD6(this.state.rng);
    this.state.rng = roll.rng;
    return roll.value;
  }

  nD6(n: number): number[] {
    const rolls: number[] = [];
    for (let i = 0; i < n; i++) rolls.push(this.d6());
    return rolls;
  }

  d3(): number {
    return Math.ceil(this.d6() / 2);
  }

  /** Leadership-style test (§2.2): pass on sum ≤ min(target, 10). */
  test(dice: number, target: number): { rolls: number[]; passed: boolean } {
    const rolls = this.nD6(dice);
    return { rolls, passed: sum(rolls) <= Math.min(target, MAX_LEADERSHIP) };
  }

  // --- Ids (§2.3)

  newId(kind: string): string {
    const id = `${kind}-${this.state.nextId}`;
    this.state.nextId += 1;
    return id;
  }

  // --- Log (§12)

  log(kind: string, data: { [key: string]: JsonValue }): void {
    this.state.log.push({
      id: this.newId("log"),
      playerTurn: this.state.clock.playerTurn,
      phase: this.state.clock.phase,
      kind,
      actor: this.actor,
      data,
    });
  }

  /** Run `fn` as housekeeping: its log entries have no actor. */
  housekeeping<T>(fn: () => T): T {
    const saved = this.actor;
    this.actor = null;
    try {
      return fn();
    } finally {
      this.actor = saved;
    }
  }
}

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
