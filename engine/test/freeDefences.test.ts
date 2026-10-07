/**
 * Surprise Attack's free planetary defences (p. 132): state v0.24 N123–N128; transforms v0.22
 * T157–T162; validator v0.19 V45–V47; reducer v0.19 R75–R77.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor } from "../src/state/derived";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 defends with a Lunar, a Gothic and two Swords (430 pts: one die); p2 attacks with a Murder and two Iconoclasts. */
const SURPRISE: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "surprise_attack",
  forces: { kind: "points", limit: 750 },
  attacker: "p2",
  options: { freeDefences: true },
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    { owner: "p1", name: "Invincible", classId: "gothic" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p1", name: `Blade ${i}`, classId: "sword", squadron: "Blades" })),
    { owner: "p2", name: "Unclean", classId: "murder" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p2", name: `Knife ${i}`, classId: "iconoclast", squadron: "Knives" })),
  ],
};

const reason = (s: GameState, t: unknown) => {
  const v = validate(s, t);
  return v.ok ? "ok" : v.reason.code;
};
const buy = (ships: { classId: string; name: string; squadron?: string }[], orbitalMines = 0, minefields = 0): Transform => ({ type: "choose_defences", player: "p1", ships, orbitalMines, minefields });

/** Leadership 8, one unit on alert (Agrippa), and a budget of D6 = 5: 50 pts. */
function atChoosing(budgetDie = 5): GameState {
  const s = playDice(newGame(cloneJson(SURPRISE)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 2, budgetDie]);
  return play(s, { type: "choose_alert", player: "p1", units: ["ship-1"] });
}

describe("the budget (state N123, reducer R75)", () => {
  test("a D6 per 500 points or part of the defender's fleet, × 10, rolled with Leadership", () => {
    const s0 = newGame(cloneJson(SURPRISE));
    expect(checkInvariants(s0)).toEqual([]);
    expect(s0.meta.options.freeDefences).toBe(true);
    expect(s0.setup.surpriseAttack).toEqual({ alertUnits: null, alertChosen: false, entryEdge: null, defenceBudget: null, defencesChosen: false });
    const s = atChoosing();
    expect(s.setup.surpriseAttack?.defenceBudget).toBe(50);
    expect(logOf(s, "defence_budget_roll").at(-1)?.data).toEqual({ player: "p1", fleetPoints: 430, rolls: [5], points: 50 });
    expect(s.clock.setupStep).toBe("choose_defences");
    expect(actor(s)).toBe("p1");
  });

  test("mines bought with the fleet count toward it: 530 pts is two dice", () => {
    const s = playDice(newGame({ ...cloneJson(SURPRISE), orbitalMines: 20 }), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 2, 3, 6]);
    expect(logOf(s, "defence_budget_roll").at(-1)?.data).toEqual({ player: "p1", fleetPoints: 530, rolls: [3, 6], points: 90 });
  });

  test("only with the option, and only in Surprise Attack; older configs play as before", () => {
    const old = cloneJson(SURPRISE);
    delete old.options;
    const s = playDice(newGame(old), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 2]);
    expect(s.setup.surpriseAttack).toEqual({ alertUnits: 1, alertChosen: false, entryEdge: null });
    expect(play(s, { type: "choose_alert", player: "p1", units: ["ship-1"] }).clock.setupStep).toBe("deploy");
    expect(() => newGame({ ...cloneJson(LUNAR_VS_MURDER), options: { freeDefences: true } })).toThrow(/free defences come with Surprise Attack/);
  });
});

describe("buying them (T157–T160, V45–V47)", () => {
  test("what may be bought", () => {
    const s = atChoosing(); // 50 pts
    expect(reason(s, buy([{ classId: "lunar", name: "Spare" }]))).toBe("NOT_A_DEFENCE");
    expect(reason(s, buy([{ classId: "laser_platform", name: "Agrippa" }]))).toBe("INVALID_NAME");
    expect(reason(s, buy([{ classId: "laser_platform", name: "  " }]))).toBe("INVALID_NAME");
    expect(reason(s, buy([{ classId: "laser_platform", name: "Lumen" }], 5))).toBe("OVER_BUDGET"); // 30 + 25
    // Two minefields bought with the fleet (510 pts, two dice): a third is too many, however rich the budget (N125).
    const fields = playDice(newGame({ ...cloneJson(SURPRISE), minefields: 2 }), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 2, 6, 6]);
    expect(reason(play(fields, { type: "choose_alert", player: "p1", units: ["ship-1"] }), buy([], 0, 1))).toBe("TOO_MANY");
    expect(reason(s, buy([{ classId: "system_ship", name: "Picket" }]))).toBe("INVALID_SQUADRON");
    expect(reason(s, buy([{ classId: "laser_platform", name: "Lumen", squadron: "Lights" }]))).toBe("INVALID_SQUADRON");
    expect(reason(s, buy([{ classId: "system_ship", name: "Picket", squadron: "Blades" }]))).toBe("INVALID_SQUADRON"); // taken
    expect(reason(s, buy([]))).toBe("ok"); // declining is fine (V46)
    expect(reason(s, { ...buy([]), player: "p2" })).toBe("NOT_YOUR_TURN");
  });

  test("ships join the fleet as defences, in a new squadron; mines go to placement", () => {
    let s = atChoosing(); // 50 pts
    s = play(s, buy([{ classId: "system_ship", name: "Picket 1", squadron: "Pickets" }, { classId: "system_ship", name: "Picket 2", squadron: "Pickets" }], 2));
    const bought = s.ships.filter((x) => x.name.startsWith("Picket"));
    expect(bought.map((x) => [x.status, x.leadership, x.profile.classId])).toEqual([
      ["undeployed", 7, "system_ship"],
      ["undeployed", 7, "system_ship"],
    ]);
    expect(s.squadrons?.find((sq) => sq.name === "Pickets")).toMatchObject({ owner: "p1", type: "escort", shipIds: bought.map((x) => x.id) });
    expect(s.setup.emplacements).toEqual({ owner: "p1", orbitalMines: 2, minefields: 0, unplaced: { orbitalMines: 2, minefields: [] } });
    expect(logOf(s, "defences_chosen").at(-1)?.data).toMatchObject({ player: "p1", orbitalMines: 2, minefields: 0, points: 50, budget: 50 });
    expect(s.clock.setupStep).toBe("place_defences");
    expect(s.setup.surpriseAttack?.defencesChosen).toBe(true);
  });

  test("nothing bought: straight on to deployment", () => {
    const s = play(atChoosing(), buy([]));
    expect(s.clock.setupStep).toBe("deploy");
  });
});

describe("full games of Surprise Attack with free defences", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(SURPRISE), seed });
    for (let n = 0; s.clock.stage !== "ended"; n++) {
      if (n > 8000) throw new Error(`seed ${seed}: no end in sight at ${JSON.stringify(s.clock)}`);
      const t = candidates(s, n).find((c) => validate(s, c).ok);
      if (t === undefined) {
        const why = [...new Set(candidates(s, n).map((c) => reason(s, c)))];
        throw new Error(`seed ${seed}: stuck at ${JSON.stringify(s.clock)}: ${why.join(", ")}`);
      }
      s = play(s, t);
    }
    return s;
  };
  test.each([1, 2, 3, 4])("seed %i plays to a result", (seed) => {
    const s = playOut(seed);
    expect(s.result).not.toBeNull();
    expect(logOf(s, "defences_chosen")).toHaveLength(1);
  }, 120_000);
});
