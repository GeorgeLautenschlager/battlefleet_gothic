/**
 * Torpedoes. battle(): Agrippa (ship-1, p1, prow torpedoes 6 @ 30 cm) at (85, 15) h0;
 * Unclean (ship-2, p2, 5+ all round, 2 turrets) at (100, 105) h180. Player turn 2 is p1's.
 */
import { describe, expect, test } from "vitest";
import type { GameState } from "../src/state/types";
import { addBm, addSalvo, agrippa, battle, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";

const ordnancePhase = (): GameState => battle("ordnance", "active_ordnance", 2);
const moveSalvo = (ordnanceId: string, player: "p1" | "p2" = "p1") => ({ type: "move_ordnance", player, ordnanceId }) as const;
const removed = (s: GameState) => logOf(s, "ordnance_removed").map((e) => e.data["reason"]);

describe("launching (§9.1)", () => {
  test("a salvo on the launcher's stem, on the chosen bearing; the tubes need reloading", () => {
    const s = play(battle("shooting", "launch_ordnance", 2), {
      type: "launch_torpedoes", player: "p1", shipId: "ship-1", weaponId: "prow_torpedoes", bearing: 10,
    });
    expect(s.ordnance).toMatchObject([
      { owner: "p1", launchedBy: "ship-1", launched: 2, position: { x: 85, y: 15 }, heading: 10, strength: 6, speed: 30, attacks: [] },
    ]);
    expect(agrippa(s).loaded.torpedoes).toBe(false);
    expect(s.clock.step).toBe("active_ordnance"); // nothing left to launch
  });

  test("the new salvo moves its full speed without attacking its own launcher (T4)", () => {
    const s0 = play(battle("shooting", "launch_ordnance", 2), {
      type: "launch_torpedoes", player: "p1", shipId: "ship-1", weaponId: "prow_torpedoes", bearing: 0,
    });
    const s = play(s0, moveSalvo(s0.ordnance[0]!.id));
    expect(s.pending).toEqual([]);
    expect(s.ordnance[0]!.position.y).toBeCloseTo(45, 10);
    expect(s.turnState.ordnanceMoved).toEqual([]); // the turn has moved on
    expect(s.clock.playerTurn).toBe(3);
  });
});

describe("moving a salvo (§9.2)", () => {
  test("off the table edge: removed", () => {
    const s0 = ordnancePhase();
    const salvo = addSalvo(s0, { position: { x: 50, y: 10 }, heading: 180 });
    expect(removed(play(s0, moveSalvo(salvo.id)))).toEqual(["left_table"]);
  });

  test("two salvos meeting destroy each other", () => {
    const s0 = ordnancePhase();
    const mine = addSalvo(s0, { position: { x: 50, y: 40 }, heading: 0 });
    addSalvo(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 60 }, heading: 180 });
    const s = play(s0, moveSalvo(mine.id));
    expect(removed(s)).toEqual(["collision", "collision"]);
    expect(s.ordnance).toEqual([]);
  });

  test("a Blast Marker in the way: removed on a 6, otherwise one test per move", () => {
    const run = (roll: number) => {
      const s0 = ordnancePhase();
      const salvo = addSalvo(s0, { position: { x: 50, y: 40 }, heading: 0 });
      addBm(s0, 50, 50);
      addBm(s0, 50, 60);
      return playDice(s0, moveSalvo(salvo.id), [roll]);
    };
    expect(removed(run(6))).toEqual(["blast_marker"]);
    const passed = run(5);
    expect(logOf(passed, "bm_test")).toHaveLength(1);
    expect(passed.ordnance[0]!.position.y).toBeCloseTo(70, 10);
  });
});

describe("torpedo attacks (§9.3)", () => {
  /** A p1 salvo 25 cm short of Unclean, heading straight for it. */
  const inbound = (strength = 6): GameState => {
    const s = ordnancePhase();
    addSalvo(s, { id: "ord-900", position: { x: 100, y: 80 }, heading: 0, launched: 0, strength });
    return s;
  };

  test("brace offer, turrets, then hits on the facing struck, strength lost per hit (R6), and the salvo runs on", () => {
    const s1 = play(inbound(), moveSalvo("ord-900"));
    expect(s1.pending).toMatchObject([{ player: "p2", shipId: "ship-2", source: { kind: "ordnance", id: "ord-900" } }]);
    // Turrets [4, 1]: strength 5. Five dice vs Unclean's 5+ front: [5, 6, 1, 1, 1] → 2 hits. Crit checks [1, 1].
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [4, 1, 5, 6, 1, 1, 1, 1, 1]);
    expect(logOf(s2, "turrets")[0]?.data).toMatchObject({ stopped: 1 });
    expect(logOf(s2, "attack")[0]?.data).toMatchObject({ weapon: "torpedo", facing: "front", need: 5, hits: 2 });
    expect(unclean(s2).damage).toBe(2);
    const salvo = s2.ordnance.find((o) => o.id === "ord-900")!;
    expect(salvo).toMatchObject({ strength: 3, attacks: [{ targetId: "ship-2", round: 1 }] });
    expect(salvo.position.y).toBeCloseTo(110, 10); // through and out the other side, without a second attack
  });

  test("turrets can stop a salvo outright", () => {
    const s1 = play(inbound(2), moveSalvo("ord-900"));
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [4, 6]);
    expect(removed(s2)).toEqual(["turrets"]);
    expect(unclean(s2).damage).toBe(0);
  });

  test("every torpedo hitting spends the salvo", () => {
    const s1 = play(inbound(2), moveSalvo("ord-900"));
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [1, 1, 5, 5, 1, 1]);
    expect(removed(s2)).toEqual(["spent"]);
    expect(unclean(s2).damage).toBe(2);
  });

  test("a target sitting in a Blast Marker makes the salvo test first", () => {
    const run = (roll: number) => {
      const s0 = inbound();
      addBm(s0, 102.7, 105.5); // touching Unclean's base, clear of the salvo's path
      return playDice(s0, moveSalvo("ord-900"), [roll]);
    };
    expect(removed(run(6))).toEqual(["blast_marker"]);
    const passed = run(3);
    expect(logOf(passed, "bm_test")[0]?.data).toMatchObject({ effect: "none" });
    expect(passed.pending).toHaveLength(1);
  });
});
