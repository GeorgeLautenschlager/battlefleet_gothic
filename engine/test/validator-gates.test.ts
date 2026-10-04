import { describe, test } from "vitest";
import { addSalvo, battle, expectOk, expectReject } from "./validator-fixtures";
import { specJsonBlocks } from "./helpers";
import { specExampleState } from "./helpers";

const advance = (distance: number) => ({ kind: "advance", distance });

describe("G1 well-formed", () => {
  const s = battle();
  test.each<[string, unknown, string]>([
    ["not an object", 42, "$"],
    ["an array", [], "$"],
    ["no type", { player: "p2" }, "type"],
    ["an unknown type", { type: "teleport", player: "p2" }, "type"],
    ["a bad player", { type: "end_step", player: "p3" }, "player"],
    ["an extra field", { type: "end_step", player: "p2", please: true }, "please"],
    ["a missing field", { type: "move", player: "p2", shipId: "ship-2", disengage: false }, "path"],
    ["a wrong type", { type: "move", player: "p2", shipId: "ship-2", path: [], disengage: "no" }, "disengage"],
    ["a bad path step", { type: "move", player: "p2", shipId: "ship-2", path: [advance(5), { kind: "turn" }], disengage: false }, "path[1].degrees"],
    ["an unknown step kind", { type: "move", player: "p2", shipId: "ship-2", path: [{ kind: "warp" }], disengage: false }, "path[0].kind"],
    ["a non-finite number", { type: "move", player: "p2", shipId: "ship-2", path: [advance(Infinity)], disengage: false }, "path[0].distance"],
    ["an unknown order", { type: "declare_order", player: "p2", shipId: "ship-2", order: "full_speed" }, "order"],
    ["a bad quadrant", { type: "fire", player: "p2", shipId: "ship-2", weaponId: "w", target: { kind: "ship", id: "ship-1" }, arc: "up" }, "arc"],
    ["a bad target kind", { type: "fire", player: "p2", shipId: "ship-2", weaponId: "w", target: { kind: "planet", id: "x" } }, "target.kind"],
    ["a non-string priority", { type: "remove_blast_markers", player: "p2", priority: ["bm-1", 2] }, "priority[1]"],
  ])("rejects %s", (_name, t, field) => {
    expectReject(s, t, "MALFORMED", { field });
  });

  test("optional fields may be absent or present", () => {
    expectOk(s, { type: "declare_order", player: "p2", shipId: "ship-2", order: "lock_on" });
    expectReject(s, { type: "declare_order", player: "p2", shipId: "ship-2", order: "lock_on", ramTargetId: "ship-1" }, "RAM_NOT_ALLOWED");
  });
});

describe("G2–G6", () => {
  test("G2: nothing is legal once the game is over", () => {
    const s = battle();
    s.clock = { stage: "ended", setupStep: null, playerTurn: 16, phase: null, step: null };
    expectReject(s, { type: "end_step", player: "p2" }, "GAME_OVER");
  });

  test("G3: a pending brace must be answered first", () => {
    const s = battle("shooting", "direct_fire");
    s.pending.push({ id: "pend-9", kind: "brace", player: "p1", shipId: "ship-1", source: { kind: "ship", id: "ship-2" } });
    expectReject(s, { type: "end_step", player: "p2" }, "PENDING_DECISION", { pendingId: "pend-9" });
    expectReject(s, { type: "answer_brace", player: "p2", pendingId: "pend-9", attempt: true }, "NOT_YOUR_TURN", { expected: "p1" });
    expectOk(s, { type: "answer_brace", player: "p1", pendingId: "pend-9", attempt: true });
    expectReject(s, { type: "answer_brace", player: "p1", pendingId: "pend-8", attempt: false }, "NOT_TOP_PENDING");
  });

  test("G4: no answer without a question", () => {
    expectReject(battle(), { type: "answer_brace", player: "p2", pendingId: "pend-1", attempt: true }, "NO_PENDING_DECISION");
  });

  test("G5: only the active player, except where either may act", () => {
    expectReject(battle(), { type: "end_step", player: "p1" }, "NOT_YOUR_TURN", { expected: "p2" });
    const roll = battle();
    roll.clock = { stage: "setup", setupStep: "roll_zones", playerTurn: 0, phase: null, step: null };
    roll.turnState.playerTurn = 0;
    expectOk(roll, { type: "roll_zones", player: "p1" });
    expectOk(roll, { type: "roll_zones", player: "p2" });
  });

  test("G5: the inactive player moves ordnance in the inactive step", () => {
    const s = battle("ordnance", "inactive_ordnance");
    const salvo = addSalvo(s, { owner: "p1" });
    expectOk(s, { type: "move_ordnance", player: "p1", ordnanceId: salvo.id });
    expectReject(s, { type: "move_ordnance", player: "p2", ordnanceId: salvo.id }, "NOT_YOUR_TURN", { expected: "p1" });
  });

  test("G6: transforms only at their own moment", () => {
    expectReject(battle(), { type: "end_step", player: "p2" }, "WRONG_MOMENT", { stage: "battle", step: "move_ships" });
    expectOk(battle("shooting", "direct_fire"), { type: "end_step", player: "p2" });
    expectOk(battle("shooting", "launch_ordnance"), { type: "end_step", player: "p2" });
    expectReject(battle(), { type: "roll_leadership", player: "p2" }, "WRONG_MOMENT");
    const setup = battle();
    setup.clock = { stage: "setup", setupStep: "roll_leadership", playerTurn: 0, phase: null, step: null };
    expectReject(setup, { type: "roll_zones", player: "p1" }, "WRONG_MOMENT", { setupStep: "roll_leadership" });
    expectOk(setup, { type: "roll_leadership", player: "p1" });
  });

  test("choose_first_turn belongs to the roll's winner", () => {
    const s = specExampleState();
    s.clock = { stage: "setup", setupStep: "choose_first_turn", playerTurn: 0, phase: null, step: null };
    s.turnState.playerTurn = 0;
    expectOk(s, { type: "choose_first_turn", player: "p2", goFirst: true });
    expectReject(s, { type: "choose_first_turn", player: "p1", goFirst: true }, "NOT_YOUR_TURN", { expected: "p2" });
  });
});

describe("validator/SPEC.md §6 examples", () => {
  const [wrongPlayer, turnTooEarly] = specJsonBlocks("validator/SPEC.md");

  test("wrong player", () => {
    expectReject(specExampleState(), wrongPlayer, "NOT_YOUR_TURN", { expected: "p2" });
  });

  test("turning too early", () => {
    expectReject(specExampleState(), turnTooEarly, "TURN_TOO_EARLY", { stepIndex: 1, sinceLastTurn: 5, required: 10 });
  });

  test("too slow", () => {
    expectReject(specExampleState(), { type: "move", player: "p2", shipId: "ship-2", path: [advance(10)], disengage: false }, "PATH_TOO_SHORT", {
      total: 10,
      limit: 12.5,
      slowed: false,
    });
  });

  test("legal", () => {
    expectOk(specExampleState(), {
      type: "move", player: "p2", shipId: "ship-2", disengage: false,
      path: [advance(12.5), { kind: "turn", degrees: -45 }, advance(12.5)],
    });
  });

  test("out of arc: port battery at a target off the bow; the prow lances can take it", () => {
    const s = battle("shooting", "direct_fire");
    s.ships[1]!.position = { x: 100, y: 60 };
    s.ships[0]!.position = { x: 85, y: 35 };
    const fire = (weaponId: string) => ({ type: "fire", player: "p2", shipId: "ship-2", weaponId, target: { kind: "ship", id: "ship-1" } });
    expectReject(s, fire("port_battery"), "OUT_OF_ARC");
    expectOk(s, fire("prow_lances"));
  });
});
