/**
 * Direct fire. The broadside fixture is reducer spec §13: Unclean (ship-2, p2) at
 * (100, 50) heading 180; Agrippa (ship-1) at (76, 46) heading 0, ≈ 24.3 cm off
 * Unclean's starboard side, abeam.
 */
import { describe, expect, test } from "vitest";
import { gunnery } from "../src/reducer/gunnery";
import { BM_RADIUS } from "../src/geometry/constants";
import { distance, tableBearing } from "../src/geometry/basic";
import type { GameState } from "../src/state/types";
import { addBm, addSalvo, addShip, agrippa, broadside, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";

const fire = (weaponId: string, target: { kind: "ship" | "ordnance"; id: string } = { kind: "ship", id: "ship-1" }) =>
  ({ type: "fire", player: "p2", shipId: "ship-2", weaponId, target }) as const;

/** Fire, then decline Agrippa's brace: returns the state after the shot resolves. */
function fireAndDecline(s: GameState, weaponId: string, dice: number[]): GameState {
  const asked = play(s, fire(weaponId));
  expect(asked.pending).toHaveLength(1);
  return playDice(asked, { type: "answer_brace", player: "p1", pendingId: asked.pending[0]!.id, attempt: false }, dice);
}

describe("the Gunnery Table", () => {
  test("p. 62 spot checks, and firepower above 20", () => {
    expect(gunnery(10, "B")).toBe(7); // Unclean's closing broadside (p. 60)
    expect(gunnery(10, "A")).toBe(9);
    expect(gunnery(10, "C")).toBe(5);
    expect(gunnery(6, "D")).toBe(2);
    expect(gunnery(1, "D")).toBe(0);
    expect(gunnery(32, "B")).toBe(14 + 8); // 20 + 12
    expect(gunnery(0, "A")).toBe(0);
  });
});

describe("reducer spec §13, the worked example", () => {
  test("Unclean's starboard battery: brace offered, declined; 4 dice on column D, 2 hits, both on shields", () => {
    const asked = play(broadside(), fire("starboard_battery"));
    // Paused on Agrippa's brace decision, with the shot waiting in the queue.
    expect(asked.pending).toMatchObject([{ player: "p1", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } }]);
    expect(asked.queue).toMatchObject([{ kind: "direct_fire", weaponId: "starboard_battery", arc: "right", aspect: "right" }]);
    expect(asked.turnState.ships["ship-2"]!.weaponsFired).toEqual(["starboard_battery"]);

    const s = playDice(asked, { type: "answer_brace", player: "p1", pendingId: asked.pending[0]!.id, attempt: false }, [6, 2, 5, 3]);
    expect(logOf(s, "attack")[0]?.data).toEqual({
      source: { kind: "ship", id: "ship-2" }, targetId: "ship-1", weapon: "battery",
      column: "D", shifts: 0, need: 5, rolls: [6, 2, 5, 3], rerolls: [], hits: 2,
    });
    expect(agrippa(s).damage).toBe(0);
    const shieldLog = logOf(s, "shields")[0]?.data;
    expect(shieldLog).toMatchObject({ shipId: "ship-1", absorbed: 2 });
    // Two BMs on Agrippa's ring: first in the line of fire (≈ 80.5°), the next one slot clockwise (+ ≈ 52°).
    const [first, second] = s.blastMarkers;
    const stem = agrippa(s).position!;
    for (const bm of [first!, second!]) expect(distance(stem, bm.position)).toBeCloseTo(1.6 + BM_RADIUS, 10);
    expect(tableBearing(stem, first!.position)).toBeCloseTo(80.54, 2);
    expect(tableBearing(stem, second!.position)).toBeCloseTo(80.54 + 52.03, 1);
  });
});

describe("batteries", () => {
  test("Agrippa's shields down: hits go to the hull, each with a critical check", () => {
    const s0 = broadside();
    addBm(s0, 76, 46 - 2.85);
    addBm(s0, 76, 46 + 2.85); // two BMs in contact: capacity 0, and a column shift right
    // Column D → E: 10 FP = 2 dice. Hits on 5+: [5, 6] → 2 damage; crit checks [1, 2].
    const s = fireAndDecline(s0, "starboard_battery", [5, 6, 1, 2]);
    expect(logOf(s, "attack")[0]?.data).toMatchObject({ column: "E", shifts: 1, rolls: [5, 6], hits: 2 });
    expect(agrippa(s).damage).toBe(2);
    expect(logOf(s, "damage").map((e) => e.data.damageAfter)).toEqual([1, 2]);
  });

  test("short range shifts left; long range right", () => {
    const close = broadside();
    agrippa(close).position = { x: 86, y: 50 }; // 14 cm: column D → C, 10 FP = 5 dice
    const c = fireAndDecline(close, "starboard_battery", [1, 1, 1, 1, 1]);
    expect(logOf(c, "attack")[0]?.data).toMatchObject({ column: "C", shifts: -1 });

    const far = broadside();
    agrippa(far).position = { x: 60, y: 50 }; // 40 cm: D → E, 2 dice
    const f = fireAndDecline(far, "starboard_battery", [1, 1]);
    expect(logOf(f, "attack")[0]?.data).toMatchObject({ column: "E", shifts: 1 });
  });

  test("Lock On re-rolls the misses, straight after", () => {
    const s0 = broadside();
    unclean(s0).specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    // 4 dice [5, 1, 1, 1] → 1 hit; re-roll 3 misses [6, 2, 2] → 1 more. 2 hits, both absorbed by shields.
    const s = fireAndDecline(s0, "starboard_battery", [5, 1, 1, 1, 6, 2, 2]);
    expect(logOf(s, "attack")[0]?.data).toMatchObject({ rolls: [5, 1, 1, 1], rerolls: [6, 2, 2], hits: 2 });
  });

  test("a target that moved under 5 cm is shot on the Defences column", () => {
    const s0 = broadside();
    agrippa(s0).lastMove = { playerTurn: 0, distance: 0 };
    const s = fireAndDecline(s0, "starboard_battery", [1, 1, 1, 1, 1, 1, 1, 1, 1]); // column A: 9 dice
    expect(logOf(s, "attack")[0]?.data).toMatchObject({ column: "A" });
  });
});

describe("lances, bracing, ordnance and priority", () => {
  test("lances hit on 4+ whatever the armour, and ignore column shifts", () => {
    const s0 = broadside();
    unclean(s0).position = { x: 76, y: 70 }; // dead ahead of Agrippa, 24 cm: Unclean's prow lances bear (it faces south)
    addBm(s0, 76, 60);
    // Str 2: [4, 6] → 2 hits; shields absorb both.
    const s = fireAndDecline(s0, "prow_lances", [4, 6]);
    expect(logOf(s, "attack")[0]?.data).toEqual({
      source: { kind: "ship", id: "ship-2" }, targetId: "ship-1", weapon: "lance", need: 4, rolls: [4, 6], rerolls: [], hits: 2,
    });
  });

  test("Brace: shields first, then a 4+ save per remaining hit", () => {
    const s0 = broadside();
    addBm(s0, 76, 46 - 2.85); // shields capacity 1
    const asked = play(s0, fire("starboard_battery"));
    // Brace check [1, 1] passes; 2 dice on column E [6, 5] → 2 hits; 1 absorbed; 1 save roll [4] saves it.
    const s = playDice(asked, { type: "answer_brace", player: "p1", pendingId: asked.pending[0]!.id, attempt: true }, [1, 1, 6, 5, 4]);
    expect(agrippa(s).specialOrder?.kind).toBe("brace_for_impact");
    expect(logOf(s, "brace_saves")[0]?.data).toEqual({ shipId: "ship-1", rolls: [4], saved: 1 });
    expect(agrippa(s).damage).toBe(0);
  });

  test("a hit on a torpedo salvo removes it (6s only, column E)", () => {
    const s0 = broadside();
    const salvo = addSalvo(s0, { owner: "p1", position: { x: 85, y: 50 } }); // 15 cm: E → D, 10 FP = 4 dice
    const s = playDice(s0, fire("starboard_battery", { kind: "ordnance", id: salvo.id }), [6, 1, 1, 1]);
    expect(s.ordnance).toEqual([]);
    expect(logOf(s, "ordnance_removed")[0]?.data).toEqual({ ordnanceId: salvo.id, reason: "shot" });
    expect(s.pending).toEqual([]); // no brace for ordnance
  });

  test("a failed priority test costs nothing but the test: the weapon is still unfired", () => {
    const s0 = broadside();
    addShip(s0, agrippa(s0), { position: { x: 85, y: 50 } }); // a nearer Lunar
    const s = playDice(s0, fire("starboard_battery"), [6, 6]); // Ld 7 test fails
    expect(s.turnState.ships["ship-2"]).toMatchObject({ priorityTest: "failed", weaponsFired: [] });
    expect(s.pending).toEqual([]);
    expect(logOf(s, "priority_test")[0]?.data).toEqual({ shipId: "ship-2", target: 7, rolls: [6, 6], passed: false });
  });

  test("a passed test is remembered for the rest of the phase", () => {
    const s0 = broadside();
    addShip(s0, agrippa(s0), { position: { x: 85, y: 50 } });
    const s = playDice(s0, fire("starboard_battery"), [1, 1]);
    expect(s.turnState.ships["ship-2"]).toMatchObject({ priorityTest: "passed", weaponsFired: ["starboard_battery"] });
    expect(s.pending).toHaveLength(1); // now the brace offer
  });
});
