import { describe, expect, test } from "vitest";
import { newGame } from "@bfg/engine";
import { cruiserClash, type NewGameOptions } from "../src/game/config";
import { gravityTurnFrom, stats } from "../src/plot/plot";

const options: NewGameOptions = {
  p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"] },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  planet: "small",
  seed: 7,
};

describe("a planet from the form", () => {
  test("the config carries it to the table centre", () => {
    expect(newGame(cruiserClash(options, new Date(0))).table.features).toMatchObject([{ kind: "planet", size: "small", position: { x: 90, y: 60 } }]);
  });

  test("the plotter offers the gravity well's turn toward the planet, and drops the minimum move", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const ship = { ...s.ships[0]!, position: { x: 100, y: 50 }, heading: 90, status: "active" as const, leadership: 8 };
    // The planet bears 315 from (100, 50): 135° to port of a ship heading 90, so the full 45° to port.
    expect(gravityTurnFrom(s, { position: ship.position, heading: 90 })).toEqual({ kind: "gravity_turn", degrees: -45 });
    // Already facing it: nothing to turn.
    expect(gravityTurnFrom(s, { position: ship.position, heading: 315 })).toBeNull();
    // Outside the well (17.5 cm from the centre): nothing.
    expect(gravityTurnFrom(s, { position: { x: 120, y: 60 }, heading: 0 })).toBeNull();
    s.ships[0] = ship;
    expect(stats(s, ship, []).min).toBe(0);
  });
});
