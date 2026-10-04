import { describe, test } from "vitest";
import type { GameState } from "../src/state/types";
import { addBm, addSalvo, addShip, agrippa, battle, expectOk, expectReject, unclean } from "./validator-fixtures";
import { specExampleState } from "./helpers";

describe("deploy_ship", () => {
  // p1 deploys first, in zone B: x 45–135, y 0–30.
  const deploying = (): GameState => {
    const s = specExampleState();
    s.clock = { stage: "setup", setupStep: "deploy", playerTurn: 0, phase: null, step: null };
    s.turnState.playerTurn = 0;
    s.setup.firstDeployer = "p1";
    s.setup.firstPlayer = null;
    for (const ship of s.ships) Object.assign(ship, { status: "undeployed", position: null, heading: null });
    return s;
  };
  const deploy = (x: number, y: number, shipId = "ship-1", player = "p1") => ({
    type: "deploy_ship", player, shipId, position: { x, y },
  });

  test("anywhere in the zone, edges included", () => {
    expectOk(deploying(), deploy(90, 15));
    expectOk(deploying(), deploy(45, 0));
    expectOk(deploying(), deploy(135, 30));
  });

  test("NOT_IN_ZONE", () => {
    expectReject(deploying(), deploy(90, 31), "NOT_IN_ZONE", { zone: "B" });
    expectReject(deploying(), deploy(44, 15), "NOT_IN_ZONE");
  });

  test("turn order, ownership and status", () => {
    expectReject(deploying(), deploy(100, 105, "ship-2", "p2"), "NOT_YOUR_TURN", { expected: "p1" });
    expectReject(deploying(), deploy(90, 15, "ship-2"), "NOT_YOUR_SHIP");
    // Once p1 has placed a ship, it's p2's turn, even though p1 has another waiting.
    const s = deploying();
    const spare = addShip(s, agrippa(s), { status: "undeployed", position: null, heading: null });
    Object.assign(agrippa(s), { status: "active", position: { x: 90, y: 15 }, heading: 0 });
    expectReject(s, deploy(60, 15, spare.id), "NOT_YOUR_TURN", { expected: "p2" });
  });

  test("ALREADY_DEPLOYED", () => {
    const s = deploying();
    Object.assign(agrippa(s), { status: "active", position: { x: 90, y: 15 }, heading: 0 });
    s.setup.firstDeployer = "p2"; // p2 first, then p1: after one deployment, p1 is up
    expectReject(s, deploy(60, 15), "ALREADY_DEPLOYED");
  });

  test("BASES_OVERLAP: bases may touch, not overlap (V5)", () => {
    const s = deploying();
    s.setup.firstDeployer = "p2"; // p2 → p1 → p2 → p1
    const placed = addShip(s, agrippa(s), { status: "active", position: { x: 90, y: 15 }, heading: 0 });
    Object.assign(unclean(s), { status: "active", position: { x: 100, y: 105 }, heading: 180 });
    // Two deployed (p2's, then p1's `placed`); p2 has nothing left, so p1 deploys Agrippa.
    expectReject(s, deploy(92, 15), "BASES_OVERLAP", { shipId: placed.id });
    expectOk(s, deploy(93.2, 15)); // exactly touching: 2 × 1.6 cm
  });
});

describe("move_ordnance", () => {
  const ordnanceStep = () => battle("ordnance", "active_ordnance");
  const moveIt = (ordnanceId: string) => ({ type: "move_ordnance", player: "p2", ordnanceId });

  test("the owner moves each salvo once", () => {
    const s = ordnanceStep();
    const salvo = addSalvo(s, { owner: "p2" });
    expectOk(s, moveIt(salvo.id));
    s.turnState.ordnanceMoved.push(salvo.id);
    expectReject(s, moveIt(salvo.id), "ORDNANCE_ALREADY_MOVED");
  });

  test("UNKNOWN_ORDNANCE, NOT_YOUR_ORDNANCE", () => {
    const s = ordnanceStep();
    const enemy = addSalvo(s, { owner: "p1" });
    expectReject(s, moveIt("ord-99"), "UNKNOWN_ORDNANCE");
    expectReject(s, moveIt(enemy.id), "NOT_YOUR_ORDNANCE");
  });
});

describe("repair", () => {
  const damageControl = (): GameState => {
    const s = battle("end", "damage_control");
    agrippa(s).criticals = [
      { id: "crit-900", kind: "fire", playerTurn: 1 },
      { id: "crit-901", kind: "thrusters", playerTurn: 1 },
      { id: "crit-902", kind: "bridge_smashed", playerTurn: 1 },
    ];
    return s;
  };
  const repair = (priority: string[], player = "p1", shipId = "ship-1") => ({ type: "repair", player, shipId, priority });

  test("either player repairs their own ships, naming every repairable critical once", () => {
    expectOk(damageControl(), repair(["crit-901", "crit-900"])); // p1 repairs in p2's turn
    expectReject(damageControl(), repair(["crit-900"], "p2"), "NOT_YOUR_SHIP");
  });

  test("INVALID_PRIORITY reports what's wrong", () => {
    expectReject(damageControl(), repair(["crit-900"]), "INVALID_PRIORITY", { missing: ["crit-901"], unexpected: [], duplicates: [] });
    expectReject(damageControl(), repair(["crit-900", "crit-901", "crit-902"]), "INVALID_PRIORITY", { unexpected: ["crit-902"] });
    expectReject(damageControl(), repair(["crit-900", "crit-900", "crit-901"]), "INVALID_PRIORITY", { duplicates: ["crit-900"] });
  });

  test("NOTHING_TO_REPAIR: unrepairable criticals don't count", () => {
    const s = damageControl();
    agrippa(s).criticals = [{ id: "crit-902", kind: "bridge_smashed", playerTurn: 1 }];
    expectReject(s, repair([]), "NOTHING_TO_REPAIR");
  });

  test("ALREADY_REPAIRED, SHIP_NOT_ACTIVE", () => {
    const done = damageControl();
    done.turnState.ships["ship-1"]!.repaired = true;
    expectReject(done, repair(["crit-900", "crit-901"]), "ALREADY_REPAIRED");
    const hulk = damageControl();
    Object.assign(agrippa(hulk), { status: "drifting_hulk", damage: 8 });
    expectReject(hulk, repair(["crit-900", "crit-901"]), "SHIP_NOT_ACTIVE");
  });
});

describe("remove_blast_markers", () => {
  test("names exactly the markers not touching a ship on the table", () => {
    const s = battle("end", "blast_marker_removal");
    addBm(s, 100, 107); // touching Unclean: not removable
    const free1 = addBm(s, 60, 60);
    const free2 = addBm(s, 140, 60);
    const remove = (priority: string[]) => ({ type: "remove_blast_markers", player: "p2", priority });
    expectOk(s, remove([free2.id, free1.id]));
    expectReject(s, remove([free1.id]), "INVALID_PRIORITY", { missing: [free2.id] });
    const touching = s.blastMarkers[0]!.id;
    expectReject(s, remove([free1.id, free2.id, touching]), "INVALID_PRIORITY", { unexpected: [touching] });
    expectReject(s, { ...remove([free1.id, free2.id]), player: "p1" }, "NOT_YOUR_TURN", { expected: "p2" });
  });
});
