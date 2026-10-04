import { describe, expect, test } from "vitest";
import type { GameState } from "../src/state/types";
import { addBm, agrippa, battle } from "./validator-fixtures";
import { logOf, play, rigDice } from "./reducer-helpers";

describe("repair (reducer §10.1)", () => {
  /** p2's End Phase. Agrippa (p1) has 2 hits left, a fire and damaged thrusters. */
  const damaged = (): GameState => {
    const s = battle("end", "damage_control");
    agrippa(s).damage = 6;
    agrippa(s).criticals = [
      { id: "crit-900", kind: "fire", playerTurn: 1 },
      { id: "crit-901", kind: "thrusters", playerTurn: 1 },
    ];
    return s;
  };

  test("one die per hit remaining; each 6 fixes the next critical in priority", () => {
    const s0 = damaged();
    rigDice(s0, [6, 2]);
    const s = play(s0, { type: "repair", player: "p1", shipId: "ship-1", priority: ["crit-901", "crit-900"] });
    expect(agrippa(s).criticals.map((c) => c.kind)).toEqual(["fire"]);
    expect(logOf(s, "repair")[0]?.data).toEqual({ shipId: "ship-1", rolls: [6, 2], repaired: ["crit-901"] });
  });

  test("Blast Markers in contact halve the dice, rounding up", () => {
    const s0 = damaged();
    addBm(s0, 85, 15 + 2.85);
    rigDice(s0, [6]);
    const s = play(s0, { type: "repair", player: "p1", shipId: "ship-1", priority: ["crit-900", "crit-901"] });
    expect(logOf(s, "repair")[0]?.data).toMatchObject({ rolls: [6], repaired: ["crit-900"] });
  });

  test("once every ship needing repair has rolled, the turn moves on", () => {
    const s0 = damaged();
    rigDice(s0, [1, 1]);
    const s = play(s0, { type: "repair", player: "p1", shipId: "ship-1", priority: ["crit-900", "crit-901"] });
    // The fire is Agrippa's, and it's p2's End Phase, so it doesn't burn now (state N6).
    expect(agrippa(s).damage).toBe(6);
    expect(s.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
  });
});

describe("remove_blast_markers (reducer §10.3)", () => {
  test("rolls a D6 and removes that many, in the player's order", () => {
    const s0 = battle("end", "blast_marker_removal");
    const a = addBm(s0, 40, 60);
    const b = addBm(s0, 60, 60);
    const c = addBm(s0, 80, 60);
    rigDice(s0, [2]);
    const s = play(s0, { type: "remove_blast_markers", player: "p2", priority: [c.id, a.id, b.id] });
    expect(s.blastMarkers.map((x) => x.id)).toEqual([b.id]);
    expect(logOf(s, "bm_removal")[0]?.data).toEqual({ rolls: [2], removed: [c.id, a.id] });
    expect(s.clock.playerTurn).toBe(2);
  });

  test("a roll above the number removable removes them all", () => {
    const s0 = battle("end", "blast_marker_removal");
    const a = addBm(s0, 40, 60);
    rigDice(s0, [6]);
    const s = play(s0, { type: "remove_blast_markers", player: "p2", priority: [a.id] });
    expect(s.blastMarkers).toEqual([]);
  });

  test("markers touching ships stay, and with nothing removable no die is rolled", () => {
    const s0 = battle("shooting", "direct_fire");
    const touching = addBm(s0, 85, 15 + 2.85); // touching Agrippa
    const s = play(s0, { type: "end_step", player: "p2" }); // the rest of p2's turn passes untouched
    expect(s.clock.playerTurn).toBe(2);
    expect(s.blastMarkers.map((x) => x.id)).toEqual([touching.id]);
    expect(s.rng.draws).toBe(s0.rng.draws);
    expect(logOf(s, "bm_removal")).toEqual([]);
  });
});
