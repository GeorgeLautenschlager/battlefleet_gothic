import { describe, expect, test } from "vitest";
import { agrippa, battle, unclean } from "./validator-fixtures";
import { logOf, play } from "./reducer-helpers";

// battle(): the §14 example, p2 (Unclean) owns odd player turns, p1 (Agrippa) even ones.

describe("advancing through a turn", () => {
  test("end_step in direct_fire runs the rest of the turn and stops at the next player's movement", () => {
    const s = play(battle("shooting", "direct_fire"), { type: "end_step", player: "p2" });
    // No torpedoes (Murder), no salvos, no criticals, no Blast Markers: every later step is already complete.
    expect(s.clock).toEqual({ stage: "battle", setupStep: null, playerTurn: 2, phase: "movement", step: "move_ships" });
    expect(s.turnState.playerTurn).toBe(2);
    expect(logOf(s, "turn_start").at(-1)?.data).toEqual({ round: 1, player: "p1" });
    expect(logOf(s, "step").map((e) => e.data.step)).toEqual([
      "launch_ordnance", "active_ordnance", "inactive_ordnance", "boarding", "damage_control", "blast_marker_removal",
      "hulks_drift", "move_ships",
    ]);
    expect(logOf(s, "step").every((e) => e.actor === null)).toBe(true); // housekeeping
  });

  test("a step with something left to do waits: Agrippa's loaded torpedoes hold launch_ordnance", () => {
    const s = play(battle("shooting", "direct_fire", 2), { type: "end_step", player: "p1" });
    expect(s.clock.step).toBe("launch_ordnance");
    const t = play(s, { type: "end_step", player: "p1" });
    expect(t.clock).toMatchObject({ playerTurn: 3, step: "move_ships" });
  });

  test("turnState is fresh each player turn", () => {
    const start = battle("shooting", "direct_fire");
    start.turnState.ships["ship-2"]!.weaponsFired = ["port_battery"];
    start.turnState.commandCheckFailed = true;
    const s = play(start, { type: "end_step", player: "p2" });
    expect(s.turnState.commandCheckFailed).toBe(false);
    expect(s.turnState.ships["ship-2"]!.weaponsFired).toEqual([]);
  });
});

describe("order expiry (state §7.3)", () => {
  test("orders last until the owner's next Movement Phase; Brace until the end of the owner's next turn", () => {
    const s0 = battle("shooting", "direct_fire"); // p2's turn 1
    unclean(s0).specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    // Agrippa braced during p2's turn: until the end of its own next turn, 2.
    agrippa(s0).specialOrder = { kind: "brace_for_impact", issued: 1, expires: { playerTurn: 2, at: "turn_end" }, replaced: null };

    const s1 = play(s0, { type: "end_step", player: "p2" }); // → turn 2, p1 moving
    expect(unclean(s1).specialOrder?.kind).toBe("lock_on"); // still there through p1's turn (Enemy Contacts)
    expect(agrippa(s1).specialOrder?.kind).toBe("brace_for_impact"); // and Agrippa is still braced in its own turn

    s1.clock = { ...s1.clock, phase: "shooting", step: "direct_fire" };
    const s2 = playAllEndSteps(s1, "p1"); // end of turn 2 → turn 3
    expect(agrippa(s2).specialOrder).toBeNull();
    expect(unclean(s2).specialOrder).toBeNull(); // removed as p2's turn 3 begins
    expect(logOf(s2, "order_expired").map((e) => e.data)).toEqual([
      { shipId: "ship-1", order: "brace_for_impact" },
      { shipId: "ship-2", order: "lock_on" },
    ]);
  });
});

/** end_step until the player turn changes. */
function playAllEndSteps(state: ReturnType<typeof battle>, player: "p1" | "p2") {
  let s = state;
  const turn = s.clock.playerTurn;
  while (s.clock.playerTurn === turn && s.clock.stage === "battle") s = play(s, { type: "end_step", player });
  return s;
}

describe("game end", () => {
  test("after the last player turn of round 8, with Cruiser Clash scoring", () => {
    const s0 = battle("shooting", "direct_fire", 16); // p1's turn
    agrippa(s0).loaded.torpedoes = false;
    unclean(s0).damage = 5; // 5 + 1 crippled = 6 (p. 128)
    const s = play(s0, { type: "end_step", player: "p1" });
    expect(s.clock).toMatchObject({ stage: "ended", phase: null, step: null });
    expect(s.result).toEqual({ reason: "rounds_complete", scores: { p1: 6, p2: 0 }, winner: "p1" });
    expect(logOf(s, "game_end")).toHaveLength(1);
  });

  test("as soon as a fleet has no active ships (state D6)", () => {
    const s0 = battle("shooting", "direct_fire");
    Object.assign(agrippa(s0), { status: "disengaged", position: null, heading: null, damage: 2 });
    const s = play(s0, { type: "end_step", player: "p2" });
    expect(s.result).toEqual({ reason: "fleet_eliminated", scores: { p1: 0, p2: 2 }, winner: "p2" });
  });

  test("a level score is a draw", () => {
    const s0 = battle("shooting", "direct_fire", 16);
    agrippa(s0).loaded.torpedoes = false;
    expect(play(s0, { type: "end_step", player: "p1" }).result?.winner).toBeNull();
  });
});
