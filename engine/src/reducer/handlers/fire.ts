/** The fire transform (reducer spec §4, transform §4.3). */
import { distance, quadrantsOfPoint } from "../../geometry/basic";
import { eligibleAt, isNearest, squadronTarget, targetPosition, tookFire, volleyAspect, type Target } from "../../geometry/targeting";
import { minefields } from "../../rules/minefields";
import { formation, getShip, inFormation, priorityLd, squadronOf } from "../../state/derived";
import type { Point, Quadrant, Ship, Weapon } from "../../state/types";
import type { Fire } from "../../transforms/types";
import type { Ctx } from "../context";
import { rerollableTest } from "../reroll";

export function fire(ctx: Ctx, t: Fire): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const weapon = ship.profile.weapons.find((w) => w.id === t.weaponId);
  const entry = state.turnState.ships[ship.id];
  if (weapon === undefined || entry === undefined) return; // unreachable after validation

  const targetShip = t.target.kind === "ship" ? getShip(state, t.target.id) : null;
  const targetSalvo = t.target.kind === "ordnance" ? state.ordnance.find((o) => o.id === t.target.id) ?? null : null;
  const targetField = t.target.kind === "minefield" ? minefields(state).find((f) => f.id === t.target.id) ?? null : null;
  const target: Target | null =
    targetShip !== null
      ? { kind: "ship", ship: targetShip }
      : targetSalvo !== null
        ? { kind: "ordnance", salvo: targetSalvo }
        : targetField !== null
          ? { kind: "minefield", field: targetField }
          : null;
  if (target === null) return; // unreachable after validation

  // A combined volley (T32): the other batteries firing with this one; and squadron-mates' weapons (T84).
  const combineWith = t.combineWith ?? [];
  const own = [weapon, ...combineWith.map((id) => ship.profile.weapons.find((w) => w.id === id)).filter((w) => w !== undefined)];
  const withShips = t.withShips ?? [];
  const volley: { ship: Ship; weapon: Weapon }[] = [
    ...own.map((w) => ({ ship, weapon: w })),
    ...withShips.flatMap((e) => {
      const mate = getShip(state, e.shipId);
      return e.weaponIds.flatMap((id) => mate.profile.weapons.filter((w) => w.id === id).map((w) => ({ ship: mate, weapon: w })));
    }),
  ];

  // Target priority (p. 60): a test only if this isn't the nearest target (for any weapon in the volley, T34) and none was taken yet.
  // A squadron in formation takes one, on its Leadership, for all its members (N40).
  if (entry.priorityTest === null && volley.some((v) => !isNearest(state, v.ship, v.weapon, target))) {
    const ld = priorityLd(state, ship);
    const test = rerollableTest(ctx, ship, 2, ld, t.reroll === true, "priority", (r) =>
      ctx.log("priority_test", { shipId: ship.id, target: ld, rolls: r.rolls, passed: r.passed }),
    );
    const sq = squadronOf(state, ship);
    const crew = sq !== undefined && inFormation(state, ship) ? formation(state, sq) : [ship];
    for (const m of crew) {
      const e = state.turnState.ships[m.id];
      if (e !== undefined) e.priorityTest = test.passed ? "passed" : "failed";
    }
    if (!test.passed) return; // the weapon isn't spent: it may fire at the nearest target instead
  }

  for (const v of volley) state.turnState.ships[v.ship.id]?.weaponsFired.push(v.weapon.id);
  const from = ship.position as Point;
  const at = targetPosition(target, from);
  // Validation guarantees a single option wherever the transform left a choice out.
  const arc: Quadrant = t.arc ?? quadrantsOfPoint(from, ship.heading as number, at).find((q) => weapon.arcs.includes(q)) ?? "front";
  const aspect: Quadrant | null =
    targetShip !== null ? (t.aspect ?? quadrantsOfPoint(at, targetShip.heading as number, from)[0] ?? "front") : null;

  // At a squadron (§4.5, T86): one brace offer, to the eligible member nearest the lead.
  const members = targetShip !== null ? squadronTarget(state, targetShip) : null;
  let braceId = targetShip?.id ?? null;
  let targetAspect = t.targetAspect;
  if (members !== null) {
    const engaged = tookFire(state, volley, members);
    targetAspect = volleyAspect(ship, engaged, t.targetAspect);
    const eligible = eligibleAt(ship, engaged, targetAspect);
    braceId = [...eligible].sort((a, b) => distance(from, a.position as Point) - distance(from, b.position as Point))[0]?.id ?? null;
  }

  if (braceId !== null) state.queue.push({ kind: "brace_offer", shipId: braceId, source: { kind: "ship", id: ship.id } });
  state.queue.push({
    kind: "direct_fire",
    shooterId: ship.id,
    weaponId: weapon.id,
    combineWith: [...combineWith],
    target: { ...t.target },
    arc,
    aspect,
    ...(withShips.length > 0 ? { withShips: withShips.map((e) => ({ shipId: e.shipId, weaponIds: [...e.weaponIds] })) } : {}),
    ...(members !== null && targetAspect !== undefined ? { targetAspect } : {}),
  });
}
