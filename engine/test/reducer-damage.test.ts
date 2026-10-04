import { describe, expect, test } from "vitest";
import { Ctx } from "../src/reducer/context";
import { catastrophic, critical, inflict, type DamageSource } from "../src/reducer/damage";
import { placeCluster, placeShieldBlastMarkers } from "../src/reducer/blast";
import { BM_RADIUS, EPS } from "../src/geometry/constants";
import { distance } from "../src/geometry/basic";
import type { GameState, Ship } from "../src/state/types";
import { addBm, addShip, agrippa, battle, broadside, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";

/** Run internal damage code directly, with scripted dice that must all be used. */
function withDice(s: GameState, dice: number[], fn: (ctx: Ctx) => void): GameState {
  const ctx = new Ctx(s, [...dice]);
  fn(ctx);
  expect(ctx.unusedScript).toEqual([]);
  return s;
}

const gunfire = (from: Ship): DamageSource => ({
  source: { kind: "ship", id: from.id }, origin: from.position!, shieldable: true, braceable: true, cause: "battery",
});

describe("critical hits (§6)", () => {
  const crit = (ship: (s: GameState) => Ship, dice: number[], prep?: (x: Ship) => void) => {
    const s = battle();
    if (prep) prep(ship(s));
    withDice(s, dice, (ctx) => critical(ctx, ship(s)));
    return { s, ship: ship(s), log: logOf(s, "critical")[0]?.data };
  };

  test.each([
    [[1, 1], "starboard_armament", 2, 3, 0], // Murder has no dorsal weapons: next highest
    [[2, 2], "port_armament", 4, 4, 0],
    [[1, 4], "prow_armament", 5, 5, 0],
    [[3, 3], "engine_room", 6, 6, 1],
    [[3, 4], "fire", 7, 7, 0],
    [[4, 4], "thrusters", 8, 8, 1],
    [[4, 5], "bridge_smashed", 9, 9, 0],
    [[5, 5], "shields_collapse", 10, 10, 0],
  ] as const)("2D6 %j → %s", (dice, _kind, rolled, applied, extra) => {
    const { ship, log } = crit(unclean, [...dice]);
    expect(log).toMatchObject({ rolled, applied });
    expect(ship.damage).toBe(extra);
  });

  test("4 gives port_armament on a ship with port weapons", () => {
    expect(crit(unclean, [2, 2]).ship.criticals.map((c) => c.kind)).toEqual(["port_armament"]);
  });

  test("Hull Breach: D3 extra damage; Bulkhead Collapse: D6", () => {
    expect(crit(unclean, [5, 6, 4]).ship.damage).toBe(2); // D3 from a 4
    expect(crit(unclean, [6, 6, 5]).ship.damage).toBe(5);
    expect(crit(unclean, [6, 6, 5]).ship.criticals).toEqual([]); // neither is stored
  });

  test("an unrepairable critical can't apply twice: it moves up the table", () => {
    const { ship, log } = crit(unclean, [4, 5, 3], (x) => {
      x.criticals.push({ id: "crit-800", kind: "bridge_smashed", playerTurn: 0 }, { id: "crit-801", kind: "shields_collapse", playerTurn: 0 });
    });
    expect(log).toMatchObject({ rolled: 9, applied: 11, kind: "hull_breach", extraRolls: [3] });
    expect(ship.damage).toBe(2);
  });

  test("critical extra damage makes no further critical checks", () => {
    const s = battle();
    withDice(s, [3, 3], (ctx) => critical(ctx, unclean(s))); // Engine Room +1: no crit-check die drawn
    expect(logOf(s, "damage")[0]?.data).toEqual({ shipId: "ship-2", cause: "critical", damageAfter: 1 });
  });
});

describe("inflict (§3)", () => {
  test("a critical check per hull hit; the killing point makes none, then catastrophic damage", () => {
    const s = broadside();
    agrippa(s).damage = 6;
    agrippa(s).specialOrder = { kind: "lock_on", issued: 0, expires: { playerTurn: 2, at: "movement_start" }, replaced: null };
    addBm(s, 76, 46 - 2.85);
    addBm(s, 76, 46 + 2.85); // shields down
    // 3 hits: point 7 + crit check [2]; point 8 (no check); overkill discarded; catastrophic [1, 2] → drifting hulk.
    withDice(s, [2, 1, 2], (ctx) => inflict(ctx, agrippa(s), 3, gunfire(unclean(s))));
    expect(agrippa(s)).toMatchObject({ damage: 8, status: "drifting_hulk", specialOrder: null });
    const hulkBm = s.blastMarkers.at(-1)!;
    expect(hulkBm).toMatchObject({ position: { x: 76, y: 46 }, cause: "hulk" });
  });

  test("7–8 make a blazing hulk", () => {
    const s = broadside();
    agrippa(s).damage = 8;
    withDice(s, [3, 4], (ctx) => catastrophic(ctx, agrippa(s)));
    expect(agrippa(s).status).toBe("blazing_hulk");
  });

  test("9–11: Plasma Drive Overload. Half the starting hits in BMs and lance strength, ships within 3D6 cm queued", () => {
    const s = broadside(); // Agrippa and Unclean ≈ 24.3 cm apart
    agrippa(s).damage = 8;
    const near = addShip(s, unclean(s), { position: { x: 80, y: 46 } }); // 4 cm away
    withDice(s, [4, 5, 2, 2, 3], (ctx) => catastrophic(ctx, agrippa(s))); // radius 7
    expect(agrippa(s)).toMatchObject({ status: "destroyed", position: null, heading: null });
    expect(s.blastMarkers.filter((b) => b.cause === "explosion")).toHaveLength(4);
    expect(logOf(s, "catastrophic")[0]?.data).toMatchObject({ outcome: "plasma_drive_overload", radius: 7, radiusRolls: [2, 2, 3] });
    expect(s.queue).toEqual([
      { kind: "brace_offer", shipId: near.id, source: { kind: "explosion", id: "ship-1" } },
      { kind: "explosion_hit", shipId: "ship-1", centre: { x: 76, y: 46 }, strength: 4, targetId: near.id },
    ]);
  });

  test("12: Warp Drive Implosion. Full starting hits", () => {
    const s = broadside();
    agrippa(s).damage = 8;
    withDice(s, [6, 6, 1, 1, 1], (ctx) => catastrophic(ctx, agrippa(s)));
    expect(s.blastMarkers.filter((b) => b.cause === "explosion")).toHaveLength(8);
    expect(logOf(s, "catastrophic")[0]?.data).toMatchObject({ outcome: "warp_drive_implosion", radius: 3 });
  });

  test("hits on a hulk: one catastrophic re-roll per source per turn, and no damage", () => {
    const s = broadside();
    Object.assign(agrippa(s), { status: "drifting_hulk", damage: 8 });
    withDice(s, [4, 4], (ctx) => {
      inflict(ctx, agrippa(s), 3, gunfire(unclean(s)));
      inflict(ctx, agrippa(s), 2, gunfire(unclean(s))); // same source: no second roll
    });
    expect(agrippa(s)).toMatchObject({ status: "blazing_hulk", damage: 8 });
    expect(s.turnState.hulkRolls).toEqual([{ hulkId: "ship-1", source: { kind: "ship", id: "ship-2" } }]);
    expect(s.blastMarkers).toEqual([]); // R4: no extra BM
  });
});

describe("an explosion chain, end to end", () => {
  test("a broadside kills Agrippa; its warp drive implodes over Unclean; p1's fleet is gone", () => {
    const s0 = broadside();
    Object.assign(agrippa(s0), { position: { x: 86, y: 50 }, damage: 7 });
    addBm(s0, 86, 50 - 2.85);
    addBm(s0, 86, 50 + 2.85); // Agrippa's shields are down; short range −1 and BMs +1 cancel: column D
    const asked = play(s0, { type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target: { kind: "ship", id: "ship-1" } });

    // Agrippa declines to brace: 4 dice [5,1,1,1] → 1 hit → 8th damage (no crit check) → catastrophic 12
    // → radius 18 → 8 BMs; Unclean (14 cm away) is offered a brace.
    const s1 = playDice(asked, { type: "answer_brace", player: "p1", pendingId: asked.pending[0]!.id, attempt: false }, [5, 1, 1, 1, 6, 6, 6, 6, 6]);
    expect(agrippa(s1).status).toBe("destroyed");
    expect(s1.pending).toMatchObject([{ player: "p2", shipId: "ship-2", source: { kind: "explosion", id: "ship-1" } }]);
    expect(s1.queue).toMatchObject([{ kind: "explosion_hit", strength: 8, targetId: "ship-2" }]);

    // Unclean declines: 8 lance shots [4,4,4,4,1,1,1,1] → 4 hits; 2 on shields, 2 to the hull, crit checks [1,1].
    const s2 = playDice(s1, { type: "answer_brace", player: "p2", pendingId: s1.pending[0]!.id, attempt: false }, [4, 4, 4, 4, 1, 1, 1, 1, 1, 1]);
    expect(unclean(s2).damage).toBe(2);
    expect(s2.result).toEqual({ reason: "fleet_eliminated", scores: { p1: 2, p2: 11 }, winner: "p2" });
  });
});

describe("fires burn (§10.2)", () => {
  test("in the owner's End Phase, after repairs, with no critical checks; enough fire wrecks the ship", () => {
    const s0 = battle("end", "damage_control"); // p2's turn: Unclean's fires burn now
    unclean(s0).damage = 6;
    unclean(s0).criticals = [
      { id: "crit-800", kind: "fire", playerTurn: 1 },
      { id: "crit-801", kind: "fire", playerTurn: 1 },
    ];
    // Repair: 2 dice [1, 1], nothing fixed. Fires: 2 damage → 8 → catastrophic [2, 3] → drifting hulk.
    const s = playDice(s0, { type: "repair", player: "p2", shipId: "ship-2", priority: ["crit-800", "crit-801"] }, [1, 1, 2, 3]);
    expect(logOf(s, "fire_damage")[0]?.data).toEqual({ shipId: "ship-2", fires: 2 });
    expect(unclean(s)).toMatchObject({ damage: 8, status: "drifting_hulk" });
    expect(s.result?.reason).toBe("fleet_eliminated"); // p2's only ship is a hulk
  });
});

describe("Blast Marker placement (§5)", () => {
  test("shield hits fan around the base; a seventh stacks in the line of fire", () => {
    const s = broadside();
    withDice(s, [], (ctx) => placeShieldBlastMarkers(ctx, agrippa(s), 7, unclean(s).position!));
    const stem = agrippa(s).position!;
    const markers = s.blastMarkers;
    expect(markers).toHaveLength(7);
    for (const bm of markers) expect(distance(stem, bm.position)).toBeCloseTo(1.6 + BM_RADIUS, 10);
    const firstSix = markers.slice(0, 6);
    for (const [i, a] of firstSix.entries()) {
      for (const b of firstSix.slice(i + 1)) expect(distance(a.position, b.position)).toBeGreaterThan(2 * BM_RADIUS - EPS);
    }
    expect(markers[6]!.position).toEqual(markers[0]!.position);
  });

  test("an explosion cluster: one at the centre, then touching rings with no overlaps", () => {
    const s = battle();
    withDice(s, [], (ctx) => placeCluster(ctx, { x: 50, y: 50 }, 8));
    expect(s.blastMarkers[0]!.position).toEqual({ x: 50, y: 50 });
    const ps = s.blastMarkers.map((b) => b.position);
    for (const [i, a] of ps.entries()) for (const b of ps.slice(i + 1)) expect(distance(a, b)).toBeGreaterThan(2 * BM_RADIUS - EPS);
    expect(distance(ps[1]!, { x: 50, y: 50 })).toBeCloseTo(2.5, 12);
    expect(ps[1]).toEqual({ x: 50, y: 52.5 }); // ring 1 starts at bearing 0, exactly
  });
});
