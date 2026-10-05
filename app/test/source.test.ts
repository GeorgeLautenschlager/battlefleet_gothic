import { describe, expect, test } from "vitest";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import { controls, sendAs, waitingOn } from "../src/game/source";
import type { Transform } from "@bfg/engine";

const config = cruiserClash({ p1Name: "Ann", p2Name: "Bo", p1Ship: "Agrippa", p2Ship: "Unclean", seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
const play = (h: History, t: Transform): History => {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
};

describe("seats", () => {
  test("hot-seat drives both players; online, one", () => {
    expect(controls("both", "p1") && controls("both", "p2")).toBe(true);
    expect(controls("p1", "p1")).toBe(true);
    expect(controls("p1", "p2")).toBe(false);
  });

  test("either-player steps wait on nobody; a named actor is waited on by the other seat only", () => {
    let h = start(config);
    expect(waitingOn(current(h), "p2")).toBeNull(); // roll_leadership: either
    for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) h = play(h, { type, player: "p1" });
    const s = current(h); // deploy: p2 deploys first with seed 1337
    expect(waitingOn(s, "both")).toBeNull();
    expect(waitingOn(s, "p2")).toBeNull();
    expect(waitingOn(s, "p1")).toBe("p2");
  });

  test("either-player transforms are sent as our seat online, p1 in hot-seat", () => {
    expect(sendAs("both")).toBe("p1");
    expect(sendAs("p2")).toBe("p2");
  });
});
