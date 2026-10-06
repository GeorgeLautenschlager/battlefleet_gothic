/**
 * Planets (pp. 112–113): state v0.19 §4, §11, N64–N71; transforms v0.17
 * T107–T113; validator v0.14 V24–V27; reducer v0.14 R47–R49.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { PLANET_SIZES } from "../src/rules/planets";
import { validate } from "../src/validator/validate";
import type { GameState, PathStep, PlanetSize, Point } from "../src/state/types";
import { candidates } from "./bot";
import { fleets, LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";
import { addSalvo, agrippa, battle, broadside, expectOk, expectReject, unclean } from "./validator-fixtures";

const a = (distance: number): PathStep => ({ kind: "advance", distance });
const g = (degrees: number): PathStep => ({ kind: "gravity_turn", degrees });
const move = (path: PathStep[]) => ({ type: "move", player: "p2", shipId: "ship-2", path, disengage: false }) as const;
const fire = (target: { kind: string; id: string } = { kind: "ship", id: "ship-1" }) => ({
  type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target,
});

function withPlanet(s: GameState, position: Point, size: PlanetSize = "small"): GameState {
  s.table.features = [{ kind: "planet", id: "planet-900", position, size, ...PLANET_SIZES[size] }];
  return s;
}

describe("a planet in the config (transform §5, T107)", () => {
  test("one planet in the centre, at the size's template and well, with the next id", () => {
    const s = newGame({ ...cloneJson(LUNAR_VS_MURDER), planet: "medium" });
    expect(s.table.features).toEqual([{ kind: "planet", id: "planet-3", position: { x: 90, y: 60 }, size: "medium", diameter: 25, well: 15 }]);
    expect(s.nextId).toBe(4);
    expect(checkInvariants(s)).toEqual([]);
    expect(() => newGame({ ...cloneJson(LUNAR_VS_MURDER), planet: "huge" as PlanetSize })).toThrow(/small, medium or large/);
  });
});

describe("line of sight (state N65, T111, V24)", () => {
  test("a planet across the line blocks fire; one off the line doesn't", () => {
    // Unclean (100, 50) fires at Agrippa (76, 46).
    expectReject(withPlanet(broadside(), { x: 88, y: 48 }), fire(), "LINE_OF_FIRE_BLOCKED");
    expectOk(withPlanet(broadside(), { x: 88, y: 60 }), fire());
  });

  test("a ship on the template sees out and is seen", () => {
    expectOk(withPlanet(broadside(), { x: 78, y: 46 }), fire());
    expectOk(withPlanet(broadside(), { x: 98, y: 50 }), fire());
  });

  test("planets block shots at ordnance too", () => {
    const s = withPlanet(broadside(), { x: 88, y: 48 });
    const salvo = addSalvo(s, { owner: "p1", position: { x: 76, y: 46 }, heading: 90 });
    expectReject(s, fire({ kind: "ordnance", id: salvo.id }), "LINE_OF_FIRE_BLOCKED");
  });
});

describe("gravity wells (state N67–N69, T108–T110, V25–V27)", () => {
  // Unclean at (100, 105) heading 180; a medium planet (radius 12.5, well 15) 20 cm to the east, off its port side: in its well.
  const inWell = () => withPlanet(battle(), { x: 120, y: 105 }, "medium");

  test("a free turn toward the planet, first and/or last, up to 45°, not past it", () => {
    expect(unclean(inWell())).toMatchObject({ position: { x: 100, y: 105 }, heading: 180 });
    expectOk(inWell(), move([g(-45), a(15)]));
    expectOk(inWell(), move([g(-30)])); // high orbit, turning in place
    expectReject(inWell(), move([g(45), a(15)]), "INVALID_GRAVITY_TURN", { reason: "direction" });
    expectReject(inWell(), move([g(-50), a(15)]), "INVALID_GRAVITY_TURN", { reason: "too_sharp" });
    expectReject(inWell(), move([a(5), g(-45), a(10)]), "INVALID_GRAVITY_TURN", { reason: "position" });
    expectReject(inWell(), move([g(-45), g(-45)]), "INVALID_GRAVITY_TURN", { reason: "position" });
    expectReject(withPlanet(battle(), { x: 150, y: 105 }, "medium"), move([g(-45), a(15)]), "INVALID_GRAVITY_TURN", { reason: "not_in_well" });
    // Not past the planet: 10° short of facing it, the turn is at most 10°.
    const near = withPlanet(battle(), { x: 100 + 20 * Math.sin((190 * Math.PI) / 180), y: 105 + 20 * Math.cos((190 * Math.PI) / 180) }, "medium");
    expectOk(near, move([g(10), a(15)]));
    expectReject(near, move([g(20), a(15)]), "INVALID_GRAVITY_TURN", { reason: "too_sharp" });
  });

  test("it isn't a turn: a Lock On ship still makes it, and an ordinary turn after it needs its 10 cm", () => {
    const s = inWell();
    unclean(s).specialOrder = { kind: "lock_on", issued: 1, replaced: null, expires: { playerTurn: 3, at: "movement_start" } };
    expectOk(s, move([g(-45), a(15)]));
    expectReject(inWell(), move([g(-45), a(5), { kind: "turn", degrees: 45 }, a(10)]), "TURN_TOO_EARLY");
  });

  test("high orbit: a ship in a well needn't move", () => {
    expectOk(inWell(), move([]));
    expectReject(battle(), move([]), "PATH_TOO_SHORT");
  });

  test("the reducer turns the ship in place and logs it (R47)", () => {
    const s = play(inWell(), move([g(-45), a(15)]));
    expect(unclean(s).heading).toBeCloseTo(135, 9);
    expect(logOf(s, "gravity_turn").at(-1)?.data).toEqual({ shipId: "ship-2", degrees: -45, planetId: "planet-900" });
  });
});

describe("torpedoes and hulks meet planets (state N66, N70; R48–R49)", () => {
  test("a torpedo salvo is destroyed at the planet's edge", () => {
    const s0 = withPlanet(battle("ordnance", "active_ordnance"), { x: 60, y: 60 });
    const salvo = addSalvo(s0, { owner: "p2", launchedBy: "ship-2", launched: 0, position: { x: 40, y: 60 }, heading: 90 });
    const s = play(s0, { type: "move_ordnance", player: "p2", ordnanceId: salvo.id });
    expect(s.ordnance.some((o) => o.id === salvo.id)).toBe(false);
    expect(logOf(s, "planet_contact").at(-1)?.data).toEqual({ planetId: "planet-900", ordnanceId: salvo.id });
    expect(logOf(s, "ordnance_removed").at(-1)?.data).toEqual({ ordnanceId: salvo.id, reason: "planet" });
  });

  test("a hulk drifting into a planet is destroyed", () => {
    const s0 = withPlanet(battle("movement", "hulks_drift"), { x: 100, y: 95 });
    Object.assign(unclean(s0), { status: "drifting_hulk", damage: 8 });
    const s = playDice(s0, { type: "drift_hulk", player: "p2", shipId: "ship-2" }, [1, 2, 3, 4]);
    expect(unclean(s)).toMatchObject({ status: "destroyed", position: null });
    expect(logOf(s, "hulk_lost").at(-1)?.data).toEqual({ shipId: "ship-2", reason: "planet" });
  });

  test("attack craft and ships cross planets freely (T113)", () => {
    const s = withPlanet(battle(), { x: 100, y: 95 });
    expectOk(s, move([a(20)]));
    expect(agrippa(s)).toBeDefined();
  });
});

describe("full games with a planet", () => {
  const playOut = (seed: number, config: GameConfig): GameState => {
    let s = newGame({ ...cloneJson(config), seed });
    for (let n = 0; s.clock.stage !== "ended"; n++) {
      if (n > 6000) throw new Error(`seed ${seed}: no end in sight at ${JSON.stringify(s.clock)}`);
      const t = candidates(s, n).find((c) => validate(s, c).ok);
      if (t === undefined) throw new Error(`seed ${seed}: stuck at ${JSON.stringify(s.clock)}`);
      s = play(s, t);
    }
    return s;
  };
  const config: GameConfig = { ...fleets({ faction: "imperial_navy", classId: "lunar", n: 3 }, { faction: "chaos", classId: "murder", n: 3 }), planet: "large" };
  test.each([1, 2, 3, 4])("seed %i plays to a result", (seed) => {
    expect(playOut(seed, config).result).not.toBeNull();
  }, 60_000);
});
