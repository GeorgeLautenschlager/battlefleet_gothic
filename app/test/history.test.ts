import { describe, expect, test } from "vitest";
import { apply, canUndo, current, fromSave, start, toSave, undo, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import type { Transform } from "@bfg/engine";

const config = cruiserClash({ p1Name: "A", p2Name: "B", p1Ship: "Agrippa", p2Ship: "Unclean", seed: 1337 }, new Date("2026-10-04T12:00:00Z"));

function play(h: History, t: Transform): History {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
}

/** Seed 1337 through setup: p2 deploys first, p1 chooses and goes second. */
function throughSetup(): History {
  let h = start(config);
  h = play(h, { type: "roll_leadership", player: "p1" });
  h = play(h, { type: "roll_zones", player: "p1" });
  h = play(h, { type: "roll_deploy_order", player: "p1" });
  h = play(h, { type: "deploy_ship", player: "p2", shipId: "ship-2", position: { x: 95, y: 15 } });
  h = play(h, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 90, y: 105 } });
  h = play(h, { type: "roll_first_turn", player: "p1" });
  return play(h, { type: "choose_first_turn", player: "p1", goFirst: false });
}

describe("history", () => {
  test("apply validates, and rejects with the validator's reason", () => {
    const r = apply(start(config), { type: "roll_first_turn", player: "p1" });
    expect(r.ok).toBe(false);
  });

  test("undo steps back over dice-free transforms, never past a roll", () => {
    let h = start(config);
    h = play(h, { type: "roll_leadership", player: "p1" });
    expect(canUndo(h)).toBe(false); // that rolled
    h = play(h, { type: "roll_zones", player: "p1" });
    h = play(h, { type: "roll_deploy_order", player: "p1" });
    h = play(h, { type: "deploy_ship", player: "p2", shipId: "ship-2", position: { x: 95, y: 15 } });
    expect(canUndo(h)).toBe(true); // deploying rolls nothing
    const back = undo(h);
    expect(current(back).ships[1]!.status).toBe("undeployed");
    expect(canUndo(back)).toBe(false);
    expect(undo(back)).toBe(back);
  });

  test("a save replays to the same state", () => {
    const h = throughSetup();
    const restored = fromSave(JSON.parse(JSON.stringify(toSave(h))));
    expect(restored).not.toBeNull();
    expect(current(restored!)).toEqual(current(h));
    expect(current(h).clock.stage).toBe("battle");
  });

  test("garbage and stale saves are refused", () => {
    expect(fromSave(null)).toBeNull();
    expect(fromSave({ format: "something else" })).toBeNull();
    const save = toSave(throughSetup());
    save.transforms.splice(3, 1); // drop a deploy: the later ones no longer apply
    expect(fromSave(save)).toBeNull();
  });
});
