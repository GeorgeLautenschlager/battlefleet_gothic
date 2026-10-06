/** Battleships in the fleet forms (transforms v0.13 T71–T74, state N33). */
import { describe, expect, test } from "vitest";
import { classChoices, optionIds, shipEntries, withOption, type Side } from "../src/game/config";

describe("battleships in the fleet forms", () => {
  test("points battles offer them; Cruiser Clash doesn't", () => {
    expect(classChoices("imperial_navy", false, true)).toEqual(expect.arrayContaining(["emperor", "retribution"]));
    expect(classChoices("chaos", false, true)).toEqual(expect.arrayContaining(["chaos_battle_barge", "despoiler", "desolator"]));
    expect(classChoices("chaos", false)).not.toContain("desolator");
  });

  test("grouped options exclude each other", () => {
    expect(withOption("chaos_battle_barge", ["batteries_45", "prow_torpedoes"], "batteries_30", true)).toEqual(["prow_torpedoes", "batteries_30"]);
    expect(withOption("chaos_battle_barge", ["batteries_45"], "dorsal_lances_45", true)).toEqual(["batteries_45", "dorsal_lances_45"]);
    expect(withOption("chaos_battle_barge", ["batteries_45"], "batteries_45", false)).toEqual([]);
    // A side that somehow holds both keeps the first.
    const side: Side = { name: "Bo", fleet: "chaos", ships: ["C"], classes: ["chaos_battle_barge"], options: [["batteries_30", "batteries_45"]] };
    expect(optionIds(side, false, true)).toEqual([["batteries_30"]]);
    expect(shipEntries(side, false, true)).toEqual([{ name: "C", classId: "chaos_battle_barge", options: ["batteries_30"] }]);
  });
});

describe("escorts and squadrons in the fleet forms (T76)", () => {
  test("escorts in points battles only; an unnamed escort joins the default squadron", () => {
    expect(classChoices("chaos", false)).not.toContain("iconoclast");
    expect(classChoices("chaos", false, true)).toEqual(expect.arrayContaining(["idolator", "infidel", "iconoclast"]));
    const side: Side = { name: "Bo", fleet: "chaos", ships: ["A", "B", "C"], classes: ["iconoclast", "iconoclast", "murder"], squadrons: ["", " Raiders ", ""] };
    expect(shipEntries(side, false, true)).toEqual([
      { name: "A", classId: "iconoclast", squadron: "Escorts" },
      { name: "B", classId: "iconoclast", squadron: "Raiders" },
      { name: "C", classId: "murder" },
    ]);
    expect(shipEntries(side, false, false).every((e) => e.squadron === undefined)).toBe(true); // Cruiser Clash: no squadrons
  });
});
