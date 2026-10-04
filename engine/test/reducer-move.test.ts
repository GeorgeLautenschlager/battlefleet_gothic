/**
 * Movement. battle(): Unclean (ship-2, p2, speed 25) at (100, 105) heading 180;
 * Agrippa (ship-1) at (85, 15) heading 0. p2 moves first.
 */
import { describe, expect, test } from "vitest";
import type { GameState, PathStep } from "../src/state/types";
import { addBm, addSalvo, agrippa, battle, ordered, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";

const a = (distance: number): PathStep => ({ kind: "advance", distance });
const turn = (degrees: number): PathStep => ({ kind: "turn", degrees });
const move = (path: PathStep[], disengage = false, shipId = "ship-2", player: "p1" | "p2" = "p2") =>
  ({ type: "move", player, shipId, path, disengage }) as const;

describe("a plain move", () => {
  test("12.5, 45° to port, 12.5: position, heading, lastMove, and on to shooting", () => {
    const s = play(battle(), move([a(12.5), turn(-45), a(12.5)]));
    expect(unclean(s).heading).toBe(135);
    expect(unclean(s).position!.x).toBeCloseTo(100 + 12.5 * Math.SQRT1_2, 12);
    expect(unclean(s).position!.y).toBeCloseTo(92.5 - 12.5 * Math.SQRT1_2, 12);
    expect(unclean(s).lastMove).toEqual({ playerTurn: 1, distance: 25 });
    expect(s.activation).toBeNull();
    expect(s.clock.step).toBe("direct_fire"); // every p2 ship has moved
    expect(logOf(s, "move")[0]?.data).toMatchObject({ shipId: "ship-2", distance: 25, truncated: false });
  });

  test("a move from a declared order uses the activation", () => {
    const s0 = battle();
    s0.activation = ordered("ship-2", { order: "burn_retros", maxDistance: 12.5, minDistance: 0, start: { position: { x: 100, y: 105 }, heading: 180 } });
    unclean(s0).specialOrder = { kind: "burn_retros", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    const s = play(s0, move([turn(45)]));
    expect(unclean(s)).toMatchObject({ heading: 225, position: { x: 100, y: 105 }, lastMove: { playerTurn: 1, distance: 0 } });
  });

  test("moving through a Blast Marker logs the slowdown", () => {
    const s0 = battle();
    addBm(s0, 100, 90);
    const s = play(s0, move([a(20)]));
    expect(logOf(s, "blast_marker_contact")[0]?.data).toMatchObject({ maxDistance: 20 });
  });

  test("off the table edge: disengaged, no lastMove", () => {
    const s0 = battle();
    unclean(s0).position = { x: 100, y: 5 };
    const s = play(s0, move([a(10)]));
    expect(unclean(s)).toMatchObject({ status: "disengaged", position: null, heading: null, lastMove: null });
    expect(s.result?.reason).toBe("fleet_eliminated"); // p2's only ship has left
  });
});

describe("Blast Markers with no shields up (p. 69)", () => {
  test("brace offer, then a D6: a 6 does a point of damage", () => {
    const s0 = battle();
    unclean(s0).criticals.push({ id: "crit-900", kind: "shields_collapse", playerTurn: 1 });
    addBm(s0, 100, 90);
    const s1 = play(s0, move([a(20)]));
    expect(s1.pending).toMatchObject([{ player: "p2", shipId: "ship-2" }]);
    // Decline; the BM roll [6]; the crit check [1].
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [6, 1]);
    expect(unclean(s2).damage).toBe(1);
    expect(logOf(s2, "damage")[0]?.data).toMatchObject({ cause: "blast_marker" });
    expect(unclean(s2).lastMove?.distance).toBe(20);
  });
});

describe("the disengage test (p. 56)", () => {
  test("passed: the ship leaves; failed: it can't fire this turn", () => {
    const pass = playDice(battle(), move([a(20)], true), [3, 3]); // 6 ≤ Ld 7
    expect(unclean(pass)).toMatchObject({ status: "disengaged", position: null });
    const fail = playDice(battle(), move([a(20)], true), [4, 4]);
    expect(unclean(fail).status).toBe("active");
    expect(logOf(fail, "disengage_test")[0]?.data).toMatchObject({ passed: false });
    // Nothing can fire or launch, and there's nothing else to do: straight on to p1's turn.
    expect(logOf(fail, "step").map((e) => e.data["step"])).toContain("launch_ordnance");
    expect(fail.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
  });

  test("+1 per Blast Marker within 5 cm, −1 per enemy within 15 cm", () => {
    const s0 = battle();
    addBm(s0, 100, 82); // 3 cm from where Unclean stops (100, 85)
    agrippa(s0).position = { x: 100, y: 75 }; // 10 cm away
    const s = playDice(s0, move([a(20)], true), [1, 1]);
    expect(logOf(s, "disengage_test")[0]?.data).toMatchObject({ target: 7 }); // 7 + 1 − 1
  });
});

describe("rams (§8.3)", () => {
  /** Unclean on All Ahead Full (+10), ram test passed, Agrippa 20 cm dead ahead, facing it. */
  const rammingRun = (): GameState => {
    const s = battle();
    agrippa(s).position = { x: 100, y: 85 };
    s.activation = ordered("ship-2", {
      order: "all_ahead_full", aafExtra: 10, maxDistance: 35, minDistance: 35,
      ram: { targetId: "ship-1", testPassed: true, resolved: false },
      start: { position: { x: 100, y: 105 }, heading: 180 },
    });
    unclean(s).specialOrder = { kind: "all_ahead_full", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    return s;
  };

  test("contact pauses the move for both brace decisions, then resolves head-on and carries on", () => {
    const s1 = play(rammingRun(), move([a(35)]));
    // Stopped where the bases touch (20 − 3.2 cm), asking p1 first.
    expect(unclean(s1).position!.y).toBeCloseTo(105 - (20 - 3.2), 10);
    expect(s1.activation).toMatchObject({ stage: "moving" });
    expect(s1.pending).toMatchObject([{ player: "p1", shipId: "ship-1" }]);

    const s2 = play(s1, { type: "answer_brace", player: "p1", pendingId: s1.pending[0]!.id, attempt: false });
    expect(s2.pending).toMatchObject([{ player: "p2", shipId: "ship-2" }]);

    // Head-on: Unclean rolls 8D6 vs Agrippa's 6+ front; Agrippa rolls its full 8D6 vs Unclean's 5+ front.
    // Then critical checks for each hull hit: Agrippa's 2 hits [1, 1], Unclean's 1 hit [1].
    const s3 = playDice(s2, { type: "answer_brace", player: "p2", pendingId: s2.pending[0]!.id, attempt: false }, [
      6, 6, 1, 1, 1, 1, 1, 1, // rammer: 2 hits vs 6+
      5, 1, 1, 1, 1, 1, 1, 1, // target: 1 hit vs 5+
      1, 1, 1, // crit checks
    ]);
    expect(logOf(s3, "ram")[0]?.data).toMatchObject({ headOn: true, facing: "front", rammerHits: 2, targetHits: 1 });
    expect(agrippa(s3).damage).toBe(2);
    expect(unclean(s3).damage).toBe(1);
    expect(unclean(s3).position!.y).toBeCloseTo(105 - 35, 10); // the move finished its full distance
    expect(s3.activation).toBeNull();
  });

  test("from the side, the target rolls half its starting hits", () => {
    const s0 = rammingRun();
    agrippa(s0).heading = 90; // broadside on
    const s1 = play(s0, move([a(35)]));
    const s2 = play(s1, { type: "answer_brace", player: "p1", pendingId: s1.pending[0]!.id, attempt: false });
    const s3 = playDice(s2, { type: "answer_brace", player: "p2", pendingId: s2.pending[0]!.id, attempt: false }, [
      1, 1, 1, 1, 1, 1, 1, 1, // rammer: 8D6, no hits vs 5+
      1, 1, 1, 1, // target: 4D6
    ]);
    expect(logOf(s3, "ram")[0]?.data).toMatchObject({ headOn: false, facing: "left", targetRolls: [1, 1, 1, 1] });
  });
});

describe("a ship sailing into a torpedo salvo", () => {
  test("the salvo attacks it, even if it's the ship's own (T6), and the move carries on", () => {
    const s0 = battle();
    addSalvo(s0, { owner: "p2", launchedBy: "ship-2", launched: 0, position: { x: 100, y: 95 }, heading: 90, strength: 2 });
    const s1 = play(s0, move([a(20)]));
    expect(s1.pending).toMatchObject([{ player: "p2", shipId: "ship-2", source: { kind: "ordnance" } }]);
    // Decline; turrets 2 dice [1, 1]; 2 torpedo dice vs 5+ [5, 1] → 1 hit; crit check [1].
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [1, 1, 5, 1, 1]);
    expect(unclean(s2).damage).toBe(1);
    expect(s2.ordnance[0]).toMatchObject({ strength: 1, attacks: [{ targetId: "ship-2", round: 1 }] });
    expect(unclean(s2).position!.y).toBeCloseTo(85, 10);
  });
});

describe("drifting hulks (§8.4)", () => {
  test("4D6 cm straight ahead, then a trailing Blast Marker", () => {
    const s0 = battle("movement", "hulks_drift");
    Object.assign(unclean(s0), { status: "drifting_hulk", damage: 8 });
    const s = playDice(s0, { type: "drift_hulk", player: "p2", shipId: "ship-2" }, [1, 2, 3, 4]);
    expect(unclean(s).position).toEqual({ x: 100, y: 95 });
    expect(s.blastMarkers.at(-1)).toMatchObject({ cause: "hulk", position: { x: 100, y: 95 + 2.85 } });
    expect(s.turnState.ships["ship-2"]!.drifted).toBe(true);
  });

  test("a blazing hulk re-rolls afterwards; one that drifts off the table is destroyed", () => {
    const s0 = battle("movement", "hulks_drift");
    Object.assign(unclean(s0), { status: "blazing_hulk", damage: 8 });
    const s = playDice(s0, { type: "drift_hulk", player: "p2", shipId: "ship-2" }, [1, 1, 1, 1, 2, 2]);
    expect(unclean(s).status).toBe("drifting_hulk"); // the fire's out

    const off = battle("movement", "hulks_drift");
    Object.assign(unclean(off), { status: "drifting_hulk", damage: 8, position: { x: 100, y: 4 } });
    const t = playDice(off, { type: "drift_hulk", player: "p2", shipId: "ship-2" }, [2, 2, 2, 2]);
    expect(unclean(t)).toMatchObject({ status: "destroyed", position: null });
  });
});
