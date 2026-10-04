import { describe, expect, test } from "vitest";
import { actor } from "../src/state/derived";
import { createRng, nD6 } from "../src/state/rng";
import { newGame } from "../src/state/newGame";
import { cloneJson } from "../src/state/json";
import { reduce } from "../src/reducer/reduce";
import { LUNAR_VS_MURDER, freshGame } from "./helpers";
import { logOf, play } from "./reducer-helpers";

// Seed 1337 rolls 5, 4, 2, 3, 1, 5, 1, … (checked against an independent implementation in rng.test.ts).
describe("setup, seed 1337, start to finish", () => {
  test("every step, with the dice in the spec's draw order", () => {
    let s = freshGame();

    s = play(s, { type: "roll_leadership", player: "p1" });
    expect(s.ships.map((x) => x.leadership)).toEqual([8, 8]); // 5 → Ld 8, 4 → Ld 8
    expect(s.clock.setupStep).toBe("roll_zones");

    s = play(s, { type: "roll_zones", player: "p2" }); // either player may roll
    expect(s.setup).toMatchObject({ zoneRoll: 2, zones: { p1: "A", p2: "B" } });

    s = play(s, { type: "roll_deploy_order", player: "p1" });
    expect(s.setup.deployOrderRolls).toEqual([{ p1: 3, p2: 1 }]);
    expect(s.setup.firstDeployer).toBe("p2"); // the lower roll deploys first
    expect(s.clock.setupStep).toBe("deploy");
    expect(actor(s)).toBe("p2");

    s = play(s, { type: "deploy_ship", player: "p2", shipId: "ship-2", position: { x: 95, y: 15 } });
    expect(s.ships[1]).toMatchObject({ status: "active", position: { x: 95, y: 15 }, heading: 0 }); // zone B faces up
    expect(actor(s)).toBe("p1");

    s = play(s, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 90, y: 105 } });
    expect(s.ships[0]).toMatchObject({ status: "active", heading: 180 }); // zone A faces down
    expect(s.clock.setupStep).toBe("roll_first_turn");

    s = play(s, { type: "roll_first_turn", player: "p1" });
    expect(s.setup.firstTurnRolls).toEqual([{ p1: 5, p2: 1 }]);
    expect(actor(s)).toBe("p1"); // the higher roll chooses

    s = play(s, { type: "choose_first_turn", player: "p1", goFirst: false });
    expect(s.setup.firstPlayer).toBe("p2");
    // Battle: player turn 1 is p2's; no hulks, so straight to moving ships.
    expect(s.clock).toEqual({ stage: "battle", setupStep: null, playerTurn: 1, phase: "movement", step: "move_ships" });
    expect(actor(s)).toBe("p2");
    expect(s.rng.draws).toBe(7);

    expect(logOf(s, "leadership_roll").map((e) => e.data)).toEqual([
      { shipId: "ship-1", rolls: [5], leadership: 8 },
      { shipId: "ship-2", rolls: [4], leadership: 8 },
    ]);
    expect(logOf(s, "turn_start").map((e) => e.data)).toEqual([{ round: 1, player: "p2" }]);
    expect(s.log.every((e, i) => e.id === s.log[i]!.id && /^log-\d+$/.test(e.id))).toBe(true);
  });

  test("ties re-roll: the step stays open", () => {
    // Find a seed whose deploy-order dice (draws 4 and 5) tie.
    let seed = 1;
    for (; ; seed++) {
      const v = nD6(createRng(seed), 5).values;
      if (v[3] === v[4]) break;
    }
    let s = newGame({ ...cloneJson(LUNAR_VS_MURDER), seed });
    s = play(s, { type: "roll_leadership", player: "p1" });
    s = play(s, { type: "roll_zones", player: "p1" });
    s = play(s, { type: "roll_deploy_order", player: "p1" });
    expect(s.setup.firstDeployer).toBeNull();
    expect(s.clock.setupStep).toBe("roll_deploy_order");
    expect(logOf(s, "deploy_order_roll").at(-1)?.data).toMatchObject({ winner: null });
  });

  test("deterministic: the same transforms give byte-identical states", () => {
    const run = () => {
      let s = freshGame();
      for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) s = reduce(s, { type, player: "p1" });
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
