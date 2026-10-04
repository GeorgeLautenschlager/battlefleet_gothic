/** The fire transform (reducer spec §4, transform §4.3). */
import { quadrantsOfPoint } from "../../geometry/basic";
import { isNearest, type Target } from "../../geometry/targeting";
import { getShip, leadership } from "../../state/derived";
import type { Point, Quadrant } from "../../state/types";
import type { Fire } from "../../transforms/types";
import type { Ctx } from "../context";

export function fire(ctx: Ctx, t: Fire): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const weapon = ship.profile.weapons.find((w) => w.id === t.weaponId);
  const entry = state.turnState.ships[ship.id];
  if (weapon === undefined || entry === undefined) return; // unreachable after validation

  const targetShip = t.target.kind === "ship" ? getShip(state, t.target.id) : null;
  const targetSalvo = t.target.kind === "ordnance" ? state.ordnance.find((o) => o.id === t.target.id) ?? null : null;
  const target: Target | null =
    targetShip !== null ? { kind: "ship", ship: targetShip } : targetSalvo !== null ? { kind: "ordnance", salvo: targetSalvo } : null;
  if (target === null) return; // unreachable after validation

  // Target priority (p. 60): a test only if this isn't the nearest target and none was taken yet.
  if (entry.priorityTest === null && !isNearest(state, ship, weapon, target)) {
    const ld = leadership(ship);
    const test = ctx.test(2, ld);
    entry.priorityTest = test.passed ? "passed" : "failed";
    ctx.log("priority_test", { shipId: ship.id, target: ld, rolls: test.rolls, passed: test.passed });
    if (!test.passed) return; // the weapon isn't spent: it may fire at the nearest target instead
  }

  entry.weaponsFired.push(weapon.id);
  const from = ship.position as Point;
  const at = targetShip !== null ? (targetShip.position as Point) : (targetSalvo?.position as Point);
  // Validation guarantees a single option wherever the transform left a choice out.
  const arc: Quadrant = t.arc ?? quadrantsOfPoint(from, ship.heading as number, at).find((q) => weapon.arcs.includes(q)) ?? "front";
  const aspect: Quadrant | null =
    targetShip !== null ? (t.aspect ?? quadrantsOfPoint(at, targetShip.heading as number, from)[0] ?? "front") : null;

  if (targetShip !== null) {
    state.queue.push({ kind: "brace_offer", shipId: targetShip.id, source: { kind: "ship", id: ship.id } });
  }
  state.queue.push({ kind: "direct_fire", shooterId: ship.id, weaponId: weapon.id, target: { ...t.target }, arc, aspect });
}
