import { describe, expect, test } from "vitest";
import { newGame, type Transform } from "@bfg/engine";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash, defaultNames, type NewGameOptions } from "../src/game/config";
import { pick } from "../src/game/pick";
import { movableShips, plottingShip } from "../src/plot/usePlot";

const when = new Date("2026-10-05T12:00:00Z");
const options = (p1: NewGameOptions["p1"], p2: NewGameOptions["p2"]): NewGameOptions => ({ p1, p2, ramming: false, boarding: false, seed: 7 });

describe("cruiserClash config", () => {
  test("a fleet per side, in config order, with the ramming option", () => {
    const c = cruiserClash(options({ name: "A", fleet: "imperial_navy", ships: ["Agrippa", "Hammer of Terra"] }, { name: "B", fleet: "chaos", ships: ["Unclean", "Woe Eternal"] }), when);
    expect(c.options).toEqual({ ramming: false, boarding: false, carriers: false });
    expect(c.ships.map((s) => [s.owner, s.classId])).toEqual([["p1", "lunar"], ["p1", "lunar"], ["p2", "murder"], ["p2", "murder"]]);
    expect(newGame(c).ships).toHaveLength(4);
  });

  test("mirror matches are legal games", () => {
    const c = cruiserClash(options({ name: "A", fleet: "chaos", ships: defaultNames("chaos", 3) }, { name: "B", fleet: "chaos", ships: defaultNames("chaos", 3, true) }), when);
    const s = newGame(c);
    expect(s.players.p1.faction).toBe("chaos");
    expect(s.players.p2.faction).toBe("chaos");
    expect(new Set(s.ships.map((x) => x.name)).size).toBe(6);
  });

  test("carriers: with the option, a side that brings one fields it first; without it, the carrier flag is ignored", () => {
    const sides = (): [NewGameOptions["p1"], NewGameOptions["p2"]] => [
      { name: "A", fleet: "imperial_navy", ships: ["Fortitude", "Agrippa"], carrier: true },
      { name: "B", fleet: "chaos", ships: ["Deathbane", "Unclean"], carrier: false },
    ];
    const on = cruiserClash({ ...options(...sides()), carriers: true }, when);
    expect(on.options?.carriers).toBe(true);
    expect(on.ships.map((s) => s.classId)).toEqual(["dictator", "lunar", "murder", "murder"]);
    expect(newGame(on).ships[0]!.loaded.launchBays).toBe(true);
    const off = cruiserClash(options(...sides()), when);
    expect(off.ships.map((s) => s.classId)).toEqual(["lunar", "lunar", "murder", "murder"]);
  });

  test("default names never repeat across a 4-a-side mirror match", () => {
    const names = [...defaultNames("imperial_navy", 4), ...defaultNames("imperial_navy", 4, true)];
    expect(new Set(names).size).toBe(8);
  });
});

describe("picking the next ship", () => {
  test("pick: the focused candidate, else the first", () => {
    const ships = [{ id: "a" }, { id: "b" }];
    expect(pick(ships, "b")?.id).toBe("b");
    expect(pick(ships, "gone")?.id).toBe("a");
    expect(pick(ships, null)?.id).toBe("a");
    expect(pick([], "a")).toBeUndefined();
  });

  const play = (h: History, t: Transform): History => {
    const r = apply(h, t);
    if (!r.ok) throw new Error(r.reason.message);
    return r.history;
  };

  /** Two Lunars against two Murders, deployed, with p1 to move first. */
  function battle(): History {
    let h = start(cruiserClash(options({ name: "A", fleet: "imperial_navy", ships: ["L1", "L2"] }, { name: "B", fleet: "chaos", ships: ["M1", "M2"] }), when));
    for (const step of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) {
      while (current(h).clock.setupStep === step) h = play(h, { type: step, player: "p1" });
    }
    for (let i = 0; current(h).clock.setupStep === "deploy"; i++) {
      const s = current(h);
      const tries = s.ships.map((x): Transform => ({ type: "deploy_ship", player: x.owner, shipId: x.id, position: { x: 60 + i * 10, y: s.setup.zones?.[x.owner] === "A" ? 105 : 15 } }));
      const t = tries.find((x) => apply(h, x).ok);
      if (t === undefined) throw new Error("nobody can deploy");
      h = play(h, t);
    }
    while (current(h).clock.setupStep === "roll_first_turn") h = play(h, { type: "roll_first_turn", player: "p1" });
    const chooser = current(h).setup.firstTurnChooser;
    if (chooser === null) throw new Error("no chooser");
    return play(h, { type: "choose_first_turn", player: chooser, goFirst: chooser === "p1" });
  }

  test("any unmoved ship can be plotted; declaring an order pins the choice", () => {
    const h = battle();
    const s = current(h);
    expect(movableShips(s).map((x) => x.name)).toEqual(["L1", "L2"]);
    expect(plottingShip(s)?.name).toBe("L1");
    expect(plottingShip(s, "ship-2")?.name).toBe("L2");
    expect(plottingShip(s, "ship-3")?.name).toBe("L1"); // an enemy: not a candidate

    // Pass or fail, declaring opens the ship's activation: it moves before anyone else.
    const ordered = current(play(h, { type: "declare_order", player: "p1", shipId: "ship-2", order: "lock_on" }));
    expect(movableShips(ordered)).toEqual([]);
    expect(plottingShip(ordered, "ship-1")?.name).toBe("L2");
  });
});
