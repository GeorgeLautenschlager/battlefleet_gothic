import { describe, expect, test } from "vitest";
import {
  arcsBearing,
  canEngage,
  isNearest,
  lineOfFireBlocked,
  nearestOrdnanceTargets,
  nearestShipTargets,
} from "../src/geometry/targeting";
import { getShip } from "../src/state/derived";
import { cloneJson } from "../src/state/json";
import type { GameState, Ship, TorpedoSalvo } from "../src/state/types";
import { specExampleState } from "./helpers";

/** The reducer spec §13 position: Unclean (100, 50) heading 180, Agrippa (76, 46) heading 0. */
function broadside(): { s: GameState; agrippa: Ship; unclean: Ship } {
  const s = specExampleState();
  const agrippa = getShip(s, "ship-1");
  const unclean = getShip(s, "ship-2");
  agrippa.position = { x: 76, y: 46 };
  unclean.position = { x: 100, y: 50 };
  return { s, agrippa, unclean };
}

const weapon = (ship: Ship, id: string) => {
  const w = ship.profile.weapons.find((x) => x.id === id);
  if (!w) throw new Error(id);
  return w;
};

/** Add a copy of `template` as a new ship. */
function addShip(s: GameState, template: Ship, id: string, position: { x: number; y: number }, patch: Partial<Ship> = {}): Ship {
  const ship: Ship = { ...cloneJson(template), id, position, ...patch };
  s.ships.push(ship);
  s.turnState.ships[id] = cloneJson(s.turnState.ships[template.id]!);
  return ship;
}

describe("arcs and engagement", () => {
  test("the reducer §13 broadside: Unclean's starboard battery bears, its port battery and prow lances don't", () => {
    const { s, agrippa, unclean } = broadside();
    const target = { kind: "ship" as const, ship: agrippa };
    expect(arcsBearing(unclean, weapon(unclean, "starboard_battery"), agrippa.position!)).toEqual(["right"]);
    expect(canEngage(s, unclean, weapon(unclean, "starboard_battery"), target)).toBe(true);
    expect(canEngage(s, unclean, weapon(unclean, "port_battery"), target)).toBe(false);
    expect(canEngage(s, unclean, weapon(unclean, "prow_lances"), target)).toBe(false);
  });

  test("range is stem to stem, inclusive within EPS", () => {
    const { s, agrippa, unclean } = broadside();
    const starboard = weapon(agrippa, "starboard_battery"); // 30 cm
    unclean.position = { x: 76 + 30, y: 46 };
    expect(canEngage(s, agrippa, starboard, { kind: "ship", ship: unclean })).toBe(true);
    unclean.position = { x: 76 + 30.0005, y: 46 };
    expect(canEngage(s, agrippa, starboard, { kind: "ship", ship: unclean })).toBe(true);
    unclean.position = { x: 76 + 30.01, y: 46 };
    expect(canEngage(s, agrippa, starboard, { kind: "ship", ship: unclean })).toBe(false);
  });

  test("torpedoes have no range, so never 'engage' as direct fire", () => {
    const { s, agrippa, unclean } = broadside();
    expect(canEngage(s, agrippa, weapon(agrippa, "prow_torpedoes"), { kind: "ship", ship: unclean })).toBe(false);
  });

  test("a target on an arc boundary bears for weapons on both sides of the line", () => {
    const { agrippa } = broadside();
    const onTheLine = { x: 86, y: 56 }; // exactly 45° off Agrippa's bow: front and right
    expect(arcsBearing(agrippa, weapon(agrippa, "starboard_battery"), onTheLine)).toEqual(["right"]);
    expect(arcsBearing(agrippa, weapon(agrippa, "prow_torpedoes"), onTheLine)).toEqual(["front"]);
  });
});

describe("line of fire", () => {
  test("a hulk across the line blocks it; one off the line doesn't", () => {
    const { s, agrippa, unclean } = broadside();
    const hulk = addShip(s, unclean, "ship-3", { x: 88, y: 48 }, { status: "drifting_hulk", damage: 8, owner: "p2" });
    expect(lineOfFireBlocked(s, unclean, agrippa)).toBe(true);
    expect(canEngage(s, unclean, weapon(unclean, "starboard_battery"), { kind: "ship", ship: agrippa })).toBe(false);
    hulk.position = { x: 88, y: 60 };
    expect(lineOfFireBlocked(s, unclean, agrippa)).toBe(false);
  });

  test("active ships never block, and the target hulk doesn't block itself", () => {
    const { s, agrippa, unclean } = broadside();
    addShip(s, unclean, "ship-3", { x: 88, y: 48 });
    expect(lineOfFireBlocked(s, unclean, agrippa)).toBe(false);
    agrippa.status = "drifting_hulk";
    agrippa.damage = 8;
    expect(lineOfFireBlocked(s, unclean, agrippa)).toBe(false);
  });
});

describe("nearest target per weapon (V1)", () => {
  test("a closer enemy off the other beam doesn't stop a broadside", () => {
    const { s, agrippa, unclean } = broadside();
    // A second Lunar 15 cm off Unclean's port side: closer than Agrippa (24.3 cm), but not in the starboard arc.
    const lunar2 = addShip(s, agrippa, "ship-3", { x: 115, y: 50 });
    const starboard = weapon(unclean, "starboard_battery");
    const port = weapon(unclean, "port_battery");
    expect(nearestShipTargets(s, unclean, starboard).map((x) => x.id)).toEqual(["ship-1"]);
    expect(nearestShipTargets(s, unclean, port).map((x) => x.id)).toEqual(["ship-3"]);
    expect(isNearest(s, unclean, starboard, { kind: "ship", ship: agrippa })).toBe(true);
    expect(isNearest(s, unclean, port, { kind: "ship", ship: lunar2 })).toBe(true);
  });

  test("of two in the same arc, the closer is nearest; ties both count", () => {
    const { s, agrippa, unclean } = broadside();
    const closer = addShip(s, agrippa, "ship-3", { x: 85, y: 50 });
    const starboard = weapon(unclean, "starboard_battery");
    expect(nearestShipTargets(s, unclean, starboard).map((x) => x.id)).toEqual(["ship-3"]);
    expect(isNearest(s, unclean, starboard, { kind: "ship", ship: agrippa })).toBe(false);
    closer.position = { x: 100 - 24.33105012119288, y: 50 }; // same distance as Agrippa, to within EPS
    expect(nearestShipTargets(s, unclean, starboard).map((x) => x.id).sort()).toEqual(["ship-1", "ship-3"]);
  });

  test("hulks are never the nearest (p. 71)", () => {
    const { s, agrippa, unclean } = broadside();
    addShip(s, agrippa, "ship-3", { x: 92, y: 40 }, { status: "blazing_hulk", damage: 8 });
    expect(nearestShipTargets(s, unclean, weapon(unclean, "starboard_battery")).map((x) => x.id)).toEqual(["ship-1"]);
  });

  test("friendly ships aren't targets at all", () => {
    const { s, unclean } = broadside();
    addShip(s, unclean, "ship-3", { x: 90, y: 50 });
    expect(nearestShipTargets(s, unclean, weapon(unclean, "starboard_battery")).map((x) => x.id)).toEqual(["ship-1"]);
  });

  test("nearest enemy salvo, among those this weapon can engage", () => {
    const { s, unclean } = broadside();
    const salvo = (id: string, x: number, y: number, owner: "p1" | "p2" = "p1"): TorpedoSalvo => ({
      id, kind: "torpedo_salvo", owner, launchedBy: "ship-1", launched: 2, position: { x, y }, heading: 90,
      strength: 6, speed: 30, width: 2.5, attacks: [],
    });
    s.ordnance.push(salvo("ord-10", 90, 50), salvo("ord-11", 80, 50), salvo("ord-12", 95, 50, "p2"), salvo("ord-13", 120, 50));
    s.nextId = 20;
    const starboard = weapon(unclean, "starboard_battery");
    expect(nearestOrdnanceTargets(s, unclean, starboard).map((o) => o.id)).toEqual(["ord-10"]);
    expect(isNearest(s, unclean, starboard, { kind: "ordnance", salvo: s.ordnance[1]! })).toBe(false);
  });
});
