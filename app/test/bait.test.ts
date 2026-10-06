import { describe, expect, test } from "vitest";
import { newGame, type GameState } from "@bfg/engine";
import { cruiserClash, sideProblem, type NewGameOptions } from "../src/game/config";
import { arrivalAt, reserveUnits } from "../src/reserves/arrival";
import { describe as prose } from "../src/log/format";

/** Ann is pursued: Agrippa is the bait, Invincible and two Swords reinforcements. Bo pursues. */
const options: NewGameOptions = {
  p1: {
    name: "Ann",
    fleet: "imperial_navy",
    ships: ["Agrippa", "Invincible", "Blue 1", "Blue 2"],
    classes: ["lunar", "gothic", "sword", "sword"],
    squadrons: ["", "", "Blue", "Blue"],
    reserves: [false, true, true, true],
  },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"], reserves: [true] },
  ramming: true,
  boarding: true,
  scenario: "the_bait",
  forces: { kind: "points", limit: 500 },
  scoring: "victory_points",
  attacker: "p2",
  seed: 7,
};

describe("The Bait from the form", () => {
  test("the config names the pursuers, and only the pursued side's reinforcements wait in reserve", () => {
    const config = cruiserClash(options, new Date(0));
    expect(config.attacker).toBe("p2");
    expect(config.ships.map((s) => s.reserve === true)).toEqual([false, true, true, true, false]);
    const s = newGame(config);
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "reserve", "reserve", "reserve", "undeployed"]);
  });

  test("each side is checked in its own role", () => {
    expect(sideProblem(options.p1, false, options.forces, false, "pursued")).toBeNull();
    // As the pursuers the reinforcement ticks don't apply: all 430 points count against the 500 limit.
    expect(sideProblem(options.p1, false, options.forces, false, "pursuers")).toBeNull();
    expect(sideProblem({ ...options.p1, classes: ["lunar", "gothic", "sword", "dictator"], squadrons: [] }, false, options.forces, false, "pursuers")).toMatch(/over the 500 pt limit/);
    const lone = { ...options.p1, reserves: [false, false, false, false] };
    expect(sideProblem(lone, false, options.forces, false, "pursued")).toMatch(/one ship or one squadron/);
  });

  test("a click near the entry edge brings a squadron on along it, spread out, facing in", () => {
    const s = atBattle();
    expect(reserveUnits(s, "p1").map((u) => u.map((x) => x.name))).toEqual([["Invincible"], ["Blue 1", "Blue 2"]]);
    const swords = reserveUnits(s, "p1")[1]!;
    const t = arrivalAt(s, "p1", swords, { x: 170, y: 60 })!;
    expect(t.placements).toEqual([
      { shipId: "ship-3", position: { x: 180, y: 60 }, heading: 270 },
      { shipId: "ship-4", position: { x: 180, y: 66 }, heading: 270 },
    ]);
    expect(arrivalAt(s, "p1", swords, { x: 170, y: 60 }, 30)?.placements[0]?.heading).toBe(300);
  });

  test("arrivals read as sentences", () => {
    const s = atBattle();
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("arrive", { player: "p1", ships: [{ shipId: "ship-2" }] }))).toBe("Invincible arrives from the table edge");
    expect(prose(s, entry("arrive", { player: "p1", ships: [{ shipId: "ship-3" }, { shipId: "ship-4" }] }))).toBe("Blue arrive from the table edge");
    expect(prose(s, entry("reserves_disengaged", { player: "p1", shipIds: ["ship-2", "ship-3", "ship-4"] }))).toBe(
      "Ann has nothing left on the table: 3 reinforcements never arrive and count as disengaged",
    );
  });
});

/** Into the first Movement Phase, by hand: the bait at the centre, Bo's Murder in the west strip. */
function atBattle(): GameState {
  const s = newGame(cruiserClash(options, new Date(0)));
  s.ships[0]!.position = { x: 90, y: 60 };
  s.ships[0]!.heading = 90;
  s.ships[0]!.status = "active";
  s.ships[4]!.position = { x: 15, y: 60 };
  s.ships[4]!.heading = 90;
  s.ships[4]!.status = "active";
  for (const ship of s.ships) ship.leadership = 8;
  s.clock = { stage: "battle", setupStep: null, playerTurn: 1, phase: "movement", step: "move_ships" };
  s.turnState.playerTurn = 1;
  return s;
}
