import { describe, expect, test } from "vitest";
import { newGame } from "@bfg/engine";
import { commanders, cruiserClash, shipEntries, type NewGameOptions, type Side } from "../src/game/config";
import { describe as prose } from "../src/log/format";

const chaos: Side = {
  name: "Bo",
  fleet: "chaos",
  ships: ["Unclean", "Horrific", "Woe"],
  classes: ["murder", "styx", "carnage"],
  command: { fleet: { kind: "warmaster", leadership: 9, marks: ["khorne"] }, flagship: 0, lords: [{ ship: 1, mark: "tzeentch" }, { ship: 2, mark: null }] },
};

describe("commanders from the form (T60)", () => {
  test("the Warmaster takes the most expensive ship; a Lord on his ship is dropped", () => {
    expect(commanders(chaos, false, true)).toEqual([undefined, { kind: "warmaster", leadership: 9, marks: ["khorne"] }, { kind: "lord", mark: null }]);
  });

  test("entries carry commanders only with fleet lists", () => {
    expect(shipEntries(chaos, false, true).some((e) => e.commander !== undefined)).toBe(false);
    expect(shipEntries(chaos, false, true, true)[1]).toEqual({ name: "Horrific", classId: "styx", commander: { kind: "warmaster", leadership: 9, marks: ["khorne"] } });
  });

  test("a game with fleet lists: commanders aboard, the option set", () => {
    const options: NewGameOptions = {
      p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"], command: { fleet: null, flagship: 0, lords: [] } },
      p2: chaos,
      ramming: true,
      boarding: true,
      fleetLists: true,
      forces: { kind: "points", limit: 1000 },
      scoring: "victory_points",
      seed: 3,
    };
    const s = newGame(cruiserClash(options, new Date(0)));
    expect(s.meta.options.fleetLists).toBe(true);
    expect(s.ships.find((x) => x.name === "Horrific")?.commander).toMatchObject({ kind: "warmaster", rerolls: 1 });
  });
});

describe("log prose", () => {
  test("re-rolls read as sentences", () => {
    const s = newGame(
      cruiserClash(
        { p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"] }, p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] }, ramming: true, boarding: true, seed: 3 },
        new Date(0),
      ),
    );
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("reroll", { shipId: "ship-1", commanderShipId: "ship-1", test: "command_check", rolls: [2, 3], passed: true }))).toBe(
      "Agrippa re-rolls its command check with Agrippa's fleet commander [2 3]: passed",
    );
    expect(prose(s, entry("rerolls_lost", { shipId: "ship-2", reason: "bridge_smashed" }))).toBe("Unclean's bridge is smashed: its commander's re-rolls are lost");
  });
});
