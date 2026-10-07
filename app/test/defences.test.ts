import { describe, expect, test } from "vitest";
import { newGame } from "@bfg/engine";
import { cruiserClash, sideProblem, squadronNames, type NewGameOptions, type Side } from "../src/game/config";
import { describe as prose } from "../src/log/format";

/** Ann holds a medium planet with a Lunar, a laser platform and a space station; Bo brings a Murder. */
const ann: Side = { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Lumen", "Bastion"], classes: ["lunar", "laser_platform", "space_station"] };
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

describe("planetary defences from the form", () => {
  test("the planet holder defaults to Player 1, whose defences go in with Ld 7", () => {
    const config = cruiserClash(options, new Date(0));
    expect(config.planetHolder).toBe("p1");
    const s = newGame(config);
    expect(s.ships.map((x) => [x.profile.type, x.leadership])).toEqual([["cruiser", null], ["defence", 7], ["defence", 7], ["cruiser", null]]);
    expect(() => newGame(cruiserClash({ ...options, planetHolder: "p2" }, new Date(0)))).toThrow(/only the planet holder/);
  });

  test("each side is checked against a mirror without defences, with or without the planet", () => {
    expect(sideProblem(ann, false, options.forces, false, undefined, "medium", true)).toBeNull();
    expect(sideProblem(ann, false, options.forces, false, undefined, "medium", false)).toMatch(/only the planet holder/);
    expect(sideProblem(ann, false, options.forces)).toMatch(/need a planet on the table/);
  });

  test("system defence ships squadron apart from the fleet's escorts", () => {
    const side: Side = { name: "Ann", fleet: "imperial_navy", ships: ["A", "B"], classes: ["system_ship", "sword"] };
    expect(squadronNames(side, false, true)).toEqual(["System ships", "Escorts"]);
  });

  test("orbit falls and Blast Markers shed read as sentences", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("orbit_fall", { shipId: "ship-3", rolls: [3], distance: 3, position: { x: 1, y: 1 } }))).toBe("Bastion loses orbit: it falls 3 cm toward the planet [3]");
    expect(prose(s, entry("orbit_fall", { shipId: "ship-3", rolls: [5], distance: 2, position: null, destroyed: true }))).toBe("Bastion loses its orbit [5] and falls into the planet");
    expect(prose(s, entry("defence_blast_markers", { shipId: "ship-3", rolls: [2], removed: ["bm-1", "bm-2"] }))).toBe("Bastion clears 2 Blast Markers [2]");
  });
});
