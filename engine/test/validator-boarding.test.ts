/** Boarding checks (validator spec §4.2 checks 15–19, §4.3 checks 5–6, §4.6 board / teleport / end_step). */
import { describe, expect, test } from "vitest";
import type { GameState } from "../src/state/types";
import { addBm, addShip, agrippa, battle, expectOk, expectReject, unclean } from "./validator-fixtures";

const advance = (distance: number) => ({ kind: "advance" as const, distance });

/** Unclean (p2, at (100, 60) heading 180) to move; Agrippa sits 15 cm ahead at (100, 45). Boarding on. */
function beforeMove(): GameState {
  const s = battle();
  s.meta.options.boarding = true;
  unclean(s).position = { x: 100, y: 60 };
  agrippa(s).position = { x: 100, y: 45 };
  return s;
}
const boardMove = (patch: Record<string, unknown> = {}) => ({
  type: "move", player: "p2", shipId: "ship-2", path: [advance(12.5)], disengage: false, boardTargetId: "ship-1", ...patch,
});

/** End Phase, boarding step: Unclean (100, 50) has declared against Agrippa (100, 47), bases touching. */
function boardingStep(): GameState {
  const s = battle("end", "boarding");
  s.meta.options.boarding = true;
  unclean(s).position = { x: 100, y: 50 };
  agrippa(s).position = { x: 100, y: 47 };
  s.turnState.ships["ship-2"]!.boardingDeclared = "ship-1";
  return s;
}

/** Boarding step, nothing declared: Unclean 8 cm from Agrippa, whose two shields are both blocked by Blast Markers. */
function teleportStep(): GameState {
  const s = battle("end", "boarding");
  s.meta.options.boarding = true;
  unclean(s).position = { x: 100, y: 58 };
  agrippa(s).position = { x: 100, y: 50 };
  addBm(s, 97.2, 50);
  addBm(s, 102.8, 50);
  return s;
}
const teleport = { type: "teleport", player: "p2", shipId: "ship-2", targetId: "ship-1" };

describe("move: declaring a boarding action", () => {
  test("a path that ends with the bases touching may board", () => {
    expectOk(beforeMove(), boardMove());
  });

  test("checks 15–19", () => {
    const off = beforeMove();
    off.meta.options.boarding = false;
    expectReject(off, boardMove(), "BOARDING_OFF");

    expectReject(beforeMove(), boardMove({ boardTargetId: "ship-2" }), "INVALID_BOARDING_TARGET"); // its own ship
    const hulk = beforeMove();
    agrippa(hulk).status = "drifting_hulk";
    agrippa(hulk).damage = 8;
    expectReject(hulk, boardMove(), "INVALID_BOARDING_TARGET");

    const grappled = beforeMove();
    agrippa(grappled).grapple = { defenderId: "ship-1", attackerIds: ["ship-9"] };
    expectReject(grappled, boardMove(), "TARGET_GRAPPLED");

    expectReject(beforeMove(), boardMove({ disengage: true }), "CANNOT_BOARD_AND_LEAVE");

    const far = beforeMove();
    agrippa(far).position = { x: 100, y: 40 };
    expectReject(far, boardMove(), "NOT_IN_CONTACT", { distance: 7.5, needed: 3.2 });
  });
});

describe("shooting while boarding or grappled", () => {
  test("a ship that declared a boarding action can't fire; nor can a grappled one", () => {
    const fire = { type: "fire", player: "p2", shipId: "ship-2", weaponId: "prow_lances", target: { kind: "ship", id: "ship-1" } };
    const boarding = battle("shooting", "direct_fire");
    boarding.turnState.ships["ship-2"]!.boardingDeclared = "ship-1";
    expectReject(boarding, fire, "BOARDING_SHIP");
    const grappled = battle("shooting", "direct_fire");
    unclean(grappled).grapple = { defenderId: "ship-1", attackerIds: ["ship-2"] };
    expectReject(grappled, fire, "GRAPPLED");
  });
});

describe("board", () => {
  test("names the target and exactly its boarders", () => {
    expectOk(boardingStep(), { type: "board", player: "p2", targetId: "ship-1", together: true, priority: ["ship-2"] });
    expectReject(boardingStep(), { type: "board", player: "p2", targetId: "ship-1", together: true, priority: [] }, "INVALID_PRIORITY");
    expectReject(boardingStep(), { type: "board", player: "p2", targetId: "ship-2", together: true, priority: ["ship-2"] }, "NO_BOARDING_DECLARED");
    expectReject(boardingStep(), { type: "board", player: "p2", targetId: "ship-7", together: true, priority: [] }, "UNKNOWN_TARGET");
  });

  test("a declaration whose bases no longer touch has lapsed", () => {
    const s = boardingStep();
    agrippa(s).position = { x: 100, y: 30 };
    expectReject(s, { type: "board", player: "p2", targetId: "ship-1", together: true, priority: ["ship-2"] }, "NO_BOARDING_DECLARED");
  });

  test("end_step waits until every declared boarding action is fought", () => {
    expectReject(boardingStep(), { type: "end_step", player: "p2" }, "BOARDING_UNRESOLVED");
    const done = boardingStep();
    done.turnState.ships["ship-2"]!.boarded = true;
    expectOk(done, { type: "end_step", player: "p2" });
  });
});

describe("teleport", () => {
  test("onto a shieldless enemy within 10 cm with no more hits left", () => {
    expectOk(teleportStep(), teleport);
    const lockOn = teleportStep();
    unclean(lockOn).specialOrder = { kind: "lock_on", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    expectOk(lockOn, teleport);
  });

  test("checks 4–13", () => {
    const failed = teleportStep();
    failed.turnState.ships["ship-2"]!.disengage = "failed";
    expectReject(failed, teleport, "DISENGAGE_FAILED");

    const grappled = teleportStep();
    unclean(grappled).grapple = { defenderId: "ship-9", attackerIds: ["ship-2"] };
    expectReject(grappled, teleport, "GRAPPLED");

    const boarding = teleportStep();
    boarding.turnState.ships["ship-2"]!.boardingDeclared = "ship-1";
    expectReject(boarding, teleport, "BOARDING_SHIP");

    const twice = teleportStep();
    twice.turnState.ships["ship-2"]!.teleported = true;
    expectReject(twice, teleport, "ALREADY_TELEPORTED");

    const crippled = teleportStep();
    unclean(crippled).damage = 4;
    expectReject(crippled, teleport, "CANNOT_TELEPORT", { reason: "crippled" });

    const aaf = teleportStep();
    unclean(aaf).specialOrder = { kind: "all_ahead_full", issued: 1, expires: { playerTurn: 3, at: "movement_start" }, replaced: null };
    expectReject(aaf, teleport, "CANNOT_TELEPORT", { reason: "orders" });

    expectReject(teleportStep(), { ...teleport, targetId: "ship-8" }, "UNKNOWN_TARGET");
    const friend = teleportStep();
    addShip(friend, unclean(friend), { id: "ship-8", position: { x: 110, y: 58 } });
    expectReject(friend, { ...teleport, targetId: "ship-8" }, "INVALID_TARGET");

    const shields = teleportStep();
    shields.blastMarkers = shields.blastMarkers.slice(0, 1);
    expectReject(shields, teleport, "SHIELDS_UP");

    const far = teleportStep();
    unclean(far).position = { x: 100, y: 61 };
    expectReject(far, teleport, "OUT_OF_RANGE");

    const bigger = teleportStep();
    unclean(bigger).damage = 1;
    expectReject(bigger, teleport, "TARGET_TOO_LARGE");
  });

  test("with nothing to fight and no teleport possible, end_step is fine", () => {
    const s = teleportStep();
    expect(s.blastMarkers).toHaveLength(2);
    expectOk(s, { type: "end_step", player: "p2" });
  });
});
