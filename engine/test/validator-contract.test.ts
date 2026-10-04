/** The validator's contract (validator spec §1) and its sync with the spec's code table (§5). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { REASON_CODES } from "../src/validator/reasons";
import { validate } from "../src/validator/validate";
import { battle, broadside } from "./validator-fixtures";
import { freshGame, sampler } from "./helpers";

describe("reason codes", () => {
  test("match the spec's §5 table exactly", () => {
    const spec = readFileSync(fileURLToPath(new URL("../../validator/SPEC.md", import.meta.url)), "utf8");
    const table = spec.slice(spec.indexOf("## 5. Reason codes"), spec.indexOf("## 6. Examples"));
    const inSpec = new Set([...table.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]));
    expect([...inSpec].sort()).toEqual([...REASON_CODES].sort());
  });
});

describe("total: never throws, always answers", () => {
  const rnd = sampler(7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const TYPES = [
    "roll_leadership", "roll_zones", "roll_deploy_order", "deploy_ship", "roll_first_turn", "choose_first_turn",
    "drift_hulk", "declare_order", "move", "fire", "launch_torpedoes", "end_step", "move_ordnance",
    "answer_brace", "repair", "remove_blast_markers", "nonsense",
  ] as const;
  const junk = (): unknown =>
    pick([
      () => null, () => 42, () => "ship-1", () => [], () => ({}), () => rnd() * 400 - 200, () => true,
      () => ({ x: rnd() * 200, y: rnd() * 120 }), () => [{ kind: "advance", distance: rnd() * 40 }, { kind: "turn", degrees: rnd() * 90 - 45 }],
      () => ({ kind: pick(["ship", "ordnance"]), id: pick(["ship-1", "ship-2", "ord-1"]) }),
    ])();
  const randomTransform = (): unknown => {
    const t: Record<string, unknown> = { type: pick(TYPES), player: pick(["p1", "p2", "p3"]) };
    for (const key of ["shipId", "position", "path", "disengage", "order", "weaponId", "target", "bearing", "priority", "pendingId", "attempt", "ordnanceId", "goFirst", "arc"]) {
      if (rnd() < 0.3) t[key] = key.endsWith("Id") ? pick(["ship-1", "ship-2", "ship-9", "port_battery", "ord-1"]) : junk();
    }
    return t;
  };

  test("5,000 random transforms against several states", () => {
    const states = [freshGame(), battle(), broadside(), battle("end", "damage_control")];
    for (let i = 0; i < 5000; i++) {
      const s = pick(states);
      const result = validate(s, rnd() < 0.1 ? junk() : randomTransform());
      expect(typeof result.ok).toBe("boolean");
    }
  });

  test("never mutates the state", () => {
    const s = broadside();
    const before = JSON.stringify(s);
    validate(s, { type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target: { kind: "ship", id: "ship-1" } });
    validate(s, { type: "move", player: "p2", shipId: "ship-2", path: [{ kind: "advance", distance: 20 }], disengage: false });
    expect(JSON.stringify(s)).toBe(before);
  });
});
