/** Shooting checks (validator spec §4.3): fire and launch_torpedoes. */
import { approxLe, distance, quadrantsOf, quadrantsOfPoint } from "../geometry/basic";
import { isNearest, lineOfFireBlocked, shootableOrdnance, type Target } from "../geometry/targeting";
import { onTable, weaponDisabled } from "../state/derived";
import type { GameState, Point, Ship, Weapon } from "../state/types";
import type { Fire, LaunchTorpedoes } from "../transforms/types";
import { isResult, ownActiveShip } from "./movement";
import { cm, OK, reject, type ValidationResult } from "./reasons";

/** Shared checks 1–6: own active ship whose disengage test didn't fail, not grappled and not boarding. */
export function shooter(state: GameState, shipId: string, player: string): Ship | ValidationResult {
  const ship = ownActiveShip(state, shipId, player);
  if (isResult(ship)) return ship;
  if (state.turnState.ships[ship.id]?.disengage === "failed") {
    return reject("DISENGAGE_FAILED", `${ship.name} failed to disengage: it can't fire or launch this turn`, {
      shipId: ship.id,
    });
  }
  if (ship.grapple !== null) {
    return reject("GRAPPLED", `${ship.name} is locked in a boarding action: it can't fire or launch`, { shipId: ship.id });
  }
  if ((state.turnState.ships[ship.id]?.boardingDeclared ?? null) !== null) {
    return reject("BOARDING_SHIP", `${ship.name} is boarding this turn: it can't fire or launch`, { shipId: ship.id });
  }
  return ship;
}

/** Shared weapon checks: exists, right kind, unfired, not disabled. */
function readyWeapon(
  state: GameState,
  ship: Ship,
  weaponId: string,
  kinds: readonly Weapon["kind"][],
): Weapon | ValidationResult {
  const weapon = ship.profile.weapons.find((w) => w.id === weaponId);
  if (weapon === undefined) return reject("UNKNOWN_WEAPON", `${ship.name} has no weapon ${weaponId}`, { weaponId });
  if (!kinds.includes(weapon.kind)) {
    return reject("WRONG_WEAPON_KIND", `${weapon.name} can't be used like that`, { weaponId, kind: weapon.kind });
  }
  if (state.turnState.ships[ship.id]?.weaponsFired.includes(weapon.id) === true) {
    return reject("WEAPON_ALREADY_FIRED", `${weapon.name} has already fired this turn`, { weaponId });
  }
  if (weaponDisabled(state, ship, weapon)) {
    return reject("WEAPON_DISABLED", `${weapon.name} is disabled`, { weaponId });
  }
  return weapon;
}

const isWeapon = (x: Weapon | ValidationResult): x is Weapon => !("ok" in x);

export function checkFire(state: GameState, t: Fire): ValidationResult {
  // 1–6
  const ship = shooter(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  // 7–10
  const weapon = readyWeapon(state, ship, t.weaponId, ["battery", "lance"]);
  if (!isWeapon(weapon)) return weapon;

  // 11–12: target exists and is a legal enemy
  let target: Target;
  if (t.target.kind === "ship") {
    const s = state.ships.find((x) => x.id === t.target.id);
    if (s === undefined) return reject("UNKNOWN_TARGET", `No ship ${t.target.id}`, { targetId: t.target.id });
    if (s.owner === ship.owner || !onTable(s)) {
      return reject("INVALID_TARGET", `${s.name} isn't an enemy ship on the table`, { targetId: s.id });
    }
    target = { kind: "ship", ship: s };
  } else {
    const o = state.ordnance.find((x) => x.id === t.target.id);
    if (o === undefined) return reject("UNKNOWN_TARGET", `No ordnance ${t.target.id}`, { targetId: t.target.id });
    if (o.owner === ship.owner) return reject("INVALID_TARGET", "That ordnance is yours", { targetId: o.id });
    if (!shootableOrdnance(o, ship)) {
      return reject("INVALID_TARGET", "Fighters on Combat Air Patrol can't be shot at: they're on their ship's base", { targetId: o.id });
    }
    target = { kind: "ordnance", salvo: o };
  }
  const from = ship.position as Point;
  const at = target.kind === "ship" ? (target.ship.position as Point) : target.salvo.position;

  // 13: range
  const range = weapon.range ?? 0;
  const d = distance(from, at);
  if (!approxLe(d, range)) {
    return reject("OUT_OF_RANGE", `${weapon.name} reaches ${cm(range)}; the target is ${cm(d)} away`, {
      distance: d,
      range,
    });
  }

  // 14–16: arc
  const bearingQuadrants = quadrantsOfPoint(from, ship.heading as number, at);
  const q = bearingQuadrants.filter((x) => weapon.arcs.includes(x));
  if (q.length === 0) {
    return reject("OUT_OF_ARC", `The target is outside ${weapon.name}'s arc`, {
      quadrants: bearingQuadrants,
      arcs: weapon.arcs,
    });
  }
  if (bearingQuadrants.length > 1 && q.length > 1 && t.arc === undefined) {
    return reject("ARC_CHOICE_REQUIRED", "The target is on the line between two arcs: choose one", { options: q });
  }
  if (t.arc !== undefined && !q.includes(t.arc)) {
    return reject("INVALID_ARC_CHOICE", `The target isn't in the ${t.arc} arc of ${weapon.name}`, { options: q });
  }

  // 17–18: aspect
  if (target.kind === "ship") {
    const aspects = quadrantsOfPoint(at, target.ship.heading as number, from);
    if (aspects.length > 1 && t.aspect === undefined) {
      return reject("ASPECT_CHOICE_REQUIRED", "You're on the line between two of the target's quadrants: choose one", {
        options: aspects,
      });
    }
    if (t.aspect !== undefined && !aspects.includes(t.aspect)) {
      return reject("INVALID_ASPECT_CHOICE", `The target's ${t.aspect} quadrant doesn't face you`, { options: aspects });
    }
    // 19: line of fire
    if (lineOfFireBlocked(state, ship, target.ship)) {
      return reject("LINE_OF_FIRE_BLOCKED", "A hulk blocks the line of fire", { targetId: target.ship.id });
    }
  } else if (t.aspect !== undefined) {
    return reject("INVALID_ASPECT_CHOICE", "Ordnance has no aspect", { options: [] });
  }

  // 20: target priority
  const failed = state.turnState.ships[ship.id]?.priorityTest === "failed";
  if (failed && !isNearest(state, ship, weapon, target)) {
    return reject("MUST_TARGET_NEAREST", `${ship.name} failed its Leadership test: it must fire at the nearest target`);
  }

  // 21–25: combined batteries (T32)
  if (t.combineWith === undefined) return OK;
  const ids = t.combineWith;
  if (weapon.kind !== "battery" || new Set(ids).size !== ids.length || ids.includes(weapon.id)) {
    return reject("INVALID_VOLLEY", "Only weapons batteries combine, each named once besides the main one", { combineWith: ids });
  }
  for (const id of ids) {
    const extra = readyWeapon(state, ship, id, ["battery"]);
    if (!isWeapon(extra)) return extra;
    if (extra.range === null || !approxLe(distance(from, at), extra.range)) {
      return reject("OUT_OF_RANGE", `${extra.name} reaches ${cm(extra.range ?? 0)}; the target is ${cm(distance(from, at))} away`, {
        weaponId: extra.id,
        distance: distance(from, at),
        range: extra.range ?? 0,
      });
    }
    if (!bearingQuadrants.some((q) => extra.arcs.includes(q))) {
      return reject("OUT_OF_ARC", `The target is outside ${extra.name}'s arc`, { weaponId: extra.id, quadrants: bearingQuadrants, arcs: extra.arcs });
    }
    if (failed && !isNearest(state, ship, extra, target)) {
      return reject("MUST_TARGET_NEAREST", `${ship.name} failed its Leadership test: ${extra.name} must fire at the nearest target`);
    }
  }
  return OK;
}

export function checkLaunchTorpedoes(state: GameState, t: LaunchTorpedoes): ValidationResult {
  // 1–6
  const ship = shooter(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  // 7–10
  const weapon = readyWeapon(state, ship, t.weaponId, ["torpedoes"]);
  if (!isWeapon(weapon)) return weapon;
  // 11
  if (ship.loaded.torpedoes !== true) {
    return reject("NOT_LOADED", `${ship.name}'s torpedoes need reloading`, { shipId: ship.id });
  }
  // 12
  const inArc = t.bearing >= 0 && t.bearing < 360 && quadrantsOf(t.bearing).some((q) => weapon.arcs.includes(q));
  if (!inArc) {
    return reject("BEARING_OUT_OF_ARC", `Bearing ${t.bearing}° is outside ${weapon.name}'s arc`, {
      bearing: t.bearing,
      arcs: weapon.arcs,
    });
  }
  return OK;
}
