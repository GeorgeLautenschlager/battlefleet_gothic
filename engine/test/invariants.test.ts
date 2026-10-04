import { describe, expect, test } from "vitest";
import { checkInvariants } from "../src/state/invariants";
import type { GameState } from "../src/state/types";
import { specExampleState } from "./helpers";

const rules = (s: GameState) => checkInvariants(s).map((v) => v.rule);

describe("checkInvariants", () => {
  test("the spec's example is valid", () => {
    expect(checkInvariants(specExampleState())).toEqual([]);
  });

  test.each<[string, string, (s: GameState) => void]>([
    ["J", "undefined", (s) => { (s.ships[0] as unknown as Record<string, unknown>).name = undefined; }],
    ["J", "NaN", (s) => { s.ships[0]!.position = { x: NaN, y: 1 }; }],
    ["J", "−0", (s) => { s.ships[0]!.heading = -0; }],
    ["J", "a class instance", (s) => { (s.meta as unknown as Record<string, unknown>).createdAt = new Date(0); }],
    ["I1", "duplicate ids", (s) => { s.ships[1]!.id = "ship-1"; }],
    ["I1", "an id at or above nextId", (s) => { s.nextId = 2; }],
    ["I1", "a malformed id", (s) => { s.blastMarkers.push({ id: "bm_1", position: { x: 1, y: 1 }, placed: 1, cause: "shield_hit" }); }],
    ["I2", "damage above hits", (s) => { s.ships[0]!.damage = 9; }],
    ["I2", "an active ship at 0 hits", (s) => { s.ships[0]!.damage = 8; }],
    ["I2", "a hulk with hits left", (s) => { s.ships[0]!.status = "drifting_hulk"; }],
    ["I3", "an active ship with no position", (s) => { s.ships[0]!.position = null; }],
    ["I3", "a stem off the table", (s) => { s.ships[0]!.position = { x: 181, y: 10 }; }],
    ["I3", "a heading of 360", (s) => { s.ships[0]!.heading = 360; }],
    ["I4", "a disengaged ship on orders", (s) => {
      const ship = s.ships[0]!;
      Object.assign(ship, { status: "disengaged", position: null, heading: null });
      ship.specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    }],
    ["I5", "an activation outside move_ships", (s) => {
      s.clock.step = "hulks_drift";
      s.activation = activation("ship-2");
    }],
    ["I5", "an activation for the inactive player", (s) => { s.activation = activation("ship-1"); }],
    ["I5", "a move in progress with nothing pending", (s) => { s.activation = { ...activation("ship-2"), stage: "moving" }; }],
    ["I6", "work queued with nothing pending", (s) => { s.queue.push({ kind: "continue_move" }); }],
    ["I7", "a decision pending during setup", (s) => {
      s.clock = { stage: "setup", setupStep: "deploy", playerTurn: 0, phase: null, step: null };
      s.turnState.playerTurn = 0;
      s.pending.push({ id: "pend-5", kind: "brace", player: "p1", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } });
      s.nextId = 20;
    }],
    ["I8", "two Bridge Smashed", (s) => {
      s.ships[0]!.criticals.push({ id: "crit-5", kind: "bridge_smashed", playerTurn: 1 }, { id: "crit-6", kind: "bridge_smashed", playerTurn: 1 });
      s.nextId = 20;
    }],
    ["I9", "an empty torpedo salvo", (s) => {
      s.ordnance.push({ id: "ord-5", kind: "torpedo_salvo", owner: "p1", launchedBy: "ship-1", launched: 1, position: { x: 85, y: 20 }, heading: 0, strength: 0, speed: 30, width: 2.5, attacks: [] });
      s.nextId = 20;
    }],
    ["I10", "turnState from another player turn", (s) => { s.turnState.playerTurn = 2; }],
    ["I11", "ended with no result", (s) => { s.clock = { stage: "ended", setupStep: null, playerTurn: 16, phase: null, step: null }; }],
    ["C", "a step from the wrong phase", (s) => { s.clock.step = "direct_fire"; }],
    ["C", "a missing turnState entry", (s) => { delete s.turnState.ships["ship-2"]; }],
    ["C", "battle with Leadership unrolled", (s) => { s.ships[0]!.leadership = null; }],
  ])("%s: catches %s", (rule, _name, mutate) => {
    const s = specExampleState();
    mutate(s);
    expect(rules(s)).toContain(rule);
  });
});

function activation(shipId: string): NonNullable<GameState["activation"]> {
  return {
    kind: "move", shipId, stage: "ordered", order: null, aafExtra: null, ram: null,
    maxDistance: 25, minDistance: 12.5, start: { position: { x: 0, y: 0 }, heading: 0 },
    distanceMoved: 0, distanceSinceTurn: 0, turnsMade: 0, truncated: false, remainingPath: [],
    slowedByBlastMarkers: false, zeroShieldBMTestDone: false, disengage: false,
  };
}
