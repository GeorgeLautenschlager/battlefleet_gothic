import { describe, expect, test } from "vitest";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import { append, judge, propose, stats } from "../src/plot/plot";
import type { GameState, PathStep, Transform } from "@bfg/engine";

const config = cruiserClash({ p1Name: "A", p2Name: "B", p1Ship: "Agrippa", p2Ship: "Unclean", seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
const play = (h: History, t: Transform): History => {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
};

/** Round 1: Unclean (p2, Murder, speed 25, cruiser) at (95, 15) heading 0, to move. */
function battle(): GameState {
  let h = start(config);
  for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) h = play(h, { type, player: "p1" });
  h = play(h, { type: "deploy_ship", player: "p2", shipId: "ship-2", position: { x: 95, y: 15 } });
  h = play(h, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 90, y: 105 } });
  h = play(h, { type: "roll_first_turn", player: "p1" });
  return current(play(h, { type: "choose_first_turn", player: "p1", goFirst: false }));
}
const unclean = (s: GameState) => s.ships.find((x) => x.id === "ship-2")!;
const move = (path: PathStep[]): Transform => ({ type: "move", player: "p2", shipId: "ship-2", path, disengage: false });

describe("propose", () => {
  const s = battle();
  test("dead ahead (or nearly) is straight", () => {
    expect(propose(unclean(s), [], { x: 95, y: 27 }, 45)).toEqual([{ kind: "advance", distance: 12 }]);
    expect(propose(unclean(s), [], { x: 95.2, y: 27 }, 45)).toEqual([{ kind: "advance", distance: 12 }]);
  });
  test("off the bow: turn toward the pointer, then go there", () => {
    expect(propose(unclean(s), [], { x: 105, y: 25 }, 45)).toEqual([
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 14.1 },
    ]);
  });
  test("beyond the turn limit: turn the limit, advance by the projection", () => {
    const steps = propose(unclean(s), [], { x: 85, y: 15 }, 45); // dead abeam to port
    expect(steps[0]).toEqual({ kind: "turn", degrees: -45 });
    expect(steps[1]).toEqual({ kind: "advance", distance: 7.1 });
  });
  test("straight-only and no-turn ships project onto the bow", () => {
    expect(propose(unclean(s), [], { x: 105, y: 25 }, 45, true)).toEqual([{ kind: "advance", distance: 10 }]);
    expect(propose(unclean(s), [], { x: 105, y: 25 }, 0)).toEqual([{ kind: "advance", distance: 10 }]);
    expect(propose(unclean(s), [], { x: 95, y: 5 }, 0)).toEqual([]); // behind: nothing
  });
  test("from the end of the path so far", () => {
    expect(propose(unclean(s), [{ kind: "advance", distance: 10 }], { x: 95, y: 30 }, 45)).toEqual([{ kind: "advance", distance: 5 }]);
  });
});

describe("append", () => {
  test("merges advances and turns", () => {
    const a = append([{ kind: "advance", distance: 10 }], [{ kind: "advance", distance: 2.5 }]);
    expect(a).toEqual([{ kind: "advance", distance: 12.5 }]);
    expect(append([{ kind: "turn", degrees: 30 }], [{ kind: "turn", degrees: -30 }])).toEqual([]);
  });
});

describe("judge and stats", () => {
  const s = battle();
  test("ok, short (too little so far) and illegal", () => {
    expect(judge(s, move([{ kind: "advance", distance: 20 }]))).toEqual({ kind: "ok" });
    expect(judge(s, move([{ kind: "advance", distance: 5 }])).kind).toBe("short");
    expect(judge(s, move([{ kind: "advance", distance: 5 }, { kind: "turn", degrees: 45 }])).kind).toBe("illegal"); // turn too early
    expect(judge(s, move([{ kind: "advance", distance: 30 }])).kind).toBe("illegal");
  });
  test("tracks distance, turns and when the next turn is allowed", () => {
    const st = stats(s, unclean(s), [{ kind: "advance", distance: 12 }, { kind: "turn", degrees: 20 }, { kind: "advance", distance: 4 }]);
    expect(st).toMatchObject({ total: 16, min: 12.5, max: 25, turnsUsed: 1, turnsAllowed: 1, turnDistance: 10, sinceTurn: 4, canTurnHere: false });
    expect(stats(s, unclean(s), [{ kind: "advance", distance: 10 }]).canTurnHere).toBe(true);
  });
});
