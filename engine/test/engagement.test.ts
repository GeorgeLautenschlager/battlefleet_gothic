/**
 * Fleet Engagement (state v0.12 §4–§5, N15–N19; transforms v0.10 §4.1, §5,
 * T49–T55; validator v0.8 V13).
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor } from "../src/state/derived";
import { deploymentDivisions, emptyDivisions, isSplit, setupBonus, setupOptions, SETUP_MAPS } from "../src/rules/engagement";
import { validate } from "../src/validator/validate";
import type { Formation, GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

const engagement = (p1: string[], p2: string[], limit = 750): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "fleet_engagement",
  forces: { kind: "points", limit },
  ships: [...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })), ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId }))],
});

/** Three Lunars against three Murders (Murders are faster: 25 cm to 20). */
const fresh = (): GameState => newGame(engagement(["lunar", "lunar", "lunar"], ["murder", "murder", "murder"]));

/** Through the Leadership roll to the formations. */
const atFormations = (): GameState => playDice(fresh(), { type: "roll_leadership", player: "p1" }, [1, 2, 3, 4, 5, 6]);

function formations(p1: Formation, p2: Formation): GameState {
  const s = play(atFormations(), { type: "choose_formation", player: "p1", formation: p1 });
  return play(s, { type: "choose_formation", player: "p2", formation: p2 });
}

describe("a Fleet Engagement game (transform §5)", () => {
  test("points forces, victory points, no round limit, no Cruiser Clash zones", () => {
    const s = fresh();
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario).toEqual({ id: "fleet_engagement", maxRounds: null, forces: { kind: "points", limit: 750 }, scoring: "victory_points" });
    expect(s.setup.engagement).toEqual({ formations: { p1: null, p2: null }, setupRolls: [], setupChooser: null, map: null, colours: null });
  });

  test("needs points forces and victory points", () => {
    expect(() => newGame({ ...engagement(["lunar"], ["murder"]), forces: { kind: "cruiser_clash" } })).toThrow(/points limit/);
    expect(() => newGame({ ...engagement(["lunar"], ["murder"]), scoring: "cruiser_clash" })).toThrow(/victory points/);
  });
});

describe("formations and the set-up roll-off", () => {
  test("p1 picks first, then p2; the first pick isn't logged by name (T50)", () => {
    let s = atFormations();
    expect(s.clock.setupStep).toBe("choose_formation");
    expect(actor(s)).toBe("p1");
    expect(validate(s, { type: "choose_formation", player: "p2", formation: "wedge" }).ok).toBe(false);
    s = play(s, { type: "choose_formation", player: "p1", formation: "sphere" });
    expect(actor(s)).toBe("p2");
    expect(logOf(s, "formation").at(-1)?.data).toEqual({ player: "p1" });
    s = play(s, { type: "choose_formation", player: "p2", formation: "wedge" });
    expect(s.clock.setupStep).toBe("roll_setup");
    expect(logOf(s, "formation").at(-1)?.data).toMatchObject({ formations: { p1: "sphere", p2: "wedge" } });
  });

  test("the formation table: splits, Wedge against Wedge, and plain B with each colour (N19)", () => {
    expect(setupOptions(formations("sphere", "wedge"))).toEqual([
      { map: "A", colours: { p1: "dark", p2: "white" } },
      { map: "C", colours: { p1: "dark", p2: "white" } },
    ]);
    expect(setupOptions(formations("cross", "sphere"))).toEqual([
      { map: "A", colours: { p1: "white", p2: "dark" } },
      { map: "D", colours: { p1: "white", p2: "dark" } },
    ]);
    expect(setupOptions(formations("wedge", "wedge")).map((o) => [o.map, o.colours.p1])).toEqual([["D", "dark"], ["D", "white"]]);
    const b = formations("cross", "wedge");
    expect(isSplit(b)).toBe(false);
    expect(setupOptions(b).map((o) => [o.map, o.colours.p1])).toEqual([["B", "white"], ["B", "dark"]]);
    expect(isSplit(formations("wedge", "wedge"))).toBe(true);
  });

  test("on a split the faster fleet gets +1; ties re-roll; on a plain B there are no bonuses (T51)", () => {
    const split = formations("sphere", "wedge");
    expect([setupBonus(split, "p1"), setupBonus(split, "p2")]).toEqual([0, 1]); // Murders 25 cm, Lunars 20
    // p1 5 vs p2 4 + 1: a tie, so again; then 6 vs 2 + 1
    let s = playDice(split, { type: "roll_setup", player: "p1" }, [5, 4]);
    expect(s.clock.setupStep).toBe("roll_setup");
    s = playDice(s, { type: "roll_setup", player: "p1" }, [6, 2]);
    expect(s.setup.engagement?.setupChooser).toBe("p1");
    expect(logOf(s, "setup_roll").at(-1)?.data).toEqual({ rolls: [6, 2], bonus: [0, 1], totals: [6, 3], split: true, winner: "p1" });
    expect(s.clock.setupStep).toBe("choose_setup");
    expect(setupBonus(formations("cross", "cross"), "p2")).toBe(0);
  });

  test("the winner picks a map and their colour from the two on offer (T52)", () => {
    let s = playDice(formations("sphere", "wedge"), { type: "roll_setup", player: "p1" }, [1, 6]);
    expect(actor(s)).toBe("p2");
    const bad = validate(s, { type: "choose_setup", player: "p2", map: "D", colour: "white" });
    expect(bad.ok ? null : bad.reason.code).toBe("INVALID_SETUP");
    expect(validate(s, { type: "choose_setup", player: "p2", map: "A", colour: "dark" }).ok).toBe(false); // p2 is white on A or C
    s = play(s, { type: "choose_setup", player: "p2", map: "C", colour: "white" });
    expect(s.setup.engagement).toMatchObject({ map: "C", colours: { p1: "dark", p2: "white" } });
    expect(s.clock.setupStep).toBe("roll_deploy_order");
    expect(deploymentDivisions(s, "p1")).toEqual(SETUP_MAPS.C.dark);
  });
});

/** Map D, p1 dark (three divisions along the bottom), p2 white, p1 deploying first. */
function deploying(p1Ships = ["lunar", "lunar", "lunar"]): GameState {
  let s = newGame(engagement(p1Ships, ["murder", "murder", "murder"]));
  s = playDice(s, { type: "roll_leadership", player: "p1" }, s.ships.map(() => 3));
  s = play(s, { type: "choose_formation", player: "p1", formation: "wedge" });
  s = play(s, { type: "choose_formation", player: "p2", formation: "wedge" });
  s = playDice(s, { type: "roll_setup", player: "p1" }, [6, 1]);
  s = play(s, { type: "choose_setup", player: "p1", map: "D", colour: "dark" });
  return playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
}
const deploy = (shipId: string, x: number, y: number, player: "p1" | "p2" = "p1"): Transform => ({ type: "deploy_ship", player, shipId, position: { x, y } });

describe("deploying into divisions (state N18, T53)", () => {
  test("ships face their division's arrow; outside every division is out", () => {
    const s = deploying();
    expect(s.clock.setupStep).toBe("deploy");
    const reject = validate(s, deploy("ship-1", 90, 60));
    expect(reject.ok ? null : reject.reason.code).toBe("NOT_IN_ZONE");
    const next = play(s, deploy("ship-1", 30, 15));
    expect(next.ships[0]).toMatchObject({ position: { x: 30, y: 15 }, heading: 0 });
    const white = play(next, deploy("ship-4", 90, 105, "p2"));
    expect(white.ships[3]?.heading).toBe(180);
  });

  test("every division gets a ship before any gets a second", () => {
    let s = play(deploying(), deploy("ship-1", 30, 15)); // left division
    s = play(s, deploy("ship-4", 60, 100, "p2"));
    expect(emptyDivisions(s, "p1")).toEqual([1, 2]);
    const second = validate(s, deploy("ship-2", 40, 15)); // left again, with 2 ships for 2 empty divisions
    expect(second.ok ? null : second.reason).toMatchObject({ code: "FILL_DIVISIONS_FIRST", details: { empty: [1, 2] } });
    expect(validate(s, deploy("ship-2", 150, 15)).ok).toBe(true);
  });

  test("with more ships than divisions, one may double up while there are spares; then the rest fill the gaps", () => {
    let s = deploying(["lunar", "lunar", "lunar", "lunar"]);
    s = play(s, deploy("ship-1", 30, 15));
    s = play(s, deploy("ship-5", 60, 100, "p2"));
    // 3 undeployed, 2 empty divisions: one can double up…
    s = play(s, deploy("ship-2", 45, 15));
    s = play(s, deploy("ship-6", 90, 100, "p2"));
    // …but now 2 undeployed for 2 empty divisions.
    const third = validate(s, deploy("ship-3", 50, 25));
    expect(third.ok ? null : third.reason.code).toBe("FILL_DIVISIONS_FIRST");
    expect(validate(s, deploy("ship-3", 90, 15)).ok).toBe(true);
  });
});
