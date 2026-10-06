import { describe, expect, test } from "vitest";
import * as d from "../src/state/derived";
import type { BlastMarker, CriticalKind, GameState, OrderKind, Ship } from "../src/state/types";
import { specExampleState } from "./helpers";

// The §14 example: Agrippa (ship-1, p1) at (85, 15) heading 0; Unclean (ship-2, p2)
// at (100, 105) heading 180; p2 goes first, so it's p2's player turn 1, Movement.
const fresh = (): { s: GameState; agrippa: Ship; unclean: Ship } => {
  const s = specExampleState();
  return { s, agrippa: d.getShip(s, "ship-1"), unclean: d.getShip(s, "ship-2") };
};

let critId = 100;
const crit = (ship: Ship, kind: CriticalKind) => ship.criticals.push({ id: `crit-${critId++}`, kind, playerTurn: 1 });
const order = (ship: Ship, kind: OrderKind) => {
  ship.specialOrder = { kind, issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
};
const bm = (s: GameState, x: number, y: number): BlastMarker => {
  const marker: BlastMarker = { id: `bm-${critId++}`, position: { x, y }, placed: 1, cause: "shield_hit" };
  s.blastMarkers.push(marker);
  return marker;
};
const weapon = (ship: Ship, id: string) => {
  const w = ship.profile.weapons.find((x) => x.id === id);
  if (!w) throw new Error(id);
  return w;
};

describe("hits and crippling", () => {
  test("crippled at half damage (p. 65)", () => {
    const { unclean } = fresh();
    unclean.damage = 3;
    expect(d.isCrippled(unclean)).toBe(false);
    expect(d.remainingHits(unclean)).toBe(5);
    unclean.damage = 4;
    expect(d.isCrippled(unclean)).toBe(true);
  });

  test("odd hits round the threshold up", () => {
    const { unclean } = fresh();
    unclean.profile.hits = 5;
    unclean.damage = 2;
    expect(d.isCrippled(unclean)).toBe(false);
    unclean.damage = 3;
    expect(d.isCrippled(unclean)).toBe(true);
  });

  test("status helpers", () => {
    const { unclean } = fresh();
    expect([d.isHulk(unclean), d.onTable(unclean)]).toEqual([false, true]);
    unclean.status = "blazing_hulk";
    expect([d.isHulk(unclean), d.onTable(unclean)]).toEqual([true, true]);
    unclean.status = "disengaged";
    expect([d.isHulk(unclean), d.onTable(unclean)]).toEqual([false, false]);
  });
});

describe("characteristics", () => {
  test("speed: −5 crippled, −10 thrusters once, never below 0", () => {
    const { unclean } = fresh();
    expect(d.speed(unclean)).toBe(25);
    crit(unclean, "thrusters");
    crit(unclean, "thrusters");
    expect(d.speed(unclean)).toBe(15);
    unclean.damage = 4;
    expect(d.speed(unclean)).toBe(10);
    unclean.profile.speed = 10;
    expect(d.speed(unclean)).toBe(0);
  });

  test("leadership: Bridge Smashed −3, capped at 10", () => {
    const { s, unclean } = fresh();
    expect(d.leadership(s, unclean)).toBe(7);
    crit(unclean, "bridge_smashed");
    expect(d.leadership(s, unclean)).toBe(4);
    unclean.criticals = [];
    unclean.leadership = 12;
    expect(d.leadership(s, unclean)).toBe(10);
    unclean.leadership = null;
    expect(() => d.leadership(s, unclean)).toThrow(d.EngineError);
  });

  test("shields: halved when crippled, 0 after collapse or as a hulk", () => {
    const { unclean } = fresh();
    expect(d.maxShields(unclean)).toBe(2);
    unclean.damage = 4;
    expect(d.maxShields(unclean)).toBe(1);
    unclean.damage = 0;
    crit(unclean, "shields_collapse");
    expect(d.maxShields(unclean)).toBe(0);
    unclean.criticals = [];
    unclean.status = "drifting_hulk";
    expect(d.maxShields(unclean)).toBe(0);
  });

  test("turrets: halved when crippled, 0 as a hulk, unaffected by Brace", () => {
    const { unclean } = fresh();
    order(unclean, "brace_for_impact");
    expect(d.turrets(unclean)).toBe(2);
    unclean.damage = 4;
    expect(d.turrets(unclean)).toBe(1);
    unclean.status = "drifting_hulk";
    unclean.specialOrder = null;
    expect(d.turrets(unclean)).toBe(0);
  });

  test("canTurn: Engine Room damage stops turns", () => {
    const { unclean } = fresh();
    expect(d.canTurn(unclean)).toBe(true);
    crit(unclean, "engine_room");
    expect(d.canTurn(unclean)).toBe(false);
  });
});

describe("Blast Markers and shields", () => {
  test("contact is inclusive at base radius + BM radius (2.85 cm), within EPS", () => {
    const { s, unclean } = fresh();
    bm(s, 100, 105 - 2.85); // just touching
    bm(s, 100 + 2.8505, 105); // within EPS: touching
    bm(s, 100 - 2.86, 105); // clear
    expect(d.bmsInContact(s, unclean)).toHaveLength(2);
    expect(d.shieldCapacity(s, unclean)).toBe(0);
  });

  test("capacity = max shields − BMs in contact, floored at 0", () => {
    const { s, unclean } = fresh();
    expect(d.shieldCapacity(s, unclean)).toBe(2);
    bm(s, 100, 102.5);
    expect(d.shieldCapacity(s, unclean)).toBe(1);
    bm(s, 101, 107);
    bm(s, 98, 106);
    expect(d.shieldCapacity(s, unclean)).toBe(0);
  });

  test("ships off the table have no BMs in contact", () => {
    const { s, unclean } = fresh();
    bm(s, 100, 102.5);
    unclean.status = "disengaged";
    unclean.position = null;
    unclean.heading = null;
    expect(d.bmsInContact(s, unclean)).toEqual([]);
  });
});

describe("armour facing", () => {
  test("the Lunar's 6+ front armour faces a ship ahead of it", () => {
    const { agrippa } = fresh();
    expect(d.armourFacing(agrippa, { x: 85, y: 60 })).toEqual({ quadrant: "front", armour: 6 });
    expect(d.armourFacing(agrippa, { x: 120, y: 15 })).toEqual({ quadrant: "right", armour: 5 });
    expect(d.armourFacing(agrippa, { x: 85, y: 0 })).toEqual({ quadrant: "rear", armour: 5 });
    expect(d.armourFacing(agrippa, { x: 50, y: 15 })).toEqual({ quadrant: "left", armour: 5 });
  });

  test("on a boundary the attacker gets the lower armour unless a side is chosen (R7)", () => {
    const { agrippa } = fresh();
    const onTheLine = { x: 95, y: 25 }; // exactly 45° off the bow
    expect(d.facingQuadrants(agrippa, onTheLine)).toEqual(["front", "right"]);
    expect(d.armourFacing(agrippa, onTheLine)).toEqual({ quadrant: "right", armour: 5 });
    expect(d.armourFacing(agrippa, onTheLine, "front")).toEqual({ quadrant: "front", armour: 6 });
    expect(() => d.armourFacing(agrippa, onTheLine, "rear")).toThrow(d.EngineError);
  });
});

describe("weapons", () => {
  test("armament criticals disable weapons at that location only", () => {
    const { s, agrippa } = fresh();
    crit(agrippa, "port_armament");
    expect(d.weaponDisabled(s, agrippa, weapon(agrippa, "port_lances"))).toBe(true);
    expect(d.weaponDisabled(s, agrippa, weapon(agrippa, "port_battery"))).toBe(true);
    expect(d.weaponDisabled(s, agrippa, weapon(agrippa, "starboard_battery"))).toBe(false);
    expect(d.weaponDisabled(s, agrippa, weapon(agrippa, "prow_torpedoes"))).toBe(false);
  });

  test("a failed disengage test disables everything this turn", () => {
    const { s, agrippa } = fresh();
    s.turnState.ships["ship-1"]!.disengage = "failed";
    expect(agrippa.profile.weapons.every((w) => d.weaponDisabled(s, agrippa, w))).toBe(true);
  });

  test("effective strength halves (round up) and stacks", () => {
    const { agrippa } = fresh();
    const torps = weapon(agrippa, "prow_torpedoes"); // 6
    const battery = weapon(agrippa, "port_battery"); // 6
    const lances = weapon(agrippa, "port_lances"); // 2
    expect(d.effectiveStrength(agrippa, battery)).toBe(6);

    order(agrippa, "all_ahead_full");
    expect(d.effectiveStrength(agrippa, battery)).toBe(3);
    expect(d.effectiveStrength(agrippa, lances)).toBe(1);
    expect(d.effectiveStrength(agrippa, torps)).toBe(6); // ordnance unaffected (p. 64)

    agrippa.damage = 4; // crippled + AAF: 6 → 3 → 2
    expect(d.effectiveStrength(agrippa, battery)).toBe(2);
    expect(d.effectiveStrength(agrippa, torps)).toBe(3);

    order(agrippa, "brace_for_impact"); // crippled + braced, the p. 65 example
    expect(d.effectiveStrength(agrippa, torps)).toBe(2);
    expect(d.effectiveStrength(agrippa, battery)).toBe(2);
  });

  test("Brace over All Ahead Full halves once, not twice (R8)", () => {
    const { agrippa } = fresh();
    agrippa.specialOrder = {
      kind: "brace_for_impact",
      issued: 2,
      expires: { playerTurn: 3, at: "turn_end" },
      replaced: "all_ahead_full",
    };
    expect(d.effectiveStrength(agrippa, weapon(agrippa, "port_battery"))).toBe(3);
  });

  test("Lock On and Reload Ordnance don't halve", () => {
    const { agrippa } = fresh();
    for (const kind of ["lock_on", "reload_ordnance"] as const) {
      order(agrippa, kind);
      expect(d.effectiveStrength(agrippa, weapon(agrippa, "port_battery"))).toBe(6);
    }
  });
});

describe("shooting", () => {
  test("Defences column: moved under 5 cm last time; not before the first move (N7)", () => {
    const { agrippa } = fresh();
    expect(d.targetedAsDefences(agrippa)).toBe(false);
    agrippa.lastMove = { playerTurn: 2, distance: 4.9 };
    expect(d.targetedAsDefences(agrippa)).toBe(true);
    agrippa.lastMove = { playerTurn: 2, distance: 4.9995 }; // within EPS of 5
    expect(d.targetedAsDefences(agrippa)).toBe(false);
    agrippa.lastMove = { playerTurn: 2, distance: 0 };
    expect(d.targetedAsDefences(agrippa)).toBe(true);
  });

  test("gunnery columns", () => {
    const { agrippa } = fresh();
    expect(d.gunneryColumn(agrippa, "front")).toBe("B");
    expect(d.gunneryColumn(agrippa, "rear")).toBe("C");
    expect(d.gunneryColumn(agrippa, "left")).toBe("D");
    expect(d.gunneryColumn(agrippa, "right")).toBe("D");
    expect(d.gunneryColumn("ordnance", "front")).toBe("E");
    agrippa.profile.type = "escort";
    expect(["front", "rear", "left"].map((a) => d.gunneryColumn(agrippa, a as "front"))).toEqual(["C", "D", "E"]);
    agrippa.lastMove = { playerTurn: 2, distance: 0 };
    expect(d.gunneryColumn(agrippa, "right")).toBe("A");
  });

  test("Command check Ld: Under Fire −1, Enemy Contacts +1, cap 10 (p. 48)", () => {
    const { s, agrippa, unclean } = fresh();
    expect(d.commandCheckLd(s, agrippa)).toBe(8);
    order(unclean, "lock_on"); // the p. 48 example: enemy on orders → +1
    expect(d.commandCheckLd(s, agrippa)).toBe(9);
    bm(s, 85, 15 + 2.85);
    expect(d.commandCheckLd(s, agrippa)).toBe(8);
    s.blastMarkers = [];
    agrippa.leadership = 10;
    expect(d.commandCheckLd(s, agrippa)).toBe(10);
  });
});

describe("scoring (p. 128)", () => {
  test("1 per damage, +1 crippled, or +3 destroyed instead", () => {
    const { s, unclean } = fresh();
    expect(d.score(s, "p1")).toBe(0);
    unclean.damage = 5; // the rulebook example: 5 + 1 = 6
    expect(d.score(s, "p1")).toBe(6);
    unclean.damage = 8;
    unclean.status = "drifting_hulk"; // hulks count as destroyed (N5)
    expect(d.score(s, "p1")).toBe(11);
    unclean.status = "destroyed";
    unclean.position = null;
    expect(d.score(s, "p1")).toBe(11);
    expect(d.score(s, "p2")).toBe(0);
  });

  test("a disengaged ship still counts its damage and crippling", () => {
    const { s, unclean } = fresh();
    unclean.damage = 4;
    unclean.status = "disengaged";
    expect(d.score(s, "p1")).toBe(5);
  });
});

describe("turns and actors", () => {
  test("round and active player from the player turn", () => {
    const { s } = fresh(); // firstPlayer p2
    expect([1, 2, 3, 16].map(d.roundOf)).toEqual([1, 1, 2, 8]);
    expect([1, 2, 3, 4].map((pt) => d.activePlayer(s, pt))).toEqual(["p2", "p1", "p2", "p1"]);
  });

  test("actor in battle", () => {
    const { s } = fresh();
    expect(d.actor(s)).toBe("p2");
    s.clock = { ...s.clock, phase: "ordnance", step: "inactive_ordnance" };
    expect(d.actor(s)).toBe("p1");
    s.clock = { ...s.clock, phase: "end", step: "damage_control" };
    expect(d.actor(s)).toBe("either");
    s.pending.push({ id: "pend-90", kind: "brace", player: "p1", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } });
    expect(d.actor(s)).toBe("p1");
    s.pending = [];
    s.clock = { stage: "ended", setupStep: null, playerTurn: 16, phase: null, step: null };
    expect(d.actor(s)).toBe(null);
  });

  test("actor in setup", () => {
    const { s } = fresh();
    s.clock = { stage: "setup", setupStep: "roll_zones", playerTurn: 0, phase: null, step: null };
    expect(d.actor(s)).toBe("either");
    s.clock.setupStep = "choose_first_turn";
    expect(d.actor(s)).toBe("p2"); // the example's firstTurnChooser
  });

  test("deployment alternates from the first deployer and skips an exhausted fleet", () => {
    const { s } = fresh();
    s.setup.firstDeployer = "p1";
    for (const ship of s.ships) ship.status = "undeployed";
    s.clock = { stage: "setup", setupStep: "deploy", playerTurn: 0, phase: null, step: null };
    expect(d.actor(s)).toBe("p1");
    s.ships[0]!.status = "active";
    expect(d.actor(s)).toBe("p2");
    s.ships[1]!.status = "active";
    expect(d.nextDeployer(s)).toBe(null);

    // p1 has an extra ship: p1, p2, then p1 again (p2 has none left)
    const extra = structuredClone(s.ships[0]!);
    extra.id = "ship-9";
    s.ships.push(extra);
    for (const ship of s.ships) ship.status = "undeployed";
    expect(d.nextDeployer(s)).toBe("p1");
    s.ships[0]!.status = "active";
    s.ships[1]!.status = "active";
    expect(d.nextDeployer(s)).toBe("p1");
  });
});
