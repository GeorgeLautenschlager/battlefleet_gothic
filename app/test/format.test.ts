import { describe as group, expect, test } from "vitest";
import { describe } from "../src/log/format";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import type { Transform } from "@bfg/engine";

const config = cruiserClash({ p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"] }, p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] }, ramming: true, seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
const play = (h: History, t: Transform): History => {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
};

group("log prose", () => {
  test("setup reads as sentences, with ship and player names", () => {
    let h = start(config);
    for (const type of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) h = play(h, { type, player: "p1" });
    const s = current(h);
    const lines = s.log.map((e) => describe(s, e));
    expect(lines).toContain("Agrippa rolls [5] for Leadership: Ld 8");
    expect(lines).toContain("Deployment roll-off [3 1]: Bo deploys first");
  });

  test("unknown kinds fall back to their data", () => {
    const s = current(start(config));
    expect(describe(s, { id: "log-1", playerTurn: 0, phase: null, kind: "new_thing", actor: null, data: { a: 1 } })).toBe('new thing {"a":1}');
  });
});
