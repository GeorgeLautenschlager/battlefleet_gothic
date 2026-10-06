/** Squadron fire in the fire controls (transforms v0.14 T84–T85). */
import { describe, expect, test } from "vitest";
import { emptyTurnState, newGame, type GameState } from "@bfg/engine";
import { targets } from "../src/fire/fire";

/** Two Iconoclasts (p2) in a squadron, off the prow of two Lunars (p1) in another, p2 to fire. */
function state(): GameState {
  const s = newGame({
    seed: 1,
    createdAt: "1970-01-01T00:00:00Z",
    forces: { kind: "points", limit: 1000 },
    scoring: "victory_points",
    players: { p1: { name: "Ann", faction: "imperial_navy" }, p2: { name: "Bo", faction: "chaos" } },
    ships: [
      { owner: "p1", name: "Agrippa", classId: "lunar", squadron: "Line" },
      { owner: "p1", name: "Gothic Dawn", classId: "lunar", squadron: "Line" },
      { owner: "p2", name: "Lost 1", classId: "iconoclast", squadron: "Lost" },
      { owner: "p2", name: "Lost 2", classId: "iconoclast", squadron: "Lost" },
    ],
  });
  const at: [number, number, number][] = [[100, 30, 0], [112, 30, 90], [100, 55, 180], [106, 55, 180]];
  s.ships.forEach((ship, i) => {
    const [x, y, h] = at[i]!;
    Object.assign(ship, { leadership: 8, status: "active", position: { x, y }, heading: h });
  });
  s.setup.leadershipRolled = true;
  s.setup.firstPlayer = "p1";
  s.clock = { stage: "battle", setupStep: null, playerTurn: 2, phase: "shooting", step: "direct_fire" };
  s.turnState = emptyTurnState(2, s.ships);
  return s;
}

describe("squadron fire options", () => {
  test("a squadron volley first, then each aspect the target squadron shows, then the ship alone", () => {
    const s = state();
    const lead = s.ships[2]!;
    const battery = lead.profile.weapons.find((w) => w.id === "battery")!;
    const at = targets(s, lead, battery).find((t) => t.id === "ship-1")!;
    // Agrippa shows its prow (closing); Gothic Dawn, turned east, its side (abeam).
    expect(at.options.map((o) => [o.transform.withShips?.map((w) => w.shipId) ?? null, o.transform.targetAspect ?? null])).toEqual([
      [["ship-4"], "closing"],
      [["ship-4"], "abeam"],
      [null, "closing"],
      [null, "abeam"],
    ]);
    expect(at.options[0]!.label).toBe("Squadron volley with Lost 2, at its closing ships");
  });
});
