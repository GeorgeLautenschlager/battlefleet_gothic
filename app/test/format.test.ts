import { describe as group, expect, test } from "vitest";
import { describe } from "../src/log/format";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import type { Transform } from "@bfg/engine";

const config = cruiserClash({ p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa"] }, p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] }, ramming: true, boarding: false, seed: 1337 }, new Date("2026-10-04T12:00:00Z"));
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

  test("boarding reads as sentences", () => {
    const s = current(start(config));
    const line = (kind: string, data: Record<string, unknown>) =>
      describe(s, { id: "log-1", playerTurn: 3, phase: "end", kind, actor: "p1", data: data as never });
    const fight = { defenderId: "ship-2", rolls: [5, 5], totals: { attackers: 5, defender: 7 }, result: "heavy_fighting", damage: 2 };
    expect(line("boarding", { ...fight, attackerIds: ["ship-1"], loser: "attackers" })).toBe(
      "Agrippa boards Unclean: [5 5] → 5 vs 7, heavy fighting, Agrippa takes 2 damage",
    );
    expect(line("boarding", { ...fight, attackerIds: ["ship-1", "ship-1"], loser: "attackers" })).toBe(
      "Agrippa and Agrippa board Unclean: [5 5] → 5 vs 7, heavy fighting, Agrippa and Agrippa take 2 damage",
    );
    expect(line("boarding", { ...fight, attackerIds: ["ship-1"], loser: null, totals: { attackers: 6, defender: 6 } })).toBe(
      "Agrippa boards Unclean: [5 5] → 6 vs 6, a draw: the ships grapple",
    );
    expect(line("teleport", { shipId: "ship-2", targetId: "ship-1", rolls: [4], saveRolls: [5], result: "saved" })).toBe(
      "Unclean teleports onto Agrippa [4]: braced, saved [5]",
    );
    expect(line("boarding_critical", { shipId: "ship-1", need: "auto", rolls: [], critical: true })).toBe("Agrippa suffers a critical from the boarding action");
  });
});
