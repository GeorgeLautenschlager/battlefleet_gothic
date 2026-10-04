/**
 * Shooting checks, on the reducer spec §13 broadside: Unclean (ship-2, p2) at
 * (100, 50) heading 180; Agrippa (ship-1) at (76, 46) heading 0, ≈ 24.3 cm off
 * Unclean's starboard side.
 */
import { describe, test } from "vitest";
import type { Weapon } from "../src/state/types";
import { addSalvo, addShip, agrippa, battle, broadside, expectOk, expectReject, unclean } from "./validator-fixtures";

const fire = (weaponId: string, target: { kind: string; id: string } = { kind: "ship", id: "ship-1" }, extra: Record<string, unknown> = {}) => ({
  type: "fire", player: "p2", shipId: "ship-2", weaponId, target, ...extra,
});

describe("fire: shooter and weapon", () => {
  test("the broadside is legal", () => {
    expectOk(broadside(), fire("starboard_battery"));
  });

  test("DISENGAGE_FAILED", () => {
    const s = broadside();
    s.turnState.ships["ship-2"]!.disengage = "failed";
    expectReject(s, fire("starboard_battery"), "DISENGAGE_FAILED");
  });

  test("UNKNOWN_WEAPON, WEAPON_ALREADY_FIRED, WEAPON_DISABLED", () => {
    expectReject(broadside(), fire("nova_cannon"), "UNKNOWN_WEAPON");
    const fired = broadside();
    fired.turnState.ships["ship-2"]!.weaponsFired.push("starboard_battery");
    expectReject(fired, fire("starboard_battery"), "WEAPON_ALREADY_FIRED");
    const crit = broadside();
    unclean(crit).criticals.push({ id: "crit-900", kind: "starboard_armament", playerTurn: 1 });
    expectReject(crit, fire("starboard_battery"), "WEAPON_DISABLED");
  });

  test("WRONG_WEAPON_KIND: torpedoes aren't fired, they're launched", () => {
    const s = broadside();
    s.clock.playerTurn = 2;
    s.turnState.playerTurn = 2; // p1's turn
    expectReject(s, { ...fire("prow_torpedoes", { kind: "ship", id: "ship-2" }), player: "p1", shipId: "ship-1" }, "WRONG_WEAPON_KIND");
  });
});

describe("fire: targets", () => {
  test("UNKNOWN_TARGET", () => {
    expectReject(broadside(), fire("starboard_battery", { kind: "ship", id: "ship-99" }), "UNKNOWN_TARGET");
    expectReject(broadside(), fire("starboard_battery", { kind: "ordnance", id: "ord-99" }), "UNKNOWN_TARGET");
  });

  test("INVALID_TARGET: friends, friendly hulks, ships off the table, own salvoes", () => {
    const s = broadside();
    const friend = addShip(s, unclean(s), { position: { x: 80, y: 52 } });
    expectReject(s, fire("starboard_battery", { kind: "ship", id: friend.id }), "INVALID_TARGET");
    Object.assign(friend, { status: "drifting_hulk", damage: 8 });
    expectReject(s, fire("starboard_battery", { kind: "ship", id: friend.id }), "INVALID_TARGET");
    const own = addSalvo(s, { owner: "p2", position: { x: 85, y: 50 } });
    expectReject(s, fire("starboard_battery", { kind: "ordnance", id: own.id }), "INVALID_TARGET");
    const gone = broadside();
    Object.assign(agrippa(gone), { status: "disengaged", position: null, heading: null });
    expectReject(gone, fire("starboard_battery"), "INVALID_TARGET");
  });

  test("enemy hulks and enemy salvoes are fair game", () => {
    const s = broadside();
    Object.assign(agrippa(s), { status: "blazing_hulk", damage: 8 });
    expectOk(s, fire("starboard_battery"));
    const salvo = addSalvo(s, { owner: "p1", position: { x: 85, y: 50 } });
    expectOk(s, fire("starboard_battery", { kind: "ordnance", id: salvo.id }));
  });
});

describe("fire: range, arc and aspect", () => {
  test("OUT_OF_RANGE, stem to stem", () => {
    const s = broadside();
    agrippa(s).position = { x: 54, y: 50 }; // 46 cm: the Murder's batteries reach 45
    expectReject(s, fire("starboard_battery"), "OUT_OF_RANGE", { distance: 46, range: 45 });
    agrippa(s).position = { x: 55, y: 50 };
    expectOk(s, fire("starboard_battery"));
  });

  test("OUT_OF_ARC", () => {
    expectReject(broadside(), fire("port_battery"), "OUT_OF_ARC", { quadrants: ["right"], arcs: ["left"] });
    expectReject(broadside(), fire("prow_lances"), "OUT_OF_ARC");
  });

  /** A target exactly 45° off Unclean's bow, to starboard: on the front/right line. */
  const onTheLine = () => {
    const s = broadside();
    agrippa(s).position = { x: 90, y: 40 };
    agrippa(s).heading = 135; // Unclean (table bearing 45°) is then dead off Agrippa's port side: no aspect choice
    return s;
  };

  test("on an arc boundary, a single-arc weapon needs no choice", () => {
    expectOk(onTheLine(), fire("starboard_battery"));
    expectOk(onTheLine(), fire("prow_lances"));
  });

  test("ARC_CHOICE_REQUIRED only when the weapon covers both arcs", () => {
    const s = onTheLine();
    const dorsal: Weapon = { id: "dorsal_lances", name: "Dorsal lances", kind: "lance", location: "dorsal", arcs: ["left", "front", "right"], range: 45, speed: null, strength: 2 };
    unclean(s).profile.weapons.push(dorsal);
    expectReject(s, fire("dorsal_lances"), "ARC_CHOICE_REQUIRED", { options: ["front", "right"] });
    expectOk(s, fire("dorsal_lances", undefined, { arc: "right" }));
    expectReject(s, fire("dorsal_lances", undefined, { arc: "left" }), "INVALID_ARC_CHOICE");
    expectReject(s, fire("starboard_battery", undefined, { arc: "front" }), "INVALID_ARC_CHOICE");
  });

  test("ASPECT_CHOICE_REQUIRED when the shooter sits on the target's quadrant line", () => {
    const s = broadside();
    agrippa(s).position = { x: 90, y: 40 }; // heading 0: Unclean is 45° off Agrippa's bow
    expectReject(s, fire("starboard_battery"), "ASPECT_CHOICE_REQUIRED", { options: ["front", "right"] });
    expectOk(s, fire("starboard_battery", undefined, { aspect: "front" }));
    expectReject(s, fire("starboard_battery", undefined, { aspect: "rear" }), "INVALID_ASPECT_CHOICE");
  });

  test("ordnance has no aspect", () => {
    const s = broadside();
    const salvo = addSalvo(s, { owner: "p1", position: { x: 85, y: 50 } });
    expectReject(s, fire("starboard_battery", { kind: "ordnance", id: salvo.id }, { aspect: "front" }), "INVALID_ASPECT_CHOICE");
  });
});

describe("fire: line of fire and priority", () => {
  test("LINE_OF_FIRE_BLOCKED by a hulk in between", () => {
    const s = broadside();
    addShip(s, unclean(s), { status: "drifting_hulk", damage: 8, position: { x: 88, y: 48 } });
    expectReject(s, fire("starboard_battery"), "LINE_OF_FIRE_BLOCKED");
  });

  test("after a failed priority test, only the nearest target (per weapon)", () => {
    const s = broadside();
    const nearer = addShip(s, agrippa(s), { position: { x: 85, y: 50 } });
    expectOk(s, fire("starboard_battery")); // test not taken yet: the reducer will roll it
    s.turnState.ships["ship-2"]!.priorityTest = "failed";
    expectReject(s, fire("starboard_battery"), "MUST_TARGET_NEAREST");
    expectOk(s, fire("starboard_battery", { kind: "ship", id: nearer.id }));
    s.turnState.ships["ship-2"]!.priorityTest = "passed";
    expectOk(s, fire("starboard_battery"));
  });
});

describe("launch_torpedoes", () => {
  // p1's turn: Agrippa (ship-1) has prow torpedoes, arc front (315°–45°).
  const launchTurn = () => battle("shooting", "launch_ordnance", 2);
  const launch = (bearing: number, weaponId = "prow_torpedoes") => ({
    type: "launch_torpedoes", player: "p1", shipId: "ship-1", weaponId, bearing,
  });

  test("any bearing in the front arc, boundaries included", () => {
    for (const bearing of [0, 30, 45, 315, 359.5]) expectOk(launchTurn(), launch(bearing));
  });

  test("BEARING_OUT_OF_ARC", () => {
    for (const bearing of [46, 90, 314, 360, -1]) expectReject(launchTurn(), launch(bearing), "BEARING_OUT_OF_ARC");
  });

  test("NOT_LOADED, WEAPON_ALREADY_FIRED, WRONG_WEAPON_KIND", () => {
    const empty = launchTurn();
    agrippa(empty).loaded.torpedoes = false;
    expectReject(empty, launch(0), "NOT_LOADED");
    const fired = launchTurn();
    fired.turnState.ships["ship-1"]!.weaponsFired.push("prow_torpedoes");
    expectReject(fired, launch(0), "WEAPON_ALREADY_FIRED");
    expectReject(launchTurn(), launch(0, "port_battery"), "WRONG_WEAPON_KIND");
  });

  test("Prow Armament damage disables the tubes", () => {
    const s = launchTurn();
    agrippa(s).criticals.push({ id: "crit-901", kind: "prow_armament", playerTurn: 1 });
    expectReject(s, launch(0), "WEAPON_DISABLED");
  });
});
