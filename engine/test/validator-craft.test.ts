/** Attack craft checks (validator spec §4.2 release_cap, §4.3 launch_attack_craft and fire, §4.4 move_ordnance). */
import { describe, expect, test } from "vitest";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import { addSalvo, addShip, agrippa, battle, expectOk, expectReject, ordered, unclean } from "./validator-fixtures";
import { addCap, addWave, carriers, FURY, STARHAWK, SWIFTDEATH } from "./craft-fixtures";

/** p1's launch step (player turn 2), Agrippa a Dictator. */
const launchStep = (): GameState => carriers(battle("shooting", "launch_ordnance", 2));
const launch = (patch: Record<string, unknown> = {}) => ({
  type: "launch_attack_craft", player: "p1", shipId: "ship-1", waves: [{ roles: ["fighter", "bomber"], cap: false }], recall: [], ...patch,
});

describe("launch_attack_craft", () => {
  test("up to the ship's capacity, any mix it carries, CAP fighters included", () => {
    expectOk(launchStep(), launch());
    expectOk(launchStep(), launch({ waves: [{ roles: ["bomber", "bomber"], cap: false }, { roles: ["fighter", "fighter"], cap: true }] }));
  });

  test("checks 7–12", () => {
    const lunar = battle("shooting", "launch_ordnance", 2);
    expectReject(lunar, launch(), "NO_LAUNCH_BAYS");

    const spent = launchStep();
    agrippa(spent).loaded.launchBays = false;
    expectReject(spent, launch(), "NOT_LOADED");

    expectReject(launchStep(), launch({ waves: [] }), "EMPTY_WAVE");
    expectReject(launchStep(), launch({ waves: [{ roles: [], cap: false }] }), "EMPTY_WAVE");
    expectReject(launchStep(), launch({ waves: [{ roles: ["assault_boat"], cap: false }] }), "CRAFT_NOT_CARRIED"); // no Sharks by default
    expectReject(launchStep(), launch({ waves: [{ roles: ["bomber"], cap: true }] }), "CAP_NOT_FIGHTERS");
    expectReject(launchStep(), launch({ waves: [{ roles: ["fighter", "fighter", "bomber", "bomber", "bomber"], cap: false }] }), "TOO_MANY_SQUADRONS", {
      launching: 5,
      capacity: 4,
    });
  });

  test("crippled halves the bays' total, rounding up (state N9); a side armament critical loses that side's bays", () => {
    const crippled = launchStep();
    agrippa(crippled).damage = 4;
    expectOk(crippled, launch());
    expectReject(crippled, launch({ waves: [{ roles: ["fighter", "fighter", "bomber"], cap: false }] }), "TOO_MANY_SQUADRONS", { capacity: 2 });

    const portHit = launchStep();
    agrippa(portHit).criticals.push({ id: "crit-1", kind: "port_armament", playerTurn: 1 });
    expectReject(portHit, launch({ waves: [{ roles: ["fighter", "fighter", "bomber"], cap: false }] }), "TOO_MANY_SQUADRONS", { capacity: 2 });
  });

  test("the fleet limit counts craft in play, CAP included; recalling makes room (p. 73)", () => {
    const s = launchStep();
    const out = addWave(s, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...STARHAWK }, { ...STARHAWK }] });
    addCap(s, "ship-1");
    expectReject(s, launch(), "FLEET_LIMIT", { inPlay: 4, recalled: 0, launching: 2, limit: 4 });
    expectOk(s, launch({ recall: [out.id] }));
  });

  test("recall names own free-flying waves, once each", () => {
    const s = launchStep();
    const cap = addCap(s, "ship-1");
    const enemy = addWave(s, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 50 }, squadrons: [{ ...SWIFTDEATH }] });
    const mine = addWave(s, { position: { x: 60, y: 50 } });
    expectReject(s, launch({ recall: [cap.id] }), "INVALID_RECALL");
    expectReject(s, launch({ recall: [enemy.id] }), "INVALID_RECALL");
    expectReject(s, launch({ recall: [mine.id, mine.id] }), "INVALID_RECALL");
    expectOk(s, launch({ recall: [mine.id] }));
  });

  test("a malformed wave is rejected at the gate", () => {
    const result = validate(launchStep(), launch({ waves: [{ roles: ["interceptor"], cap: false }] }));
    expect(result.ok ? "ok" : result.reason.code).toBe("MALFORMED");
  });
});

describe("release_cap", () => {
  const start = (): GameState => {
    const s = carriers(battle("movement", "move_ships", 2));
    addCap(s, "ship-1");
    return s;
  };
  const release = (s: GameState) => ({ type: "release_cap", player: "p1", ordnanceId: s.ordnance[0]!.id });

  test("at the start of the owner's Movement Phase", () => {
    const s = start();
    expectOk(s, release(s));
  });

  test("checks 1–4", () => {
    const s = start();
    expectReject(s, { ...release(s), ordnanceId: "ord-9" }, "UNKNOWN_ORDNANCE");
    const free = start();
    const fighter = free.ordnance[0]!;
    if (fighter.kind === "attack_craft") fighter.cap = null;
    expectReject(free, release(free), "NOT_ON_CAP");

    const late = start();
    addShip(late, agrippa(late), { id: "ship-3", position: { x: 20, y: 20 } });
    late.turnState.ships["ship-3"]!.moved = true;
    expectReject(late, release(late), "TOO_LATE_TO_RELEASE");

    const ordering = start();
    ordering.activation = ordered("ship-1");
    expectReject(ordering, release(ordering), "TOO_LATE_TO_RELEASE");

    const grappled = start();
    addShip(grappled, agrippa(grappled), { id: "ship-3", position: { x: 20, y: 20 }, grapple: { defenderId: "ship-2", attackerIds: ["ship-3"] } });
    grappled.turnState.ships["ship-3"]!.moved = true; // set on entering move_ships: doesn't count
    unclean(grappled).grapple = { defenderId: "ship-2", attackerIds: ["ship-3"] };
    expectOk(grappled, release(grappled));
  });
});

describe("move_ordnance for attack craft", () => {
  /** p1's active_ordnance step: a Fury + Starhawk wave at (50, 50). */
  const flying = (): GameState => {
    const s = carriers(battle("ordnance", "active_ordnance", 2));
    addWave(s, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...STARHAWK }] });
    return s;
  };
  const fly = (s: GameState, patch: Record<string, unknown> = {}) => ({
    type: "move_ordnance", player: "p1", ordnanceId: s.ordnance[0]!.id, path: [{ x: 50, y: 70 }], ...patch,
  });

  test("waypoints up to the slowest squadron's speed; an empty path stays put", () => {
    const s = flying();
    expectOk(s, fly(s));
    expectOk(s, fly(s, { path: [{ x: 60, y: 50 }, { x: 60, y: 60 }] }));
    expectOk(s, fly(s, { path: [] }));
  });

  test("checks 4–7", () => {
    const s = flying();
    expectReject(s, fly(s, { path: [{ x: 50, y: 71 }] }), "PATH_TOO_LONG", { limit: 20 });
    expectOk(s, fly(s, { path: [{ x: 45, y: 50 }, { x: 45, y: 65 }] })); // 5 + 15 = 20: the whole path counts
    expectReject(s, fly(s, { path: [{ x: 45, y: 50 }, { x: 45, y: 66 }] }), "PATH_TOO_LONG", { total: 21, limit: 20 });
    expectReject(s, { type: "move_ordnance", player: "p1", ordnanceId: s.ordnance[0]!.id }, "WRONG_ORDNANCE_MOVE");
    expectReject(s, fly(s, { path: [{ x: 50, y: 50 }, { x: 50, y: -1 }] }), "PATH_TOO_LONG");
    const edge = flying();
    edge.ordnance[0]!.position = { x: 5, y: 50 };
    expectReject(edge, fly(edge, { path: [{ x: -2, y: 50 }] }), "PATH_OFF_TABLE");

    const torps = flying();
    const salvo = addSalvo(torps, { position: { x: 20, y: 20 } });
    expectReject(torps, { type: "move_ordnance", player: "p1", ordnanceId: salvo.id, path: [] }, "WRONG_ORDNANCE_MOVE");
  });

  test("CAP fighters move only in the opponent's Ordnance Phase", () => {
    const s = carriers(battle("ordnance", "active_ordnance", 2));
    const cap = addCap(s, "ship-1");
    expectReject(s, { type: "move_ordnance", player: "p1", ordnanceId: cap.id, path: [] }, "ON_CAP");
    const theirs = carriers(battle("ordnance", "inactive_ordnance", 1)); // p2's turn: p1 moves second
    const mine = addCap(theirs, "ship-1");
    expectOk(theirs, { type: "move_ordnance", player: "p1", ordnanceId: mine.id, path: [{ x: 85, y: 30 }] });
  });

  test("going on CAP: fighters only, a friendly active ship, ending in contact (checks 8–10)", () => {
    const s = carriers(battle("ordnance", "active_ordnance", 2));
    const fighters = addWave(s, { position: { x: 85, y: 35 }, squadrons: [{ ...FURY }, { ...FURY }] });
    const toAgrippa = (patch: Record<string, unknown> = {}) => ({
      type: "move_ordnance", player: "p1", ordnanceId: fighters.id, path: [{ x: 85, y: 18 }], cap: "ship-1", ...patch,
    });
    expectOk(s, toAgrippa());
    expectReject(s, toAgrippa({ cap: "ship-2" }), "INVALID_CAP_SHIP");
    expectReject(s, toAgrippa({ path: [{ x: 85, y: 25 }] }), "NOT_IN_CONTACT");
    const mixed = carriers(battle("ordnance", "active_ordnance", 2));
    const wave = addWave(mixed, { position: { x: 85, y: 30 }, squadrons: [{ ...FURY }, { ...STARHAWK }] });
    expectReject(mixed, { type: "move_ordnance", player: "p1", ordnanceId: wave.id, path: [{ x: 85, y: 18 }], cap: "ship-1" }, "CAP_NOT_FIGHTERS");
  });
});

describe("shooting at attack craft", () => {
  test("a free-flying wave is a target; CAP isn't (T27)", () => {
    const s = carriers(battle("shooting", "direct_fire", 2));
    agrippa(s).position = { x: 100, y: 80 };
    agrippa(s).heading = 90;
    const wave = addWave(s, { owner: "p2", launchedBy: "ship-2", position: { x: 100, y: 95 }, squadrons: [{ ...SWIFTDEATH }] });
    expectOk(s, { type: "fire", player: "p1", shipId: "ship-1", weaponId: "port_battery", target: { kind: "ordnance", id: wave.id } });
    const cap = addCap(s, "ship-2", SWIFTDEATH);
    expectReject(s, { type: "fire", player: "p1", shipId: "ship-1", weaponId: "port_battery", target: { kind: "ordnance", id: cap.id } }, "INVALID_TARGET");
  });
});
