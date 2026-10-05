import { describe, expect, test } from "vitest";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { cloneJson } from "../src/state/json";
import { actor } from "../src/state/derived";
import { LUNAR_VS_MURDER, freshGame } from "./helpers";

const withShips = (ships: GameConfig["ships"]): GameConfig => ({ ...cloneJson(LUNAR_VS_MURDER), ships });

describe("newGame", () => {
  test("produces a valid state at setup / roll_leadership", () => {
    const state = freshGame();
    expect(checkInvariants(state)).toEqual([]);
    expect(state.clock).toEqual({ stage: "setup", setupStep: "roll_leadership", playerTurn: 0, phase: null, step: null });
    expect(actor(state)).toBe("either");
  });

  test("ships are undeployed snapshots, ids in config order", () => {
    const state = freshGame();
    expect(state.ships.map((s) => [s.id, s.name, s.profile.classId, s.status])).toEqual([
      ["ship-1", "Agrippa", "lunar", "undeployed"],
      ["ship-2", "Unclean", "murder", "undeployed"],
    ]);
    expect(state.nextId).toBe(3);
    expect(state.ships.every((s) => s.leadership === null && s.position === null)).toBe(true);
  });

  test("only ships with torpedoes get a loaded flag", () => {
    const [lunar, murder] = freshGame().ships;
    expect(lunar?.loaded).toEqual({ torpedoes: true });
    expect(murder?.loaded).toEqual({});
  });

  test("profiles are copies, not shared with the catalogue", () => {
    const a = freshGame();
    const b = freshGame();
    a.ships[0]!.profile.weapons[0]!.strength = 99;
    expect(b.ships[0]!.profile.weapons[0]!.strength).toBe(2);
  });

  test("Cruiser Clash geometry and defaults", () => {
    const state = freshGame();
    expect(state.table).toEqual({ width: 180, height: 120 });
    expect(state.scenario.deploymentZones.A).toEqual({ x: 45, y: 90, width: 90, height: 30 });
    expect(state.scenario.deploymentFacing).toEqual({ A: 180, B: 0 });
    expect(state.meta.options).toEqual({ ramming: true, boarding: false, carriers: false });
    expect(state.players.p2.factionTraits.boardingModifier).toBe(1);
    expect(state.rng).toEqual({ algorithm: "mulberry32", seed: 1337, state: 1337, draws: 0 });
  });

  test("is deterministic", () => {
    expect(JSON.stringify(freshGame())).toBe(JSON.stringify(freshGame()));
  });

  test.each([
    ["an unknown class", withShips([{ owner: "p1", name: "X", classId: "nope" }, { owner: "p2", name: "Y", classId: "murder" }]), /unknown class/],
    ["a ship in the wrong fleet", withShips([{ owner: "p1", name: "X", classId: "murder" }, { owner: "p2", name: "Y", classId: "murder" }]), /can't serve/],
    ["unequal fleets", withShips([{ owner: "p1", name: "X", classId: "lunar" }, { owner: "p1", name: "Z", classId: "lunar" }, { owner: "p2", name: "Y", classId: "murder" }]), /same number/],
    ["an empty fleet", withShips([{ owner: "p1", name: "X", classId: "lunar" }]), /1–4 cruisers/],
    ["five cruisers", withShips([...Array(5).fill({ owner: "p1", name: "X", classId: "lunar" }), ...Array(5).fill({ owner: "p2", name: "Y", classId: "murder" })]), /1–4 cruisers/],
    ["a bad seed", { ...cloneJson(LUNAR_VS_MURDER), seed: 2 ** 32 }, /uint32/],
  ])("rejects %s", (_name, config, message) => {
    expect(() => newGame(config)).toThrow(message);
  });

  test("allows up to four a side", () => {
    const ships = [
      ...Array.from({ length: 4 }, (_, i) => ({ owner: "p1" as const, name: `L${i}`, classId: "lunar" })),
      ...Array.from({ length: 4 }, (_, i) => ({ owner: "p2" as const, name: `M${i}`, classId: "murder" })),
    ];
    expect(checkInvariants(newGame(withShips(ships)))).toEqual([]);
  });

  describe("carriers (p. 129)", () => {
    const fleets = (p1: string[], p2: string[], carriers: boolean): GameConfig => ({
      ...withShips([
        ...p1.map((classId, i) => ({ owner: "p1" as const, name: `I${i}`, classId })),
        ...p2.map((classId, i) => ({ owner: "p2" as const, name: `C${i}`, classId })),
      ]),
      options: { carriers },
    });

    test("one carrier each may go over the 185-point cap, with its bays loaded", () => {
      const state = newGame(fleets(["dictator", "lunar"], ["devastation", "murder"], true));
      expect(checkInvariants(state)).toEqual([]);
      expect(state.meta.options.carriers).toBe(true);
      expect(state.ships[0]!.loaded).toEqual({ torpedoes: true, launchBays: true });
      expect(state.ships[2]!.loaded).toEqual({ launchBays: true });
    });

    test("not without the option, and not two a side", () => {
      expect(() => newGame(fleets(["dictator"], ["murder"], false))).toThrow(/185 pt cap/);
      expect(() => newGame(fleets(["dictator", "dictator"], ["murder", "murder"], true))).toThrow(/only one carrier each/);
    });
  });
});
