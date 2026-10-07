import { describe, expect, test } from "vitest";
import { newGame, reduce } from "@bfg/engine";
import { cruiserClash, holdsPlanet, sideProblem, type NewGameOptions, type Side } from "../src/game/config";
import { describe as prose } from "../src/log/format";
import { fieldAt, kindFor, leftToPlace, placeAt } from "../src/game/place";

/** Ann holds a medium planet with a Lunar, two fire ships, three mines and a minefield; Bo brings a Murder. */
const ann: Side = { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Torch 1", "Torch 2"], classes: ["lunar", "fire_ship", "fire_ship"], emplacements: { orbitalMines: 3, minefields: 1 } };
const options: NewGameOptions = {
  p1: ann,
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  forces: { kind: "points", limit: 750 },
  scoring: "victory_points",
  planet: "medium",
  seed: 7,
};

describe("mines and minefields from the form (state N107)", () => {
  test("the holder's go into the config; fire ships squadron as system ships", () => {
    const config = cruiserClash(options, new Date(0));
    expect([config.orbitalMines, config.minefields]).toEqual([3, 1]);
    expect(config.ships.filter((s) => s.classId === "fire_ship").map((s) => s.squadron)).toEqual(["System ships", "System ships"]);
    expect(newGame(config).setup.emplacements).toMatchObject({ owner: "p1", orbitalMines: 3, minefields: 1 });
    // Bo holding the planet: Ann's mines stay at home.
    expect(cruiserClash({ ...options, planetHolder: "p2" }, new Date(0)).orbitalMines).toBeUndefined();
  });

  test("only the planet holder may buy them", () => {
    expect(holdsPlanet(options, "p1")).toBe(true);
    expect(holdsPlanet(options, "p2")).toBe(false);
    const noPlanet: NewGameOptions = { ...options };
    delete noPlanet.planet;
    expect(holdsPlanet(noPlanet, "p1")).toBe(false);
    expect(holdsPlanet({ ...options, scenario: "surprise_attack", attacker: "p1" }, "p2")).toBe(true);
    expect(sideProblem(ann, false, options.forces, false, undefined, "medium", true)).toBeNull();
    expect(sideProblem(ann, false, options.forces, false, undefined, "medium", false)).toMatch(/Only the planet holder fields orbital mines/);
  });
});

describe("placing them (T143–T146)", () => {
  test("a click places a mine or the next minefield, turned if asked", () => {
    let s = newGame(cruiserClash(options, new Date(0)));
    for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) {
      while (s.clock.setupStep === type) s = reduce(s, { type, player: "p1" });
    }
    expect(s.clock.setupStep).toBe("place_defences");
    const size = leftToPlace(s).fields[0]!;
    expect(kindFor(s, { kind: "minefield", turned: false })).toBe("minefield");
    expect(fieldAt(s, { kind: "minefield", turned: true }, { x: 60, y: 60 })).toEqual({ x: 60 - size.height / 2, y: 60 - size.width / 2, width: size.height, height: size.width });
    expect(placeAt(s, "p1", { kind: "minefield", turned: true }, { x: 60, y: 60 })).toEqual({ type: "place_defence", player: "p1", kind: "minefield", position: { x: 60, y: 60 }, turned: true });
    expect(placeAt(s, "p1", { kind: "orbital_mine", turned: true }, { x: 90, y: 82 })).toEqual({ type: "place_defence", player: "p1", kind: "orbital_mine", position: { x: 90, y: 82 } });
  });
});

describe("the log", () => {
  test("mines, minefields and fire ships read as sentences", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("attack", { source: { kind: "ordnance", id: "ord-9" }, targetId: "ship-4", weapon: "mine", need: 5, rolls: [5, 6, 1, 2], rerolls: [], hits: 2 }))).toBe(
      "An orbital mine detonates against Unclean: [5 6 1 2] need 5+, 2 hits",
    );
    expect(prose(s, entry("minefield_test", { shipId: "ship-4", minefieldId: "mf-8", leadership: 8, rolls: [6, 6], passed: false, hitRolls: [4] }))).toBe(
      "Unclean picks its way through a minefield [6 6] against Ld 8: mines go off [4], 4 hits",
    );
    expect(prose(s, entry("minefield_detection", { minefieldId: "mf-8", rolls: [5], checks: [{ shipId: "ship-4", roll: 5, modifier: 0, detected: true, mineId: "ord-12" }] }))).toBe(
      "A minefield scans [5]: Unclean detected, a mine activates",
    );
    expect(prose(s, entry("detonation", { shipId: "ship-2", radiusRolls: [6, 6, 5], radius: 17, blastMarkerId: "bm-1", ships: [{ shipId: "ship-3", lost: true }, { shipId: "ship-4", rolls: [5], fires: 3 }], ordnanceIds: ["ord-9"] }))).toBe(
      "Torch 1 detonates [6 6 5] 17 cm: Torch 2 destroyed, Unclean 3 fires; 1 ordnance marker gone",
    );
  });
});

describe("Surprise Attack's free defences (T157–T162)", () => {
  test("new games have them; the shopping list names ships afresh and squadrons escorts by class", async () => {
    const { shoppingList } = await import("../src/panels/DefenceShopping");
    const sa: NewGameOptions = { ...options, scenario: "surprise_attack", attacker: "p2", p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"] } };
    const config = cruiserClash(sa, new Date(0));
    expect(config.options?.freeDefences).toBe(true);
    let s = newGame(config);
    s = reduce(s, { type: "roll_leadership", player: "p1" });
    s = reduce(s, { type: "choose_alert", player: "p1", units: ["ship-1"] });
    expect(s.clock.setupStep).toBe("choose_defences");
    const t = shoppingList(s, "p1", { system_ship: 7, laser_platform: 1 }, 2, 0);
    expect(t).toMatchObject({ type: "choose_defences", orbitalMines: 2, minefields: 0 });
    const ships = t.type === "choose_defences" ? t.ships : [];
    expect(ships.map((x) => x.squadron)).toEqual([undefined, ...Array<string>(6).fill("System ships"), "System ships 2"]);
    expect(new Set(ships.map((x) => x.name)).size).toBe(8);
    expect(prose(s, { id: "log-1", playerTurn: 0, phase: null, kind: "defences_chosen", actor: null, data: { player: "p1", shipIds: ["ship-9"], squadronIds: [], orbitalMines: 2, minefields: 0, points: 40, budget: 50 } })).toBe(
      "Ann buys 1 defence, 2 orbital mines (40 of 50 pts)",
    );
  });
});
