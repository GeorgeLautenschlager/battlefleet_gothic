/**
 * Movement checks. Unclean (ship-2, p2) starts at (100, 105) heading 180 (south), speed 25.
 * Distances are chosen so the expected limits can be checked by hand.
 */
import { describe, test } from "vitest";
import type { PathStep } from "../src/state/types";
import { addBm, addShip, agrippa, battle, expectOk, expectReject, ordered, unclean } from "./validator-fixtures";

const a = (distance: number): PathStep => ({ kind: "advance", distance });
const turn = (degrees: number): PathStep => ({ kind: "turn", degrees });
const move = (path: PathStep[], extra: Record<string, unknown> = {}) => ({
  type: "move", player: "p2", shipId: "ship-2", path, disengage: false, ...extra,
});
const order = (o: string, extra: Record<string, unknown> = {}) => ({ type: "declare_order", player: "p2", shipId: "ship-2", order: o, ...extra });

describe("move: whose ship", () => {
  test.each([
    ["UNKNOWN_SHIP", { shipId: "ship-99" }],
    ["NOT_YOUR_SHIP", { shipId: "ship-1" }],
  ] as const)("%s", (code, patch) => {
    expectReject(battle(), move([a(20)], patch), code);
  });

  test("SHIP_NOT_ACTIVE for a hulk", () => {
    const s = battle();
    Object.assign(unclean(s), { status: "drifting_hulk", damage: 8 });
    expectReject(s, move([a(20)]), "SHIP_NOT_ACTIVE");
  });

  test("ALREADY_MOVED", () => {
    const s = battle();
    s.turnState.ships["ship-2"]!.moved = true;
    expectReject(s, move([a(20)]), "ALREADY_MOVED");
  });

  test("ACTIVATION_OPEN: another ship declared an order and hasn't moved", () => {
    const s = battle();
    const other = addShip(s, unclean(s), { position: { x: 120, y: 105 } });
    s.activation = ordered(other.id);
    expectReject(s, move([a(20)]), "ACTIVATION_OPEN", { shipId: other.id });
    s.activation = ordered("ship-2", { order: "lock_on" });
    expectOk(s, move([a(20)]));
  });
});

describe("move: distance", () => {
  test("anything from half to full speed", () => {
    expectOk(battle(), move([a(12.5)]));
    expectOk(battle(), move([a(25)]));
    expectOk(battle(), move([a(25.0005)])); // within EPS
    expectReject(battle(), move([a(25.01)]), "PATH_TOO_LONG", { limit: 25, slowed: false });
    expectReject(battle(), move([a(12.4)]), "PATH_TOO_SHORT", { limit: 12.5 });
  });

  test("crippled: −5 cm, and half of that is the minimum", () => {
    const s = battle();
    unclean(s).damage = 4;
    expectReject(s, move([a(21)]), "PATH_TOO_LONG", { limit: 20 });
    expectReject(s, move([a(9.9)]), "PATH_TOO_SHORT", { limit: 10 });
    expectOk(s, move([a(10)]));
  });

  test("a Blast Marker on the way costs 5 cm", () => {
    const s = battle();
    addBm(s, 100, 90); // dead ahead: contact after 15 − 2.85 cm
    expectReject(s, move([a(25)]), "PATH_TOO_LONG", { limit: 20, slowed: true });
    expectOk(s, move([a(20)]));
    // Short moves report whether they reached it: 12.1 stops short of the contact at 12.15, 12.2 doesn't.
    expectReject(s, move([a(12.1)]), "PATH_TOO_SHORT", { slowed: false, limit: 12.5 });
    expectReject(s, move([a(12.2)]), "PATH_TOO_SHORT", { slowed: true, limit: 12.5 });
  });

  test("moving off a Blast Marker you start on costs 5 cm too (p. 201)", () => {
    const s = battle();
    addBm(s, 100, 107);
    expectReject(s, move([a(21)]), "PATH_TOO_LONG", { limit: 20, slowed: true });
  });

  test("a ship that can't make half speed must go as far as it can", () => {
    const s = battle();
    unclean(s).profile.speed = 8; // half speed 4; slowed by a BM it starts on → 3
    addBm(s, 100, 107);
    expectOk(s, move([a(3)]));
    expectReject(s, move([a(2.9)]), "PATH_TOO_SHORT", { limit: 3 });
  });

  test("a ship the slowdown takes to 0 cm stays put, rather than having no legal move (V12)", () => {
    const s = battle();
    unclean(s).profile.speed = 5; // half speed 2.5; slowed by a BM it starts on → 0
    addBm(s, 100, 107);
    expectOk(s, move([]));
    expectReject(s, move([a(1)]), "PATH_TOO_LONG", { limit: 0, slowed: true });
    // Without the Blast Marker, staying put is still too short.
    const clear = battle();
    unclean(clear).profile.speed = 5;
    expectReject(clear, move([]), "PATH_TOO_SHORT", { limit: 2.5 });
  });
});

describe("move: path steps and turns", () => {
  test.each([
    ["a zero advance", [a(0), a(20)]],
    ["a negative advance", [a(-5), a(25)]],
    ["a zero turn", [a(20), turn(0)]],
  ])("INVALID_PATH_STEP: %s", (_name, path) => {
    expectReject(battle(), move(path), "INVALID_PATH_STEP");
  });

  test("TURN_TOO_SHARP beyond 45°", () => {
    expectReject(battle(), move([a(10), turn(50), a(10)]), "TURN_TOO_SHARP", { stepIndex: 1, degrees: 50, max: 45 });
    expectOk(battle(), move([a(10), turn(-45), a(10)]));
  });

  test("one turn normally; two is too many", () => {
    expectReject(battle(), move([a(10), turn(45), a(10), turn(45)]), "TOO_MANY_TURNS", { turns: 2, allowed: 1 });
  });

  test("Come To New Heading allows two, each after 10 cm", () => {
    const s = battle();
    s.activation = ordered("ship-2", { order: "come_to_new_heading" });
    expectOk(s, move([a(10), turn(45), a(10), turn(45), a(5)]));
    expectReject(s, move([a(10), turn(45), a(5), turn(45), a(10)]), "TURN_TOO_EARLY", { stepIndex: 3, sinceLastTurn: 5 });
  });

  test("Lock On and All Ahead Full allow none", () => {
    for (const o of ["lock_on", "all_ahead_full"] as const) {
      const s = battle();
      s.activation = ordered("ship-2", { order: o, aafExtra: o === "all_ahead_full" ? 10 : null });
      expectReject(s, move([a(10), turn(45), a(10)]), "TOO_MANY_TURNS", { allowed: 0 });
    }
  });

  test("Engine Room damage allows none", () => {
    const s = battle();
    unclean(s).criticals.push({ id: "crit-900", kind: "engine_room", playerTurn: 1 });
    expectReject(s, move([a(10), turn(45), a(10)]), "TOO_MANY_TURNS", { allowed: 0 });
  });

  test("Burn Retros: 0 to half speed, may turn without moving first", () => {
    const s = battle();
    s.activation = ordered("ship-2", { order: "burn_retros" });
    expectOk(s, move([]));
    expectOk(s, move([turn(45)]));
    expectOk(s, move([turn(45), a(12.5)]));
    expectReject(s, move([a(13)]), "PATH_TOO_LONG", { limit: 12.5 });
    expectReject(s, move([a(5), turn(45)]), "TURN_TOO_EARLY", { sinceLastTurn: 5 });
  });

  test("without Burn Retros, a turn needs 10 cm first", () => {
    expectReject(battle(), move([turn(45), a(20)]), "TURN_TOO_EARLY", { stepIndex: 0, sinceLastTurn: 0, required: 10 });
  });
});

describe("move: the table edge", () => {
  test("a move may leave the table in its last step, short of half speed", () => {
    const s = battle();
    unclean(s).position = { x: 100, y: 5 };
    expectOk(s, move([a(10)]));
    expectReject(s, move([a(10)], { disengage: true }), "ALREADY_LEAVING_TABLE");
  });

  test("but not part-way through the path", () => {
    const s = battle();
    unclean(s).position = { x: 100, y: 5 };
    expectReject(s, move([a(10), turn(-45), a(5)]), "PATH_CONTINUES_OFF_TABLE");
  });

  test("a disengage test can be requested on a normal move", () => {
    expectOk(battle(), move([a(20)], { disengage: true }));
  });
});

describe("move: All Ahead Full", () => {
  const aaf = (extra = 10) => {
    const s = battle();
    s.activation = ordered("ship-2", { order: "all_ahead_full", aafExtra: extra });
    return s;
  };

  test("must use the full 25 + 4D6 cm", () => {
    expectOk(aaf(), move([a(35)]));
    expectOk(aaf(), move([a(20), a(15)])); // several advances, one straight line
    expectReject(aaf(), move([a(30)]), "MUST_MOVE_FULL_DISTANCE", { total: 30, required: 35 });
    expectReject(aaf(), move([a(36)]), "MUST_MOVE_FULL_DISTANCE", { required: 35 });
  });

  test("a Blast Marker early on slows it: exactly 5 cm less", () => {
    const s = aaf();
    addBm(s, 100, 90); // contact at 12.15
    expectOk(s, move([a(30)]));
    expectReject(s, move([a(35)]), "MUST_MOVE_FULL_DISTANCE", { required: 30 });
  });

  test("a new Blast Marker in the last 5 cm stops it on contact (V4)", () => {
    const s = aaf();
    addBm(s, 100, 105 - 32 - 2.85); // contact at 32, within 30–35
    expectOk(s, move([a(32)]));
    expectReject(s, move([a(35)]), "MUST_STOP_AT_BLAST_MARKER", { total: 35 });
  });

  test("starting on a Blast Marker slows it from the outset", () => {
    const s = aaf();
    addBm(s, 100, 107);
    expectOk(s, move([a(30)]));
  });

  test("it may run off the table before its full distance", () => {
    const s = aaf();
    unclean(s).position = { x: 100, y: 20 };
    expectOk(s, move([a(25)]));
  });
});

describe("declare_order", () => {
  test("legal on an unmoved active ship", () => {
    expectOk(battle(), order("lock_on"));
    expectOk(battle(), order("all_ahead_full", { ramTargetId: "ship-1" }));
  });

  test("ALREADY_MOVED, ACTIVATION_OPEN", () => {
    const moved = battle();
    moved.turnState.ships["ship-2"]!.moved = true;
    expectReject(moved, order("lock_on"), "ALREADY_MOVED");
    const open = battle();
    open.activation = ordered("ship-2", { order: "lock_on" });
    expectReject(open, order("burn_retros"), "ACTIVATION_OPEN");
  });

  test("ORDERS_LOCKED after a failed Command check", () => {
    const s = battle();
    s.turnState.commandCheckFailed = true;
    expectReject(s, order("lock_on"), "ORDERS_LOCKED");
  });

  test("ALREADY_ON_ORDERS: last turn's Brace blocks new orders", () => {
    const s = battle();
    unclean(s).specialOrder = { kind: "brace_for_impact", issued: 0, expires: { playerTurn: 1, at: "turn_end" }, replaced: null };
    expectReject(s, order("lock_on"), "ALREADY_ON_ORDERS", { order: "brace_for_impact" });
  });

  test("INVALID_ORDER: Brace isn't declared here", () => {
    expectReject(battle(), order("brace_for_impact"), "INVALID_ORDER");
  });

  test("RAM_NOT_ALLOWED: needs All Ahead Full, with ramming on", () => {
    expectReject(battle(), order("lock_on", { ramTargetId: "ship-1" }), "RAM_NOT_ALLOWED");
    const s = battle();
    s.meta.options.ramming = false;
    expectReject(s, order("all_ahead_full", { ramTargetId: "ship-1" }), "RAM_NOT_ALLOWED");
  });

  test("INVALID_RAM_TARGET: own ships, unknown ids and ships off the table", () => {
    const s = battle();
    const friend = addShip(s, unclean(s), { position: { x: 130, y: 105 } });
    expectReject(s, order("all_ahead_full", { ramTargetId: friend.id }), "INVALID_RAM_TARGET");
    expectReject(s, order("all_ahead_full", { ramTargetId: "ship-99" }), "INVALID_RAM_TARGET");
    Object.assign(agrippa(s), { status: "disengaged", position: null, heading: null });
    expectReject(s, order("all_ahead_full", { ramTargetId: "ship-1" }), "INVALID_RAM_TARGET");
  });

  test("enemy hulks can be rammed (transform D2)", () => {
    const s = battle();
    Object.assign(agrippa(s), { status: "blazing_hulk", damage: 8 });
    expectOk(s, order("all_ahead_full", { ramTargetId: "ship-1" }));
  });
});

describe("drift_hulk", () => {
  const hulkTurn = () => {
    const s = battle("movement", "hulks_drift");
    Object.assign(unclean(s), { status: "drifting_hulk", damage: 8 });
    return s;
  };
  const drift = (shipId = "ship-2") => ({ type: "drift_hulk", player: "p2", shipId });

  test("the owner drifts each hulk once", () => {
    expectOk(hulkTurn(), drift());
    const s = hulkTurn();
    s.turnState.ships["ship-2"]!.drifted = true;
    expectReject(s, drift(), "ALREADY_DRIFTED");
  });

  test("NOT_A_HULK, NOT_YOUR_SHIP", () => {
    const s = battle("movement", "hulks_drift");
    expectReject(s, drift(), "NOT_A_HULK");
    expectReject(s, drift("ship-1"), "NOT_YOUR_SHIP");
  });
});
