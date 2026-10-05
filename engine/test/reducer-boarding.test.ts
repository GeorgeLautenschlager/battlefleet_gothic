/**
 * Boarding actions, grapples and teleport attacks (reducer spec §10.4–10.5),
 * with scripted dice so each test pins the draw order.
 *
 * Lunar and Murder alike: 8 hits, 2 shields, 2 turrets, small bases.
 * Chaos boards at +1 (factionTraits.boardingModifier).
 */
import { describe, expect, test } from "vitest";
import { Ctx } from "../src/reducer/context";
import { leaveGrapple } from "../src/reducer/grapple";
import type { GameState } from "../src/state/types";
import { addBm, addSalvo, addShip, agrippa, battle, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";

const advance = (distance: number) => ({ kind: "advance" as const, distance });

/**
 * p2's End Phase, boarding step: Unclean (100, 50) declared against Agrippa (100, 47).
 * p1 gets a second Lunar far away, so p1's next Movement Phase waits for a move.
 */
function declared(): GameState {
  const s = battle("end", "boarding");
  s.meta.options.boarding = true;
  unclean(s).position = { x: 100, y: 50 };
  agrippa(s).position = { x: 100, y: 47 };
  addShip(s, agrippa(s), { id: "ship-3", name: "Hammer of Terra", position: { x: 20, y: 20 } });
  s.turnState.ships["ship-2"]!.boardingDeclared = "ship-1";
  return s;
}
const boardAgrippa = { type: "board" as const, player: "p2" as const, targetId: "ship-1", together: true, priority: ["ship-2"] };

describe("declaring with the move", () => {
  test("a move that ends touching the target declares; the ship then can't shoot, so the turn runs on to boarding", () => {
    const s = battle();
    s.meta.options.boarding = true;
    unclean(s).position = { x: 100, y: 60 };
    agrippa(s).position = { x: 100, y: 45 };
    const next = playDice(s, { type: "move", player: "p2", shipId: "ship-2", path: [advance(12.5)], disengage: false, boardTargetId: "ship-1" }, []);
    expect(next.turnState.ships["ship-2"]!.boardingDeclared).toBe("ship-1");
    expect(logOf(next, "boarding_declared")).toHaveLength(1);
    expect(next.clock.step).toBe("boarding"); // shooting skipped: its weapons count as disabled
  });
});

describe("a boarding fight", () => {
  test("values, modifiers and the result: Agrippa is stormed", () => {
    // Unclean 8 vs Agrippa 8 + 2 turrets = 10. Unclean: ratio 0, Chaos +1. Agrippa: ratio +1.
    // Rolls 6 vs 2: 7 vs 3, a difference of 4 (Stormed): 4 damage to Agrippa,
    // then criticals on 2+ for the loser (rolls 1: no) and 6+ for the winner (1: no).
    const next = playDice(declared(), boardAgrippa, [6, 2, 1, 1]);
    const [fight] = logOf(next, "boarding");
    expect(fight?.data).toMatchObject({
      values: { attackers: 8, defender: 10 },
      modifiers: { attackers: 1, defender: 1 },
      rolls: [6, 2],
      totals: { attackers: 7, defender: 3 },
      result: "stormed",
      loser: "defender",
      damage: 4,
    });
    expect(agrippa(next).damage).toBe(4);
    expect(logOf(next, "boarding_critical").map((e) => e.data)).toEqual([
      { shipId: "ship-1", need: 2, rolls: [1], critical: false },
      { shipId: "ship-2", need: 6, rolls: [1], critical: false },
    ]);
    // Nothing left to do in p2's End Phase: on to p1's turn, waiting for its free Lunar to move.
    expect(next.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
  });

  test("Overwhelmed: the loser's critical is automatic, the winner's none; no Brace, no per-point checks", () => {
    // Unclean +2 (Chaos, and Agrippa on orders), Agrippa +1. Rolls 5 vs 1: 7 vs 2, difference 5.
    // Agrippa takes 5, then an automatic critical: 2D6 = 3 + 4 → Fire!
    const s = declared();
    agrippa(s).specialOrder = { kind: "brace_for_impact", issued: 1, expires: { playerTurn: 2, at: "turn_end" }, replaced: null };
    // Agrippa is braced (+1 to Unclean, on special orders) but that saves nothing in a boarding action.
    const next = playDice(s, boardAgrippa, [5, 1, 3, 4]);
    expect(logOf(next, "boarding")[0]?.data).toMatchObject({ totals: { attackers: 7, defender: 2 }, result: "overwhelmed" });
    expect(agrippa(next).damage).toBe(5);
    expect(agrippa(next).criticals.map((c) => c.kind)).toEqual(["fire"]);
    expect(logOf(next, "brace_saves")).toHaveLength(0);
  });

  test("boarded to 0: a drifting hulk with no catastrophic roll", () => {
    // Agrippa has 2 hits left and is crippled: 2 + 1 turret = 3 against Unclean's 8.
    // Unclean: ratio +2 (8 ≥ 2×3), crippled enemy +2, Chaos +1 = 5. Agrippa: 0.
    const s = declared();
    agrippa(s).damage = 6;
    s.ships = s.ships.filter((x) => x.id !== "ship-3"); // so p1's fleet is gone afterwards
    delete s.turnState.ships["ship-3"];
    const next = playDice(s, boardAgrippa, [2, 1]);
    expect(logOf(next, "boarding")[0]?.data).toMatchObject({ modifiers: { attackers: 5, defender: 0 }, damage: 6 });
    expect(agrippa(next).status).toBe("drifting_hulk");
    expect(agrippa(next).damage).toBe(8); // the rest is discarded
    expect(logOf(next, "boarded_hulk")).toHaveLength(1);
    expect(logOf(next, "catastrophic")).toHaveLength(0);
    expect(next.result?.reason).toBe("fleet_eliminated");
  });

  test("a draw grapples; the grappled ships stay put, can't fire, and fight again in the next End Phase", () => {
    let s = playDice(declared(), boardAgrippa, [3, 3]); // 4 vs 4
    expect(logOf(s, "grapple")[0]?.data).toEqual({ defenderId: "ship-1", attackerIds: ["ship-2"] });
    expect(agrippa(s).grapple).toEqual({ defenderId: "ship-1", attackerIds: ["ship-2"] });
    expect(unclean(s).grapple).toEqual(agrippa(s).grapple);
    expect(agrippa(s).damage + unclean(s).damage).toBe(0);

    // p1's turn: Agrippa stays put; only the free Lunar moves, and only it can shoot.
    expect(s.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
    expect(s.turnState.ships["ship-1"]!.moved).toBe(true);
    expect(agrippa(s).lastMove).toEqual({ playerTurn: 2, distance: 0 });
    expect(logOf(s, "grappled").map((e) => e.data)).toEqual([{ shipId: "ship-1" }]);
    s = play(s, { type: "move", player: "p1", shipId: "ship-3", path: [advance(10)], disengage: false });
    expect(s.clock.step).toBe("direct_fire");
    s = play(s, { type: "end_step", player: "p1" });
    expect(s.clock.step).toBe("launch_ordnance");

    // p1's End Phase: the grapple fights again by itself. 1 vs 6: 2 vs 7, Overwhelmed:
    // Unclean (the attacker) takes 5 and an automatic critical (3 + 4: Fire!).
    s = playDice(s, { type: "end_step", player: "p1" }, [1, 6, 3, 4]);
    expect(logOf(s, "boarding")[1]?.data).toMatchObject({ attackerIds: ["ship-2"], defenderId: "ship-1", loser: "attackers" });
    expect(unclean(s).damage).toBe(5);
    // A decisive result doesn't break a grapple (T10).
    expect(unclean(s).grapple).toEqual({ defenderId: "ship-1", attackerIds: ["ship-2"] });
    expect(s.clock.step).toBe("damage_control"); // Unclean has a fire to repair
  });

  test("together: one fight on the summed values; the attackers take damage in priority order", () => {
    const s = declared();
    addShip(s, unclean(s), { id: "ship-4", name: "Woe Eternal", position: { x: 103, y: 47 } });
    s.turnState.ships["ship-4"]!.boardingDeclared = "ship-1";
    // 16 vs 10: Chaos ratio +1, +1 = 2; Agrippa 0. Rolls 1 vs 6: 3 vs 6, Driven Back:
    // 3 damage, all to the first in priority. Criticals: losers on 3+ (1, 1), winner on 6+ (1).
    const next = playDice(s, { ...boardAgrippa, priority: ["ship-4", "ship-2"] }, [1, 6, 1, 1, 1]);
    expect(logOf(next, "boarding")[0]?.data).toMatchObject({ values: { attackers: 16, defender: 10 }, result: "driven_back" });
    expect(next.ships.find((x) => x.id === "ship-4")?.damage).toBe(3);
    expect(unclean(next).damage).toBe(0);
  });

  test("separately: one fight each, in priority order, each on its own value", () => {
    const s = declared();
    addShip(s, unclean(s), { id: "ship-4", name: "Woe Eternal", position: { x: 103, y: 47 } });
    s.turnState.ships["ship-4"]!.boardingDeclared = "ship-1";
    // First fight, ship-4: 8 vs 10, 5 + 1 vs 1 + 1 → 6 vs 2, difference 4: Agrippa takes 4, criticals 1, 1.
    // Second, ship-2: 8 vs 4 + 1 (crippled: turrets halved) = 5; Unclean ratio +1, crippled +2, Chaos +1 = 4; Agrippa 0.
    // 1 vs 1 → 5 vs 1, difference 4 again: Agrippa takes 4 more and is boarded to 0 (no check for it; Unclean's: 1).
    const next = playDice(s, { ...boardAgrippa, together: false, priority: ["ship-4", "ship-2"] }, [5, 1, 1, 1, 1, 1, 1]);
    const fights = logOf(next, "boarding").map((e) => e.data);
    expect(fights.map((f) => f["attackerIds"])).toEqual([["ship-4"], ["ship-2"]]);
    expect(fights[1]).toMatchObject({ values: { attackers: 8, defender: 5 }, modifiers: { attackers: 4, defender: 0 } });
    expect(agrippa(next).status).toBe("drifting_hulk");
  });
});

describe("leaving a grapple", () => {
  test("losing one of two attackers keeps it; losing the last ends it for everyone", () => {
    const s = declared();
    addShip(s, unclean(s), { id: "ship-4", name: "Woe Eternal", position: { x: 103, y: 47 } });
    const g = { defenderId: "ship-1", attackerIds: ["ship-2", "ship-4"] };
    for (const id of ["ship-1", "ship-2", "ship-4"]) s.ships.find((x) => x.id === id)!.grapple = { ...g, attackerIds: [...g.attackerIds] };
    const ctx = new Ctx(s);
    leaveGrapple(ctx, unclean(s));
    expect(agrippa(s).grapple).toEqual({ defenderId: "ship-1", attackerIds: ["ship-4"] });
    expect(s.ships.find((x) => x.id === "ship-4")?.grapple).toEqual(agrippa(s).grapple);
    leaveGrapple(ctx, s.ships.find((x) => x.id === "ship-4")!);
    expect(agrippa(s).grapple).toBeNull();
    expect(logOf(s, "grapple_ended").map((e) => e.data)).toEqual([{ defenderId: "ship-1", shipId: "ship-4" }]);
  });
});

describe("teleport attacks", () => {
  /** p2's boarding step: Unclean 8 cm from Agrippa, whose shields are both blocked. */
  function inRange(): GameState {
    const s = battle("end", "boarding");
    s.meta.options.boarding = true;
    unclean(s).position = { x: 100, y: 58 };
    agrippa(s).position = { x: 100, y: 50 };
    addBm(s, 97.2, 50);
    addBm(s, 102.8, 50);
    addShip(s, agrippa(s), { id: "ship-3", name: "Hammer of Terra", position: { x: 20, y: 20 } });
    return s;
  }
  const tp = { type: "teleport" as const, player: "p2" as const, shipId: "ship-2", targetId: "ship-1" };

  test("the step waits while a teleport is possible, and end_step moves on", () => {
    const s = inRange();
    s.clock = { ...s.clock, phase: "shooting", step: "launch_ordnance" };
    const atBoarding = playDice(s, { type: "end_step", player: "p2" }, []);
    expect(atBoarding.clock.step).toBe("boarding");
    const after = playDice(atBoarding, { type: "end_step", player: "p2" }, []);
    expect(after.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
  });

  test("offered brace first; then a D6 read on the Critical Hits table", () => {
    let s = play(inRange(), tp);
    expect(s.pending[0]).toMatchObject({ kind: "brace", player: "p1", shipId: "ship-1" });
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [5]);
    expect(logOf(s, "teleport")[0]?.data).toMatchObject({ rolls: [5], result: "critical" });
    expect(agrippa(s).criticals.map((c) => c.kind)).toEqual(["prow_armament"]);
    expect(s.turnState.ships["ship-2"]!.teleported).toBe(true);
  });

  test("a 1 fails; Brace saves on 4+", () => {
    let failed = play(inRange(), tp);
    failed = playDice(failed, { type: "answer_brace", player: "p1", pendingId: failed.pending[0]!.id, attempt: false }, [1]);
    expect(logOf(failed, "teleport")[0]?.data).toMatchObject({ result: "failed" });
    expect(agrippa(failed).criticals).toEqual([]);

    let braced = play(inRange(), tp);
    // Command check 2D6 (1 + 1) passes; Hit-and-Run 4; save 5.
    braced = playDice(braced, { type: "answer_brace", player: "p1", pendingId: braced.pending[0]!.id, attempt: true }, [1, 1, 4, 5]);
    expect(logOf(braced, "teleport")[0]?.data).toMatchObject({ rolls: [4], saveRolls: [5], result: "saved" });
    expect(agrippa(braced).criticals).toEqual([]);
  });
});

describe("states saved before boarding existed", () => {
  test("a move paused mid-path, whose activation has no boardTargetId, still finishes", () => {
    const s = battle();
    unclean(s).position = { x: 100, y: 60 };
    addSalvo(s, { owner: "p1", position: { x: 100, y: 55 }, heading: 0 }); // across Unclean's path
    const paused = play(s, { type: "move", player: "p2", shipId: "ship-2", path: [advance(12.5)], disengage: false });
    expect(paused.activation?.stage).toBe("moving");
    expect(paused.pending[0]).toMatchObject({ kind: "brace", shipId: "ship-2" });
    delete (paused.activation as Partial<NonNullable<GameState["activation"]>>).boardTargetId;
    const next = play(paused, { type: "answer_brace", player: "p2", pendingId: paused.pending[0]!.id, attempt: false });
    expect(next.activation).toBeNull();
    expect(logOf(next, "move")).toHaveLength(1);
    expect(logOf(next, "boarding_lapsed")).toHaveLength(0);
  });
});
