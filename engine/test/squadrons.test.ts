/**
 * Escorts and squadrons, step 2: composition, Leadership, deployment, orders,
 * moves, brace, disengaging, escort losses and victory points (state v0.16
 * §7.5, N34–N45; transforms v0.14 T75–T82, T90; validator v0.11; reducer v0.11
 * §3, §8, R33, R39–R41).
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { emptyTurnState, newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { formation, inFormation, nextDeployer, squadronLd, squadronOf, victoryPoints } from "../src/state/derived";
import { columnShift } from "../src/reducer/gunnery";
import type { GameState, Ship } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";
import { expectOk, expectReject } from "./validator-fixtures";

type Entry = { classId: string; squadron?: string };
const config = (p1: Entry[], p2: Entry[], extra: Partial<GameConfig> = {}): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  forces: { kind: "points", limit: 1000 },
  scoring: "victory_points",
  ...extra,
  ships: [...p1.map((s, i) => ({ owner: "p1" as const, name: `I${i}`, ...s })), ...p2.map((s, i) => ({ owner: "p2" as const, name: `C${i}`, ...s }))],
});

// ship-1..3 Blue (Swords), ship-4..5 Line (Lunars), ship-6..7 Lost (Iconoclasts), ship-8 a Murder; sq-9 Blue, sq-10 Line, sq-11 Lost.
const FLEETS = config(
  [{ classId: "sword", squadron: "Blue" }, { classId: "sword", squadron: "Blue" }, { classId: "sword", squadron: "Blue" }, { classId: "lunar", squadron: "Line" }, { classId: "lunar", squadron: "Line" }],
  [{ classId: "iconoclast", squadron: "Lost" }, { classId: "iconoclast", squadron: "Lost" }, { classId: "murder" }],
);
const AT: Record<string, [number, number, number]> = {
  "ship-1": [50, 30, 0], "ship-2": [60, 30, 0], "ship-3": [70, 30, 0], "ship-4": [100, 30, 0], "ship-5": [112, 30, 0],
  "ship-6": [50, 90, 180], "ship-7": [60, 90, 180], "ship-8": [100, 90, 180],
};

/** The fleets on the table at p1's first Movement Phase, every Leadership 8. */
function inBattle(at = AT): GameState {
  const s = newGame(cloneJson(FLEETS));
  for (const ship of s.ships) {
    const [x, y, h] = at[ship.id]!;
    Object.assign(ship, { leadership: 8, status: "active", position: { x, y }, heading: h });
  }
  s.setup.leadershipRolled = true;
  s.setup.firstPlayer = "p1";
  s.clock = { stage: "battle", setupStep: null, playerTurn: 1, phase: "movement", step: "move_ships" };
  s.turnState = emptyTurnState(1, s.ships);
  expect(checkInvariants(s)).toEqual([]);
  return s;
}
const ship = (s: GameState, id: string): Ship => s.ships.find((x) => x.id === id)!;
const order = (shipId: string, o: string, player = "p1") => ({ type: "declare_order", player, shipId, order: o }) as Transform;
const ahead = (shipId: string, d: number, extra: Record<string, unknown> = {}) =>
  ({ type: "move", player: "p1", shipId, path: [{ kind: "advance", distance: d }], disengage: false, ...extra }) as Transform;

describe("escorts (T75, N34)", () => {
  test("the six Gothic War escorts: Escort/1, 90°, shields 1", () => {
    const rows = ["firestorm", "sword", "cobra", "idolator", "infidel", "iconoclast"].map((id) => {
      const p = CATALOGUE[id]!.profile;
      return [id, p.type, p.category, p.points, p.hits, p.speed, p.turns, p.shields, p.armour.front, p.turrets];
    });
    expect(rows).toEqual([
      ["firestorm", "escort", "escort", 40, 1, 25, 90, 1, 5, 2],
      ["sword", "escort", "escort", 35, 1, 25, 90, 1, 5, 2],
      ["cobra", "escort", "escort", 30, 1, 30, 90, 1, 4, 1],
      ["idolator", "escort", "escort", 45, 1, 30, 90, 1, 5, 2],
      ["infidel", "escort", "escort", 40, 1, 30, 90, 1, 5, 1],
      ["iconoclast", "escort", "escort", 30, 1, 30, 90, 1, 4, 1],
    ]);
  });

  test("the Idolator takes no column shift for range over 30 cm", () => {
    const s = inBattle();
    const far = { x: 50, y: 90 - 40 }; // 40 cm from the Iconoclast at (50, 90)
    const plain = columnShift(s, ship(s, "ship-6"), far, null);
    ship(s, "ship-6").profile = cloneJson(CATALOGUE["idolator"]!.profile);
    expect(columnShift(s, ship(s, "ship-6"), far, null)).toBe(plain - 1);
  });
});

describe("squadrons in the config (T76, N45)", () => {
  test("named squadrons become ids after the ships'", () => {
    const s = newGame(cloneJson(FLEETS));
    expect(s.squadrons!.map((sq) => [sq.id, sq.owner, sq.name, sq.type, sq.shipIds.join(",")])).toEqual([
      ["sq-9", "p1", "Blue", "escort", "ship-1,ship-2,ship-3"],
      ["sq-10", "p1", "Line", "capital", "ship-4,ship-5"],
      ["sq-11", "p2", "Lost", "escort", "ship-6,ship-7"],
    ]);
    expect(s.nextId).toBe(12);
    expect(newGame(cloneJson(LUNAR_VS_MURDER)).squadrons).toBeUndefined(); // older games don't change
  });

  test("bad squadrons are refused", () => {
    const bad = (p1: Entry[], extra: Partial<GameConfig> = {}) => () => newGame(config(p1, [{ classId: "murder" }], extra));
    expect(bad([{ classId: "sword" }])).toThrow(/an escort must be in a squadron/);
    expect(bad([{ classId: "sword", squadron: "A" }, { classId: "lunar", squadron: "A" }])).toThrow(/can't share a squadron/);
    expect(bad([{ classId: "lunar", squadron: "A" }])).toThrow(/at least two ships/);
    expect(bad([{ classId: "lunar", squadron: "A" }, { classId: "emperor", squadron: "A" }], { forces: { kind: "points", limit: 2000 } })).toThrow(/all one type/);
    expect(bad(Array.from({ length: 7 }, () => ({ classId: "sword", squadron: "A" })))).toThrow(/1–6 ships, not 7/);
    expect(bad([{ classId: "lunar", squadron: "A" }, { classId: "lunar", squadron: "A" }], { forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" })).toThrow(/points battles/);
    expect(() => newGame(config([{ classId: "lunar" }], [{ classId: "iconoclast", squadron: "B" }], { forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" }))).toThrow(/cruisers only/);
    expect(bad([{ classId: "sword", squadron: "A" }])).not.toThrow();
  });
});

describe("Leadership (T78)", () => {
  test("an escort squadron rolls once; capital ships each roll", () => {
    const s = playDice(newGame(cloneJson(FLEETS)), { type: "roll_leadership", player: "p1" }, [6, 1, 2, 4, 5]);
    expect(s.ships.map((x) => x.leadership)).toEqual([9, 9, 9, 6, 7, 8, 8, 8]);
    expect(logOf(s, "leadership_roll").map((e) => e.data["shipId"])).toEqual(["ship-1", "ship-4", "ship-5", "ship-6", "ship-8"]);
  });

  test("a capital squadron uses its best Leadership in formation", () => {
    const s = inBattle();
    ship(s, "ship-5").leadership = 9;
    expect(squadronLd(s, squadronOf(s, ship(s, "ship-4"))!)).toBe(9);
    ship(s, "ship-5").position = { x: 160, y: 30 }; // a stray doesn't lend its Leadership
    expect(squadronLd(s, squadronOf(s, ship(s, "ship-4"))!)).toBe(8);
  });
});

describe("formation (N35–N36)", () => {
  test("the largest 15 cm chain; strays outside it", () => {
    const s = inBattle();
    const blue = squadronOf(s, ship(s, "ship-1"))!;
    expect(formation(s, blue).map((x) => x.id)).toEqual(["ship-1", "ship-2", "ship-3"]);
    ship(s, "ship-3").position = { x: 90, y: 60 };
    expect(formation(s, blue).map((x) => x.id)).toEqual(["ship-1", "ship-2"]);
    expect(inFormation(s, ship(s, "ship-3"))).toBe(false);
    ship(s, "ship-2").position = { x: 140, y: 60 }; // three chains of one: the first wins
    expect(formation(s, blue).map((x) => x.id)).toEqual(["ship-1"]);
    expect(inFormation(s, ship(s, "ship-8"))).toBe(false); // a ship in no squadron
  });
});

describe("deployment (T80)", () => {
  test("a squadron is one placement, in one division, within 15 cm", () => {
    let s = newGame(cloneJson(FLEETS));
    s = playDice(s, { type: "roll_leadership", player: "p1" }, [3, 3, 3, 3, 3]);
    s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
    s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
    expect(nextDeployer(s)).toBe("p1");
    const deploy = (shipId: string, x: number, y: number, player = "p1") => ({ type: "deploy_ship", player, shipId, position: { x, y } }) as Transform;
    const zone = s.scenario.deploymentZones![s.setup.zones!.p1];
    const y = zone.y + 15;
    s = play(s, deploy("ship-1", 60, y));
    expect(nextDeployer(s)).toBe("p1"); // the squadron isn't down yet
    expectReject(s, deploy("ship-4", 100, y), "SQUADRON_DEPLOYING");
    expectReject(s, deploy("ship-2", 90, y), "NOT_IN_FORMATION");
    s = play(s, deploy("ship-2", 70, y));
    s = play(s, deploy("ship-3", 80, y));
    expect(nextDeployer(s)).toBe("p2");
  });
});

describe("squadron orders and moves (N37–N39, T81–T82)", () => {
  test("one Command check for the squadron; its members move next, on its order", () => {
    let s = playDice(inBattle(), order("ship-1", "lock_on"), [2, 3]);
    expect(["ship-1", "ship-2", "ship-3"].map((id) => ship(s, id).specialOrder?.kind)).toEqual(["lock_on", "lock_on", "lock_on"]);
    expect(logOf(s, "command_check")[0]!.data["squadronId"]).toBe("sq-9");
    expect(logOf(s, "order_set").map((e) => e.data["shipId"])).toEqual(["ship-2", "ship-3"]);
    expect(s.turnState.squadronMove).toMatchObject({ squadronId: "sq-9", order: "lock_on", members: ["ship-1", "ship-2", "ship-3"] });
    expectReject(s, order("ship-2", "burn_retros"), "ACTIVATION_OPEN");
    s = play(s, ahead("ship-1", 13));
    expectReject(s, order("ship-2", "burn_retros"), "ALREADY_ON_ORDERS"); // it has the squadron's
    expectReject(s, order("ship-4", "burn_retros"), "SQUADRON_MOVING");
    expectReject(s, ahead("ship-4", 10), "SQUADRON_MOVING");
    expectReject(s, { type: "move", player: "p1", shipId: "ship-2", path: [{ kind: "advance", distance: 5 }, { kind: "turn", degrees: 45 }, { kind: "advance", distance: 8 }], disengage: false } as Transform, "TOO_MANY_TURNS"); // Lock On
    s = play(s, ahead("ship-2", 13));
    s = play(s, ahead("ship-3", 13));
    expect(s.turnState.squadronMove).toBeNull();
    expectOk(s, order("ship-4", "burn_retros"));
  });

  test("All Ahead Full rolls once; each member uses the whole distance", () => {
    let s = playDice(inBattle(), order("ship-1", "all_ahead_full"), [2, 3, 1, 1, 1, 1]);
    expect(s.turnState.squadronMove?.aafExtra).toBe(4);
    s = play(s, ahead("ship-1", 29));
    expectReject(s, ahead("ship-2", 20), "MUST_MOVE_FULL_DISTANCE");
    expectOk(s, ahead("ship-2", 29));
  });

  test("a move with no order starts the squadron's move; a stray moves alone", () => {
    const start = inBattle();
    ship(start, "ship-3").position = { x: 90, y: 50 };
    let s = play(start, ahead("ship-1", 13));
    expect(s.turnState.squadronMove).toMatchObject({ order: null, members: ["ship-1", "ship-2"] });
    expectReject(s, order("ship-2", "burn_retros"), "SQUADRON_ORDERED");
    expectReject(s, ahead("ship-3", 13), "SQUADRON_MOVING");
    s = play(s, ahead("ship-2", 13));
    expect(s.turnState.squadronMove).toBeNull();
    expectOk(s, order("ship-3", "burn_retros")); // the stray's own order
  });

  test("a failed check moves the squadron with no order", () => {
    const s = playDice(inBattle(), order("ship-4", "lock_on"), [6, 6]);
    expect(s.turnState.commandCheckFailed).toBe(true);
    expect(s.turnState.squadronMove).toMatchObject({ squadronId: "sq-10", order: null, members: ["ship-4", "ship-5"] });
    expect(ship(s, "ship-5").specialOrder).toBeNull();
  });
});

describe("brace (N38)", () => {
  test("one member's brace braces the squadron; a failure counts for all", () => {
    const pending = (s: GameState) => {
      s.clock = { ...s.clock, playerTurn: 2, phase: "shooting", step: "direct_fire" };
      s.turnState = emptyTurnState(2, s.ships);
      s.pending.push({ id: "pend-50", kind: "brace", player: "p1", shipId: "ship-2", source: { kind: "ship", id: "ship-8" } });
      s.nextId = 60;
      return s;
    };
    const braced = playDice(pending(inBattle()), { type: "answer_brace", player: "p1", pendingId: "pend-50", attempt: true }, [2, 2]);
    expect(["ship-1", "ship-2", "ship-3"].map((id) => ship(braced, id).specialOrder?.kind)).toEqual(Array(3).fill("brace_for_impact"));
    const failed = playDice(pending(inBattle()), { type: "answer_brace", player: "p1", pendingId: "pend-50", attempt: true }, [6, 6]);
    expect(failed.turnState.braceFailures.map((f) => f.shipId)).toEqual(["ship-1", "ship-2", "ship-3"]);
  });
});

describe("disengaging (N41, N44, R39)", () => {
  test("an escort squadron tests once, after its last member, and goes together", () => {
    let s = play(inBattle(), ahead("ship-1", 13, { disengage: true }));
    expectReject(s, ahead("ship-2", 13), "SQUADRON_DISENGAGE");
    s = play(s, ahead("ship-2", 13, { disengage: true }));
    expect(logOf(s, "disengage_test")).toHaveLength(0);
    s = playDice(s, ahead("ship-3", 13, { disengage: true }), [1, 1]);
    expect(logOf(s, "disengage_test")[0]!.data).toMatchObject({ squadronId: "sq-9", passed: true });
    expect(["ship-1", "ship-2", "ship-3"].map((id) => ship(s, id).status)).toEqual(Array(3).fill("disengaged"));
    expect(s.squadrons![0]!.disengaging).toBe(true);
    // Disengaged with nothing lost: 10% of 105, rounded up.
    expect(victoryPoints(s, "p2").squadrons).toEqual([{ squadronId: "sq-9", vp: 11, why: "disengaged" }]);
  });

  test("a capital ship that fails its test leaves the squadron for good", () => {
    let s = inBattle();
    s = play(s, ahead("ship-1", 13));
    s = play(s, ahead("ship-2", 13));
    s = play(s, ahead("ship-3", 13));
    s = playDice(s, ahead("ship-4", 10, { disengage: true }), [6, 6]);
    expect(logOf(s, "left_squadron")[0]!.data).toEqual({ shipId: "ship-4", squadronId: "sq-10" });
    expect(s.squadrons![1]!.shipIds).toEqual(["ship-5"]);
  });
});

describe("escort losses (N34, R33, R41)", () => {
  /** The Murder's turn to fire, a Sword 20 cm off its prow. */
  function murderToFire(): GameState {
    const s = inBattle({ ...AT, "ship-3": [100, 70, 0] });
    s.clock = { ...s.clock, playerTurn: 2, phase: "shooting", step: "direct_fire" };
    s.turnState = emptyTurnState(2, s.ships);
    return s;
  }

  test("a hit through its shield destroys it, leaving a Blast Marker", () => {
    let s = play(murderToFire(), { type: "fire", player: "p2", shipId: "ship-8", weaponId: "prow_lances", target: { kind: "ship", id: "ship-3" } } as Transform);
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [6, 6]);
    expect(ship(s, "ship-3")).toMatchObject({ status: "destroyed", damage: 1, position: null });
    expect(logOf(s, "escort_lost")[0]!.data).toMatchObject({ shipId: "ship-3", cause: "damage" });
    expect(s.blastMarkers.filter((b) => b.cause === "escort_lost")).toHaveLength(1);
    expect(logOf(s, "catastrophic")).toHaveLength(0);
  });

  test("escorts score by squadron: nothing until the last is gone, then the lot", () => {
    const s = inBattle();
    for (const id of ["ship-6", "ship-7"]) Object.assign(ship(s, id), { status: "destroyed", damage: 1, position: null, heading: null });
    expect(victoryPoints(s, "p1").squadrons).toEqual([{ squadronId: "sq-11", vp: 60, why: "destroyed" }]);
    expect(victoryPoints(s, "p1").ships).toEqual([]);
    ship(s, "ship-7").status = "active";
    ship(s, "ship-7").damage = 0;
    ship(s, "ship-7").position = { x: 60, y: 90 };
    ship(s, "ship-7").heading = 180;
    expect(victoryPoints(s, "p1").squadrons).toEqual([]); // still fighting
  });

  test("crippled is half lost, rounding up (N43)", () => {
    const s = inBattle();
    // Blue: 3 Swords. One lost, two disengaged: 1 < ⌈3/2⌉, so not crippled: 10%.
    Object.assign(ship(s, "ship-1"), { status: "destroyed", damage: 1, position: null });
    for (const id of ["ship-2", "ship-3"]) Object.assign(ship(s, id), { status: "disengaged", position: null });
    expect(victoryPoints(s, "p2").squadrons).toEqual([{ squadronId: "sq-9", vp: 11, why: "disengaged" }]);
    Object.assign(ship(s, "ship-2"), { status: "destroyed", damage: 1 }); // 2 of 3 lost: crippled, 25%
    expect(victoryPoints(s, "p2").squadrons).toEqual([{ squadronId: "sq-9", vp: 27, why: "disengaged" }]);
  });
});

describe("shooting at a squadron (T83–T87, R35–R38)", () => {
  // ship-1 Sword and ship-2 Cobra in "Mixed", fleeing west; ship-3 a Murder heading north, the escorts off its port side.
  const mixed = config([{ classId: "sword", squadron: "Mixed" }, { classId: "cobra", squadron: "Mixed" }], [{ classId: "murder" }]);
  function murderToFire(at: Record<string, [number, number, number]>): GameState {
    const s = newGame(cloneJson(mixed));
    for (const x of s.ships) {
      const [px, py, h] = at[x.id]!;
      Object.assign(x, { leadership: 8, status: "active", position: { x: px, y: py }, heading: h });
    }
    s.setup.leadershipRolled = true;
    s.setup.firstPlayer = "p1";
    s.clock = { stage: "battle", setupStep: null, playerTurn: 2, phase: "shooting", step: "direct_fire" };
    s.turnState = emptyTurnState(2, s.ships);
    return s;
  }
  const portBattery = (extra: Record<string, unknown> = {}) =>
    ({ type: "fire", player: "p2", shipId: "ship-3", weaponId: "port_battery", target: { kind: "ship", id: "ship-2" }, ...extra }) as Transform;

  test("p. 98's example: rolls 4, 5, 6 at a closer Sword (5+) and a Cobra (4+): the 4 to the Cobra, the 5 and 6 to the Sword", () => {
    // Sword 17 cm, Cobra 24 cm, both showing their rear: escorts moving away, column D, FP 10 → 4 dice.
    const start = murderToFire({ "ship-1": [83, 50, 270], "ship-2": [76, 50, 270], "ship-3": [100, 50, 0] });
    let s = play(start, portBattery()); // naming the Cobra targets the squadron (V15)
    expect(s.pending[0]).toMatchObject({ shipId: "ship-1" }); // one offer, to the nearest eligible member (T86)
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [4, 5, 6, 1]);
    const attack = logOf(s, "attack").at(-1)!.data;
    expect(attack).toMatchObject({ columns: [{ column: "D", firepower: 10, dice: 4 }], need: 4, hits: 3, targetIds: ["ship-1", "ship-2"], targetAspect: "moving_away" });
    expect(logOf(s, "allocation").at(-1)!.data["allocation"]).toEqual([
      { roll: 4, shipId: "ship-2" },
      { roll: 5, shipId: "ship-1" },
      { roll: 6, shipId: "ship-1" },
    ]);
    expect(ship(s, "ship-1").status).toBe("destroyed"); // shield, then its one hit
    expect(ship(s, "ship-2")).toMatchObject({ status: "active", damage: 0 }); // only its shield went
  });

  test("hits only go to members that took fire; the rest are lost", () => {
    // The Cobra, 15 cm from the Sword, is behind the Murder's port arc: only the Sword can be hit.
    const start = murderToFire({ "ship-1": [83, 50, 270], "ship-2": [92, 38, 270], "ship-3": [100, 50, 0] });
    expect(squadronOf(start, ship(start, "ship-2"))!.shipIds).toHaveLength(2);
    let s = play(start, portBattery());
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [6, 6, 6, 6]);
    expect(logOf(s, "allocation").at(-1)!.data["allocation"]).toEqual([
      { roll: 6, shipId: "ship-1" },
      { roll: 6, shipId: "ship-1" },
      { roll: 6, shipId: null },
      { roll: 6, shipId: null },
    ]);
    expect(ship(s, "ship-2").status).toBe("active");
  });

  test("the aspect fired at: one a member shows; harder members can't be hit", () => {
    // The Sword shows its rear (moving away, D), the Cobra its side (abeam, E).
    const start = murderToFire({ "ship-1": [83, 50, 270], "ship-2": [83, 40, 0], "ship-3": [100, 50, 0] });
    expectReject(start, portBattery({ targetAspect: "closing" }), "INVALID_TARGET_ASPECT");
    expectOk(start, portBattery({ targetAspect: "abeam" }));
    let s = play(start, portBattery({ targetAspect: "moving_away" }));
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [6, 6, 6, 6]);
    expect(logOf(s, "attack").at(-1)!.data["targetIds"]).toEqual(["ship-1"]); // the abeam Cobra is harder than moving away
  });
});

describe("shooting by a squadron (T84, T88, N40)", () => {
  /** p2's Iconoclasts (ship-6, ship-7) fire at the Lunar ship-4, which sits off their prows. */
  function lostToFire(): GameState {
    const s = inBattle({ ...AT, "ship-6": [100, 55, 180], "ship-7": [106, 55, 180] });
    s.clock = { ...s.clock, playerTurn: 2, phase: "shooting", step: "direct_fire" };
    s.turnState = emptyTurnState(2, s.ships);
    return s;
  }
  const volley = (extra: Record<string, unknown> = {}) =>
    ({ type: "fire", player: "p2", shipId: "ship-6", weaponId: "battery", target: { kind: "ship", id: "ship-4" }, withShips: [{ shipId: "ship-7", weaponIds: ["battery"] }], ...extra }) as Transform;

  test("firepower adds up, and each ship's weapon is spent", () => {
    let s = play(lostToFire(), volley());
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [1, 1, 1, 1]);
    expect(logOf(s, "attack").at(-1)!.data).toMatchObject({ shooterIds: ["ship-6", "ship-7"], columns: [{ column: "B", firepower: 6, dice: 4 }] });
    expect(s.turnState.ships["ship-7"]!.weaponsFired).toEqual(["battery"]);
  });

  test("an escort squadron on a halving order halves its total, rounding up", () => {
    const start = lostToFire();
    for (const id of ["ship-6", "ship-7"]) ship(start, id).specialOrder = { kind: "burn_retros", issued: 2, expires: { playerTurn: 4, at: "movement_start" }, replaced: null };
    let s = play(start, volley());
    s = playDice(s, { type: "answer_brace", player: "p1", pendingId: s.pending[0]!.id, attempt: false }, [1, 1]);
    expect(logOf(s, "attack").at(-1)!.data["columns"]).toEqual([expect.objectContaining({ firepower: 6 })]); // 3 + 3, halved to 3 at lookup
    expect((logOf(s, "attack").at(-1)!.data["rolls"] as number[]).length).toBe(2); // FP 3 on column B: 2 dice
  });

  test("only squadron-mates in formation join; ordnance isn't a squadron's target", () => {
    const start = lostToFire();
    expectReject(start, volley({ withShips: [{ shipId: "ship-8", weaponIds: ["prow_lances"] }] }), "INVALID_SQUADRON_FIRE");
    expectReject(start, volley({ withShips: [{ shipId: "ship-7", weaponIds: ["prow_lance"] }] }), "UNKNOWN_WEAPON");
    ship(start, "ship-7").position = { x: 160, y: 55 }; // a stray
    expectReject(start, volley(), "INVALID_SQUADRON_FIRE");
  });
});
