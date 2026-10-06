/**
 * The nova cannon (state v0.11 N13–N14; transforms v0.9 §4.3, T40–T48;
 * validator v0.7 fire_nova_cannon, V10–V11; reducer v0.8 §4.4, R26–R29).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import type { GameState } from "../src/state/types";
import { addSalvo, addShip, agrippa, battle, expectOk, expectReject, unclean } from "./validator-fixtures";
import { logOf, playDice } from "./reducer-helpers";
import { novaBraceShips, novaScatterDice } from "../src/reducer/nova";
import { novaRange } from "../src/geometry/targeting";
import { LUNAR_VS_MURDER } from "./helpers";

/**
 * Unclean (p2, active, shooting) refitted as a Dominator at (90, 20) facing up
 * the table; Agrippa at (90, 60) facing it. Aiming at Agrippa's stem is 37.5 cm
 * to the template's near edge: one scatter die.
 */
function dominator(): GameState {
  const s = battle("shooting", "direct_fire");
  unclean(s).profile = cloneJson(CATALOGUE["dominator"]!.profile);
  Object.assign(unclean(s), { position: { x: 90, y: 20 }, heading: 0 });
  Object.assign(agrippa(s), { position: { x: 90, y: 60 }, heading: 180 });
  return s;
}
const nova = (aim: { x: number; y: number }, patch: Record<string, unknown> = {}) =>
  ({ type: "fire_nova_cannon", player: "p2", shipId: "ship-2", weaponId: "prow_nova_cannon", aim, ...patch }) as const;
const AT_AGRIPPA = { x: 90, y: 60 };

describe("fire_nova_cannon: validation", () => {
  test("aimed at a point 30–150 cm away in the prow arc", () => {
    expectOk(dominator(), nova(AT_AGRIPPA));
    expectOk(dominator(), nova({ x: 90, y: 52.5 })); // near edge exactly 30 cm (V11)
    expectReject(dominator(), nova({ x: 90, y: 52 }), "OUT_OF_RANGE", { min: 30, max: 150 });
    const far = dominator();
    Object.assign(unclean(far), { position: { x: 10, y: 60 }, heading: 90 });
    Object.assign(agrippa(far), { position: { x: 90, y: 100 } });
    expectOk(far, nova({ x: 162.5, y: 60 })); // near edge exactly 150 cm
    expectReject(far, nova({ x: 163, y: 60 }), "OUT_OF_RANGE");
    expectReject(dominator(), nova({ x: 90, y: -1 }), "AIM_OFF_TABLE");
    expectReject(dominator(), nova({ x: 140, y: 30 }), "OUT_OF_ARC"); // off the starboard beam
  });

  test("only a nova cannon, through the right transform", () => {
    expectReject(dominator(), nova(AT_AGRIPPA, { weaponId: "port_battery" }), "WRONG_WEAPON_KIND");
    expectReject(dominator(), { type: "fire", player: "p2", shipId: "ship-2", weaponId: "prow_nova_cannon", target: { kind: "ship", id: "ship-1" } }, "WRONG_WEAPON_KIND");
    const fired = dominator();
    fired.turnState.ships["ship-2"]!.weaponsFired.push("prow_nova_cannon");
    expectReject(fired, nova(AT_AGRIPPA), "WEAPON_ALREADY_FIRED");
    const smashed = dominator();
    unclean(smashed).criticals.push({ id: "crit-1", kind: "prow_armament", playerTurn: 1 });
    expectReject(smashed, nova(AT_AGRIPPA), "WEAPON_DISABLED");
  });

  test("not while crippled, or on AAF, Come To New Heading, Burn Retros or Brace; Lock On is fine", () => {
    const crippled = dominator();
    unclean(crippled).damage = 4;
    expectReject(crippled, nova(AT_AGRIPPA), "NOVA_CANNON_BARRED", { why: "crippled" });
    for (const kind of ["all_ahead_full", "come_to_new_heading", "burn_retros", "brace_for_impact"] as const) {
      const s = dominator();
      unclean(s).specialOrder = { kind, issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
      expectReject(s, nova(AT_AGRIPPA), "NOVA_CANNON_BARRED", { why: "order", order: kind });
    }
    const lockOn = dominator();
    unclean(lockOn).specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    expectOk(lockOn, nova(AT_AGRIPPA));
  });

  test("hulks block the line, unless the template touches the hulk at the aim point (T44); no target priority (N14)", () => {
    const s = dominator();
    addShip(s, agrippa(s), { name: "Wreck", status: "drifting_hulk", damage: 8, position: { x: 90, y: 54 } });
    expectReject(s, nova(AT_AGRIPPA), "LINE_OF_FIRE_BLOCKED"); // the template at Agrippa doesn't reach the wreck
    expectOk(s, nova({ x: 90, y: 57 })); // it does here: firing at the wreck
    const failed = dominator();
    failed.turnState.ships["ship-2"]!.priorityTest = "failed";
    expectOk(failed, nova({ x: 120, y: 80 })); // nowhere near the nearest enemy
  });
});

/** Fire at `aim`, decline every brace offered (each ship in reach is asked), then roll `dice` after the last answer. */
function shoot(s: GameState, aim: { x: number; y: number }, dice: number[]): GameState {
  const shooter = unclean(s);
  const offers = novaBraceShips(s, shooter, aim, novaScatterDice(novaRange(shooter, aim))).length;
  let next = playDice(s, nova(aim) as never, offers === 0 ? dice : []);
  for (let i = 0; i < offers; i++) {
    const top = next.pending.at(-1)!;
    next = playDice(next, { type: "answer_brace", player: top.player, pendingId: top.id, attempt: false }, i === offers - 1 ? dice : []);
  }
  return next;
}

describe("the shot (reducer §4.4)", () => {
  test("a hit on the scatter die: the hole's D6 hits, through shields, with critical checks", () => {
    // scatter 2 (hit), hole 4; then the two unshielded hits' critical checks
    const s = shoot(dominator(), AT_AGRIPPA, [2, 4, 1, 1]);
    expect(s.turnState.ships["ship-2"]!.weaponsFired).toEqual(["prow_nova_cannon"]);
    expect(logOf(s, "nova_cannon")[0]?.data).toMatchObject({
      shipId: "ship-2",
      range: 37.5,
      dice: 1,
      rolls: [2, 4],
      scatter: "hit",
      centre: AT_AGRIPPA,
      ships: [{ shipId: "ship-1", hole: true, hits: 4 }],
      ordnanceIds: [],
      blastMarkerId: null,
    });
    expect(logOf(s, "shields")[0]?.data).toMatchObject({ shipId: "ship-1", absorbed: 2 });
    expect(agrippa(s).damage).toBe(2);
  });

  test("scatter: 2D6 pick one of 36 bearings, the scatter dice the distance; an edge contact is 1 hit", () => {
    // scatter 3; direction [1, 1] → bearing 0; 1D6 → 3 cm: centre (90, 63), Agrippa's base touches the edge only
    const s = shoot(dominator(), AT_AGRIPPA, [3, 1, 1, 3]);
    expect(logOf(s, "nova_cannon")[0]?.data).toMatchObject({
      rolls: [3, 1, 1, 3],
      scatter: { bearing: 0, distance: 3 },
      centre: { x: 90, y: 63 },
      ships: [{ shipId: "ship-1", hole: false, hits: 1 }],
    });
    expect(logOf(s, "shields")[0]?.data).toMatchObject({ absorbed: 1 });
    // direction [2, 4]: 60 + 30 = 90°, to starboard on the table
    const east = shoot(dominator(), AT_AGRIPPA, [6, 2, 4, 6]);
    expect(logOf(east, "nova_cannon")[0]?.data).toMatchObject({ scatter: { bearing: 90, distance: 6 }, centre: { x: 96, y: 60 } });
  });

  test("touching nothing leaves a Blast Marker where it landed, unless that's off the table (T46)", () => {
    const s = shoot(dominator(), AT_AGRIPPA, [5, 1, 1, 6]); // to (90, 66): clear of Agrippa
    expect(logOf(s, "nova_cannon")[0]?.data).toMatchObject({ ships: [], centre: { x: 90, y: 66 } });
    const bm = s.blastMarkers.at(-1)!;
    expect(bm).toMatchObject({ position: { x: 90, y: 66 }, cause: "nova_miss" });
    expect(logOf(s, "nova_cannon")[0]?.data).toMatchObject({ blastMarkerId: bm.id });

    // Aimed near the top edge, 96.5 cm away: 3D6, and 18 cm takes it off the table.
    const edge = dominator();
    const off = playDice(edge, nova({ x: 90, y: 119 }) as never, [3, 1, 1, 6, 6, 6]); // Agrippa is out of reach: no brace offer
    expect(logOf(off, "nova_cannon")[0]?.data).toMatchObject({ dice: 3, centre: { x: 90, y: 137 }, blastMarkerId: null });
    expect(off.blastMarkers).toHaveLength(edge.blastMarkers.length);
  });

  test("brace is offered first to every ship the worst scatter could reach, the enemy's first, friends included (T41)", () => {
    const s = dominator();
    addShip(s, unclean(s), { name: "Escort", position: { x: 96, y: 60 } }); // p2's own, 6 cm from the aim
    addShip(s, agrippa(s), { name: "Far", position: { x: 20, y: 100 } }); // p1's, far out of reach
    let next = playDice(s, nova(AT_AGRIPPA) as never, []);
    expect(next.pending.map((p) => [p.player, p.shipId])).toEqual([["p1", "ship-1"]]);
    next = playDice(next, { type: "answer_brace", player: "p1", pendingId: next.pending[0]!.id, attempt: false }, []);
    expect(next.pending.map((p) => p.player)).toEqual(["p2"]);
    // The shooter's own ship braces (Ld 7: 3 + 3 passes), then the shot: a hit, the hole on Agrippa.
    next = playDice(next, { type: "answer_brace", player: "p2", pendingId: next.pending[0]!.id, attempt: true }, [3, 3, 1, 6, 1, 1, 1, 1]);
    expect(next.ships.find((x) => x.name === "Escort")!.specialOrder?.kind).toBe("brace_for_impact");
    expect(logOf(next, "nova_cannon")[0]?.data).toMatchObject({ ships: [{ shipId: "ship-1", hole: true, hits: 6 }] });
  });

  test("friendly ships under the template are hit too (D17); hole dice are drawn for all before any damage (R27)", () => {
    const s = dominator();
    const friend = addShip(s, unclean(s), { name: "Friend", position: { x: 91, y: 60 } }); // also under the hole
    const next = shoot(s, AT_AGRIPPA, [1, 3, 5, 1, 1, 1, 1]);
    // Agrippa's and Friend's hole dice come straight after the scatter die
    expect(logOf(next, "nova_cannon")[0]?.data).toMatchObject({
      rolls: [1, 3, 5],
      ships: [
        { shipId: "ship-1", hole: true, hits: 3 },
        { shipId: friend.id, hole: true, hits: 5 },
      ],
    });
    expect(agrippa(next).damage).toBe(1);
    expect(next.ships.find((x) => x.id === friend.id)!.damage).toBe(3);
  });

  test("ordnance under the template is removed, whoever owns it, and counts as touching something (T45)", () => {
    const s = dominator();
    const salvo = addSalvo(s, { owner: "p2", launchedBy: "ship-2", position: { x: 92, y: 80 }, heading: 270 });
    const next = shoot(s, { x: 90, y: 80 }, [1]); // a hit, out of Agrippa's reach
    expect(next.ordnance.find((o) => o.id === salvo.id)).toBeUndefined();
    expect(logOf(next, "ordnance_removed").at(-1)?.data).toEqual({ ordnanceId: salvo.id, reason: "nova_cannon" });
    expect(logOf(next, "nova_cannon")[0]?.data).toMatchObject({ ordnanceIds: [salvo.id], blastMarkerId: null });
  });

  test("the scatter dice follow the range: ≤ 45 one, ≤ 60 two, beyond three", () => {
    for (const [y, dice] of [[67.5, 1], [67.6, 2], [82.5, 2], [82.6, 3]] as const) {
      const s = dominator();
      agrippa(s).position = { x: 10, y: 110 };
      const next = playDice(s, nova({ x: 90, y }) as never, [1]);
      expect(logOf(next, "nova_cannon")[0]?.data).toMatchObject({ dice });
    }
  });
});

describe("the direct-fire step", () => {
  test("waits for an unfired nova cannon, but not one that can't fire", () => {
    const s = dominator();
    s.turnState.ships["ship-2"]!.weaponsFired.push("port_battery", "starboard_battery");
    const s2 = cloneJson(s);
    const after = shoot(s, { x: 90, y: 100 }, [1]);
    expect(after.clock.step).not.toBe("direct_fire");
    // Crippled, the cannon can't fire, so an end_step isn't needed to leave the step.
    unclean(s2).damage = 4;
    unclean(s2).profile.weapons = unclean(s2).profile.weapons.filter((w) => w.kind === "nova_cannon");
    const moved = playDice(s2, { type: "end_step", player: "p2" }, []);
    expect(moved.clock.step).not.toBe("direct_fire");
  });
});

describe("the nova cannon classes (T48)", () => {
  const config = (p1: string[], forces?: GameConfig["forces"]): GameConfig => ({
    ...cloneJson(LUNAR_VS_MURDER),
    ...(forces !== undefined ? { forces } : {}),
    ships: [
      ...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })),
      ...p1.map((_, i) => ({ owner: "p2" as const, name: `C${i}`, classId: "murder" })),
    ],
  });

  test("points and weapons", () => {
    const points = Object.fromEntries(
      ["lunar_nova", "tyrant_long", "tyrant_nova", "tyrant_long_nova", "dominator", "dominator_long"].map((id) => [id, CATALOGUE[id]!.profile.points]),
    );
    expect(points).toEqual({ lunar_nova: 200, tyrant_long: 195, tyrant_nova: 205, tyrant_long_nova: 215, dominator: 190, dominator_long: 185 });
    const kinds = (id: string) => CATALOGUE[id]!.profile.weapons.map((w) => `${w.id}:${w.kind}:${w.range}:${w.strength}`);
    expect(kinds("lunar_nova").at(-1)).toBe("prow_nova_cannon:nova_cannon:150:1");
    expect(kinds("tyrant_long_nova")).toEqual([
      "port_long_battery:battery:45:4",
      "starboard_long_battery:battery:45:4",
      "port_battery:battery:45:6",
      "starboard_battery:battery:45:6",
      "prow_nova_cannon:nova_cannon:150:1",
    ]);
    expect(kinds("dominator_long").slice(0, 2)).toEqual(["port_battery:battery:45:6", "starboard_battery:battery:45:6"]);
    expect(CATALOGUE["tyrant"]!.profile.weapons.at(-1)?.kind).toBe("torpedoes"); // the base class is untouched
  });

  test("a nova cannon ship has no torpedoes to load; only dominator_long fits Cruiser Clash", () => {
    const s = newGame(config(["dominator_long", "lunar_nova"], { kind: "points", limit: 750 }));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships.find((x) => x.profile.classId === "lunar_nova")!.loaded).toEqual({});
    expect(() => newGame(config(["dominator_long"]))).not.toThrow();
    expect(() => newGame(config(["dominator"]))).toThrow(/185/);
  });
});
