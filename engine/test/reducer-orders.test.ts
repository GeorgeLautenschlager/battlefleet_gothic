import { describe, expect, test } from "vitest";
import { ramTestDice } from "../src/reducer/handlers/orders";
import type { GameState } from "../src/state/types";
import { agrippa, battle, unclean } from "./validator-fixtures";
import { logOf, play, rigDice } from "./reducer-helpers";

const declare = (s: GameState, order: string, dice: number[], extra: Record<string, unknown> = {}) => {
  rigDice(s, dice);
  return play(s, { type: "declare_order", player: "p2", shipId: "ship-2", order, ...extra } as never);
};

describe("declare_order (reducer §8.1)", () => {
  test("a passed Command check sets the order and opens the activation", () => {
    const s = declare(battle(), "lock_on", [3, 4]); // 7 ≤ Ld 7
    expect(unclean(s).specialOrder).toEqual({ kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null });
    expect(s.activation).toMatchObject({ shipId: "ship-2", stage: "ordered", order: "lock_on", maxDistance: 25, minDistance: 12.5 });
    expect(logOf(s, "command_check")[0]?.data).toEqual({ shipId: "ship-2", order: "lock_on", target: 7, rolls: [3, 4], passed: true });
    expect(s.turnState.commandCheckFailed).toBe(false);
  });

  test("a failed check locks the fleet's orders, and the ship moves with none", () => {
    const s = declare(battle(), "lock_on", [4, 4]); // 8 > Ld 7
    expect(unclean(s).specialOrder).toBeNull();
    expect(s.turnState.commandCheckFailed).toBe(true);
    expect(s.activation).toMatchObject({ order: null, maxDistance: 25, minDistance: 12.5 });
  });

  test("11–12 always fail, even on Ld 10 (p. 48)", () => {
    const s0 = battle();
    unclean(s0).leadership = 10;
    expect(declare(s0, "lock_on", [5, 6]).turnState.commandCheckFailed).toBe(true);
  });

  test("Enemy Contacts +1 and Under Fire −1 modify the target", () => {
    const s0 = battle();
    agrippa(s0).specialOrder = { kind: "lock_on", issued: 0, expires: { playerTurn: 2, at: "movement_start" }, replaced: null };
    expect(logOf(declare(s0, "lock_on", [4, 4]), "command_check")[0]?.data).toMatchObject({ target: 8, passed: true });
  });

  test("All Ahead Full: ram test, then 4D6 extra; the move must cover all of it", () => {
    const s = declare(battle(), "all_ahead_full", [1, 1, 3, 3, 2, 3, 4, 5], { ramTargetId: "ship-1" });
    expect(logOf(s, "ram_test")[0]?.data).toEqual({ shipId: "ship-2", targetId: "ship-1", target: 7, rolls: [3, 3], passed: true });
    expect(logOf(s, "aaf_roll")[0]?.data).toEqual({ shipId: "ship-2", rolls: [2, 3, 4, 5], extra: 14 });
    expect(s.activation).toMatchObject({
      order: "all_ahead_full", aafExtra: 14, maxDistance: 39, minDistance: 39,
      ram: { targetId: "ship-1", testPassed: true, resolved: false },
    });
  });

  test("a failed ram test still goes All Ahead Full", () => {
    const s = declare(battle(), "all_ahead_full", [1, 1, 4, 4, 1, 1, 1, 1], { ramTargetId: "ship-1" });
    expect(s.activation).toMatchObject({ order: "all_ahead_full", aafExtra: 4, ram: { testPassed: false } });
  });

  test("Burn Retros: zero to half speed", () => {
    expect(declare(battle(), "burn_retros", [1, 1]).activation).toMatchObject({ maxDistance: 12.5, minDistance: 0 });
  });

  test("Reload Ordnance reloads at once", () => {
    const s0 = battle("movement", "move_ships", 2); // p1's turn
    agrippa(s0).loaded.torpedoes = false;
    rigDice(s0, [1, 1]);
    const s = play(s0, { type: "declare_order", player: "p1", shipId: "ship-1", order: "reload_ordnance" });
    expect(agrippa(s).loaded).toEqual({ torpedoes: true });
  });

  test("ram test dice by size (p. 55)", () => {
    expect(ramTestDice("cruiser", "escort")).toBe(3);
    expect(ramTestDice("cruiser", "cruiser")).toBe(2);
    expect(ramTestDice("cruiser", "battleship")).toBe(1);
  });
});

describe("answer_brace and brace offers", () => {
  /** p2's Shooting Phase: Agrippa (p1) is asked to brace; a second offer, to Unclean, waits in the queue. */
  const asked = (): GameState => {
    const s = battle("shooting", "direct_fire");
    s.pending.push({ id: "pend-900", kind: "brace", player: "p1", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } });
    s.queue.push({ kind: "brace_offer", shipId: "ship-2", source: { kind: "ship", id: "ship-1" } });
    return s;
  };

  test("passing braces until the end of the owner's next turn, then the queue carries on", () => {
    const s0 = asked();
    rigDice(s0, [2, 3]);
    const s = play(s0, { type: "answer_brace", player: "p1", pendingId: "pend-900", attempt: true });
    // Braced in p2's turn 1 → until the end of p1's turn 2.
    expect(agrippa(s).specialOrder).toEqual({ kind: "brace_for_impact", issued: 1, expires: { playerTurn: 2, at: "turn_end" }, replaced: null });
    // The queued offer ran: now p2 is asked about Unclean.
    expect(s.pending).toEqual([{ id: expect.stringMatching(/^pend-/) as unknown as string, kind: "brace", player: "p2", shipId: "ship-2", source: { kind: "ship", id: "ship-1" } }]);
    expect(s.queue).toEqual([]);
  });

  test("bracing in your own turn lasts until the end of your next one, and records what it replaced", () => {
    const s0 = asked();
    s0.pending = [];
    unclean(s0).specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    s0.pending.push({ id: "pend-901", kind: "brace", player: "p2", shipId: "ship-2", source: { kind: "ship", id: "ship-1" } });
    s0.queue = [];
    rigDice(s0, [1, 1]);
    const s = play(s0, { type: "answer_brace", player: "p2", pendingId: "pend-901", attempt: true });
    expect(unclean(s).specialOrder).toEqual({ kind: "brace_for_impact", issued: 1, expires: { playerTurn: 3, at: "turn_end" }, replaced: "lock_on" });
  });

  test("failing can't be retried against the same source, and doesn't lock orders (N4)", () => {
    const s0 = asked();
    rigDice(s0, [6, 6]);
    const s1 = play(s0, { type: "answer_brace", player: "p1", pendingId: "pend-900", attempt: true });
    expect(agrippa(s1).specialOrder).toBeNull();
    expect(s1.turnState.braceFailures).toEqual([{ shipId: "ship-1", source: { kind: "ship", id: "ship-2" } }]);
    expect(s1.turnState.commandCheckFailed).toBe(false);

    // Another offer to Agrippa against the same source is skipped; against a different source it's made.
    s1.pending = [];
    s1.queue = [];
    s1.pending.push({ id: "pend-950", kind: "brace", player: "p2", shipId: "ship-2", source: { kind: "ship", id: "ship-1" } });
    s1.queue.push(
      { kind: "brace_offer", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } },
      { kind: "brace_offer", shipId: "ship-1", source: { kind: "explosion", id: "ship-2" } },
    );
    const s2 = play(s1, { type: "answer_brace", player: "p2", pendingId: "pend-950", attempt: false });
    expect(s2.pending.map((p) => p.source)).toEqual([{ kind: "explosion", id: "ship-2" }]);
  });

  test("declining logs it and rolls nothing", () => {
    const s0 = asked();
    const s = play(s0, { type: "answer_brace", player: "p1", pendingId: "pend-900", attempt: false });
    expect(s.rng.draws).toBe(s0.rng.draws);
    expect(logOf(s, "brace_check")[0]?.data).toEqual({ shipId: "ship-1", declined: true });
  });
});
