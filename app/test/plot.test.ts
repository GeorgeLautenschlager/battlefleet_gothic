import { describe, expect, test } from "vitest";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import { append, judge, propose, stats, typedStep } from "../src/plot/plot";
import { cloneJson, type GameState, type PathStep, type Transform } from "@bfg/engine";

const config = cruiserClash({ p1: { name: "A", fleet: "imperial_navy", ships: ["Agrippa"] }, p2: { name: "B", fleet: "chaos", ships: ["Unclean"] }, ramming: true, boarding: false, seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
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
  const u = unclean(s);
  test("dead ahead (or nearly) is straight", () => {
    expect(propose(s, u, [], { x: 95, y: 27 })).toEqual([{ kind: "advance", distance: 12 }]);
    expect(propose(s, u, [], { x: 95.2, y: 27 })).toEqual([{ kind: "advance", distance: 12 }]);
  });
  test("off the bow before a turn is allowed: exactly to the turn point, then turn toward the pointer", () => {
    expect(propose(s, u, [], { x: 105, y: 35 })).toEqual([
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 14.1 },
    ]);
    // From part-way there, only the rest of the 10 cm.
    expect(propose(s, u, [{ kind: "advance", distance: 3.7 }], { x: 105, y: 28.7 })[0]).toEqual({ kind: "advance", distance: 6.3 });
  });
  test("a pointer short of the turn point just goes straight", () => {
    expect(propose(s, u, [], { x: 100, y: 21 })).toEqual([{ kind: "advance", distance: 6 }]);
  });
  test("where a turn is allowed: turn toward the pointer (up to the limit), then go there", () => {
    const at10: PathStep[] = [{ kind: "advance", distance: 10 }];
    expect(propose(s, u, at10, { x: 105, y: 35 })).toEqual([
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 14.1 },
    ]);
    const steps = propose(s, u, at10, { x: 85, y: 25 }); // dead abeam to port
    expect(steps[0]).toEqual({ kind: "turn", degrees: -45 });
    expect(steps[1]).toEqual({ kind: "advance", distance: 7.1 });
  });
  test("straight-only and no turns left project onto the bow", () => {
    expect(propose(s, u, [], { x: 105, y: 25 }, true)).toEqual([{ kind: "advance", distance: 10 }]);
    const used: PathStep[] = [{ kind: "advance", distance: 10 }, { kind: "turn", degrees: 10 }];
    expect(propose(s, u, used, { x: 95, y: 5 })).toEqual([]); // behind: nothing
  });
  test("Come To New Heading: two clicks, two exact 10 cm legs before each turn", () => {
    const ordered = cloneJson(s);
    ordered.activation = {
      kind: "move", shipId: "ship-2", stage: "ordered", order: "come_to_new_heading", aafExtra: null, ram: null,
      maxDistance: 25, minDistance: 12.5, start: { position: { x: 95, y: 15 }, heading: 0 }, distanceMoved: 0,
      distanceSinceTurn: 0, turnsMade: 0, truncated: false, remainingPath: [], slowedByBlastMarkers: false,
      zeroShieldBMTestDone: false, disengage: false, boardTargetId: null,
    };
    const ship = unclean(ordered);
    // First click: just past the first turn point and off to starboard (a short leg after the turn).
    const first = append([], propose(ordered, ship, [], { x: 100, y: 28 }));
    expect(first).toEqual([{ kind: "advance", distance: 10 }, { kind: "turn", degrees: 45 }, { kind: "advance", distance: 5.7 }]);
    // Second click, well off the new bow: the leg is topped up to exactly 10 cm, then the second turn.
    const second = append(first, propose(ordered, ship, first, { x: 106, y: 32 }));
    expect(second.slice(0, 4)).toEqual([
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 45 },
      { kind: "advance", distance: 10 },
      { kind: "turn", degrees: 45 },
    ]);
    expect(judge(ordered, { type: "move", player: "p2", shipId: "ship-2", path: second, disengage: false })).toEqual({ kind: "ok" });
  });
});

describe("typed steps", () => {
  test("advance and turns, rounded to 0.1; nonsense refused", () => {
    expect(typedStep("advance", 12.5)).toEqual({ kind: "advance", distance: 12.5 });
    expect(typedStep("port", 30)).toEqual({ kind: "turn", degrees: -30 });
    expect(typedStep("starboard", 22.47)).toEqual({ kind: "turn", degrees: 22.5 });
    expect(typedStep("advance", 0)).toBeNull();
    expect(typedStep("advance", Number.NaN)).toBeNull();
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
