import { describe, expect, test } from "vitest";
import { cloneJson, type GameState } from "@bfg/engine";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import { bearingToward, clampToArcs, describeBearing, fireOptions, inArcs, targets } from "../src/fire/fire";
import type { Transform } from "@bfg/engine";

const config = cruiserClash({ p1Name: "A", p2Name: "B", p1Ship: "Agrippa", p2Ship: "Unclean", seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
const play = (h: History, t: Transform): History => {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
};

/** Round 1, p2's direct fire step, with ships placed by hand. */
function shooting(unclean: { x: number; y: number; h: number }, agrippa: { x: number; y: number; h: number }): GameState {
  let h = start(config);
  for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) h = play(h, { type, player: "p1" });
  h = play(h, { type: "deploy_ship", player: "p2", shipId: "ship-2", position: { x: 95, y: 15 } });
  h = play(h, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 90, y: 105 } });
  h = play(h, { type: "roll_first_turn", player: "p1" });
  h = play(h, { type: "choose_first_turn", player: "p1", goFirst: false });
  h = play(h, { type: "move", player: "p2", shipId: "ship-2", path: [{ kind: "advance", distance: 20 }], disengage: false });
  const s = cloneJson(current(h));
  const [a, u] = [s.ships[0]!, s.ships[1]!];
  u.position = { x: unclean.x, y: unclean.y };
  u.heading = unclean.h;
  a.position = { x: agrippa.x, y: agrippa.y };
  a.heading = agrippa.h;
  expect(s.clock.step).toBe("direct_fire");
  return s;
}
const fire = (weaponId: string): Extract<Transform, { type: "fire" }> => ({ type: "fire", player: "p2", shipId: "ship-2", weaponId, target: { kind: "ship", id: "ship-1" } });

describe("fireOptions", () => {
  test("a plain shot is one option", () => {
    const s = shooting({ x: 100, y: 50, h: 0 }, { x: 80, y: 50, h: 0 }); // Agrippa dead abeam to port
    expect(fireOptions(s, fire("port_battery"))).toEqual([{ transform: fire("port_battery"), label: "Fire" }]);
  });
  test("out of arc gives the engine's reason", () => {
    const s = shooting({ x: 100, y: 50, h: 0 }, { x: 80, y: 50, h: 0 });
    expect(fireOptions(s, fire("starboard_battery"))).toEqual({ reason: expect.stringContaining("outside") });
  });
  test("a target on the prow/port boundary: each single-arc weapon just fires (no Phase 1 weapon spans two arcs)", () => {
    // Agrippa exactly 45° off Unclean's bow to port; Agrippa broadside on, so its aspect is clear.
    const s = shooting({ x: 100, y: 50, h: 0 }, { x: 80, y: 70, h: 45 });
    const options = fireOptions(s, fire("prow_lances"));
    expect(Array.isArray(options) ? options.map((o) => o.label) : options).toEqual(["Fire"]); // prow lances only cover the prow
    const both = targets(s, s.ships[1]!, s.ships[1]!.profile.weapons.find((w) => w.id === "port_battery")!);
    expect(both[0]!.options.map((o) => o.label)).toEqual(["Fire"]);
  });
  test("an aspect on Agrippa's quadrant boundary asks which side to hit", () => {
    // Unclean exactly 45° off Agrippa's bow: Agrippa's front/right boundary faces it.
    const s = shooting({ x: 100, y: 50, h: 270 }, { x: 80, y: 30, h: 0 });
    const options = fireOptions(s, fire("prow_lances"));
    expect(Array.isArray(options) && options.map((o) => o.label)).toEqual(["Fire at its prow", "Fire at its starboard"]);
  });
});

describe("torpedo bearings", () => {
  test("arcs include their edges", () => {
    expect(inArcs(0, ["front"])).toBe(true);
    expect(inArcs(45, ["front"])).toBe(true);
    expect(inArcs(315, ["front"])).toBe(true);
    expect(inArcs(46, ["front"])).toBe(false);
  });
  test("outside the arc snaps to the nearest edge", () => {
    expect(clampToArcs(10.4, ["front"])).toBe(10);
    expect(clampToArcs(80, ["front"])).toBe(45);
    expect(clampToArcs(260, ["front"])).toBe(315);
    expect(clampToArcs(-20, ["front"])).toBe(340);
  });
  test("toward a point, and described", () => {
    const s = shooting({ x: 100, y: 50, h: 90 }, { x: 80, y: 50, h: 0 });
    const lunar = s.ships[0]!;
    const torps = lunar.profile.weapons.find((w) => w.kind === "torpedoes")!;
    expect(bearingToward(lunar, torps, { x: 90, y: 60 })).toBe(45); // Agrippa faces +y; (90, 60) is 45° to starboard
    expect(describeBearing(0)).toBe("dead ahead");
    expect(describeBearing(340)).toBe("20° to port");
  });
});
