/** Shooting checks (validator spec §4.3): fire, fire_nova_cannon and launch_torpedoes. */
import { approxGe, approxLe, distance, quadrantsOf, quadrantsOfPoint } from "../geometry/basic";
import { easiestAspect, isNearest, lineOfFireBlocked, novaLineBlocked, novaRange, shootableOrdnance, squadronTarget, tookFire, type Target } from "../geometry/targeting";
import { formation, inFormation, novaCannonBarred, onTable, squadronOf, weaponDisabled } from "../state/derived";
import type { GameState, Point, Ship, Weapon } from "../state/types";
import type { Fire, FireNovaCannon, LaunchTorpedoes } from "../transforms/types";
import { isResult, ownActiveShip, rerollCheck } from "./movement";
import { cm, OK, reject, type ValidationResult } from "./reasons";
import { planetBlocks } from "../rules/planets";

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
  const failed = state.turnState.ships[ship.id]?.priorityTest === "failed";

  // A squadron target (V15): checks 13–20 and 24–25 against its members in formation.
  const members = target.kind === "ship" ? squadronTarget(state, target.ship) : null;
  if (members !== null) {
    const reach = reaches(state, ship, weapon, target, members);
    if (!reach.ok) return reach;
    if (failed && !isNearest(state, ship, weapon, target)) {
      return reject("MUST_TARGET_NEAREST", `${ship.name} failed its Leadership test: it must fire at the nearest target`);
    }
  } else {
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
        return reject("LINE_OF_FIRE_BLOCKED", "A hulk or a planet blocks the line of fire", { targetId: target.ship.id });
      }
    } else {
      if (t.aspect !== undefined) return reject("INVALID_ASPECT_CHOICE", "Ordnance has no aspect", { options: [] });
      // 19: line of fire: hulks don't block shots at ordnance, planets do (transform T111)
      if (planetBlocks(state, from, at)) return reject("LINE_OF_FIRE_BLOCKED", "A planet blocks the line of fire", { targetId: target.salvo.id });
    }

    // 20: target priority
    if (failed && !isNearest(state, ship, weapon, target)) {
      return reject("MUST_TARGET_NEAREST", `${ship.name} failed its Leadership test: it must fire at the nearest target`);
    }
  }

  // 21–25: combined batteries (T32)
  const volley: { ship: Ship; weapon: Weapon }[] = [{ ship, weapon }];
  if (t.combineWith !== undefined) {
    const ids = t.combineWith;
    if (weapon.kind !== "battery" || new Set(ids).size !== ids.length || ids.includes(weapon.id)) {
      return reject("INVALID_VOLLEY", "Only weapons batteries combine, each named once besides the main one", { combineWith: ids });
    }
    for (const id of ids) {
      const extra = readyWeapon(state, ship, id, ["battery"]);
      if (!isWeapon(extra)) return extra;
      const reach = reaches(state, ship, extra, target, members);
      if (!reach.ok) return reach;
      if (failed && !isNearest(state, ship, extra, target)) {
        return reject("MUST_TARGET_NEAREST", `${ship.name} failed its Leadership test: ${extra.name} must fire at the nearest target`);
      }
      volley.push({ ship, weapon: extra });
    }
  }

  // 26: the re-roll
  const reroll = rerollCheck(state, ship, t.reroll);
  if (!reroll.ok) return reroll;

  // 29–35: squadron-mates' weapons (T84)
  if (t.withShips !== undefined) {
    const sq = squadronOf(state, ship);
    const crew = sq !== undefined && inFormation(state, ship) ? formation(state, sq) : null;
    if (crew === null || target.kind !== "ship") {
      return reject("INVALID_SQUADRON_FIRE", target.kind !== "ship" ? "Squadrons combine their fire at ships" : `${ship.name} isn't in formation in a squadron`);
    }
    const seen = new Set<string>();
    for (const entry of t.withShips) {
      const mate = crew.find((m) => m.id === entry.shipId);
      if (mate === undefined || mate.id === ship.id || seen.has(entry.shipId)) {
        return reject("INVALID_SQUADRON_FIRE", `${entry.shipId} isn't another ship in formation in ${sq?.name ?? "the squadron"}`, { shipId: entry.shipId });
      }
      seen.add(entry.shipId);
      const able = shooter(state, mate.id, t.player);
      if (isResult(able)) return able;
      if (entry.weaponIds.length === 0 || new Set(entry.weaponIds).size !== entry.weaponIds.length) {
        return reject("INVALID_SQUADRON_FIRE", `Name each of ${mate.name}'s weapons once`, { shipId: mate.id });
      }
      for (const id of entry.weaponIds) {
        const w = readyWeapon(state, mate, id, [weapon.kind]);
        if (!isWeapon(w)) return w;
        const reach = reaches(state, mate, w, target, members);
        if (!reach.ok) return reach;
        if (failed && !isNearest(state, mate, w, target)) {
          return reject("MUST_TARGET_NEAREST", `The squadron failed its Leadership test: ${mate.name}'s ${w.name} must fire at the nearest target`);
        }
        volley.push({ ship: mate, weapon: w });
      }
    }
  }

  // 27–28: the aspect fired at (T85)
  if (t.targetAspect !== undefined) {
    if (members === null) return reject("INVALID_TARGET_ASPECT", "Only a squadron's aspect is chosen", { targetAspect: t.targetAspect });
    const shown = tookFire(state, volley, members).map((m) => easiestAspect(m, from));
    if (!shown.includes(t.targetAspect)) {
      return reject("INVALID_TARGET_ASPECT", `No ship of the squadron in reach shows its ${t.targetAspect.replace("_", " ")} aspect`, { options: [...new Set(shown)] });
    }
  }
  return OK;
}

/** Range and arc for one more weapon of the volley: against the target, or some member of a squadron target (V15). */
function reaches(state: GameState, ship: Ship, w: Weapon, target: Target, members: Ship[] | null): ValidationResult {
  const from = ship.position as Point;
  if (members !== null) {
    if (tookFire(state, [{ ship, weapon: w }], members).length > 0) return OK;
    const inRange = members.some((m) => w.range !== null && approxLe(distance(from, m.position as Point), w.range));
    return inRange
      ? reject("OUT_OF_ARC", `No ship of the squadron is in ${w.name}'s arc, with a clear line of fire`, { weaponId: w.id, arcs: w.arcs })
      : reject("OUT_OF_RANGE", `No ship of the squadron is within ${w.name}'s ${cm(w.range ?? 0)}`, { weaponId: w.id, range: w.range ?? 0 });
  }
  const at = target.kind === "ship" ? (target.ship.position as Point) : target.salvo.position;
  const d = distance(from, at);
  if (w.range === null || !approxLe(d, w.range)) {
    return reject("OUT_OF_RANGE", `${w.name} reaches ${cm(w.range ?? 0)}; the target is ${cm(d)} away`, { weaponId: w.id, distance: d, range: w.range ?? 0 });
  }
  const quadrants = quadrantsOfPoint(from, ship.heading as number, at);
  if (!quadrants.some((q) => w.arcs.includes(q))) {
    return reject("OUT_OF_ARC", `The target is outside ${w.name}'s arc`, { weaponId: w.id, quadrants, arcs: w.arcs });
  }
  if (target.kind === "ship" && lineOfFireBlocked(state, ship, target.ship)) {
    return reject("LINE_OF_FIRE_BLOCKED", "A hulk or a planet blocks the line of fire", { targetId: target.ship.id });
  }
  if (target.kind === "ordnance" && planetBlocks(state, ship.position as Point, target.salvo.position)) {
    return reject("LINE_OF_FIRE_BLOCKED", "A planet blocks the line of fire", { targetId: target.salvo.id });
  }
  return OK;
}

export function checkFireNovaCannon(state: GameState, t: FireNovaCannon): ValidationResult {
  // 1–6
  const ship = shooter(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  // 7–10
  const weapon = readyWeapon(state, ship, t.weaponId, ["nova_cannon"]);
  if (!isWeapon(weapon)) return weapon;
  // 11
  const barred = novaCannonBarred(ship);
  if (barred !== null) {
    const order = ship.specialOrder?.kind ?? null;
    return reject(
      "NOVA_CANNON_BARRED",
      barred === "crippled" ? `${ship.name} is crippled: its nova cannon can't fire` : `${ship.name}'s special order stops its nova cannon firing`,
      barred === "order" ? { why: barred, order } : { why: barred },
    );
  }
  // 12
  const { x, y } = t.aim;
  if (!(approxGe(x, 0) && approxLe(x, state.table.width) && approxGe(y, 0) && approxLe(y, state.table.height))) {
    return reject("AIM_OFF_TABLE", "The template's centre must be on the table", { aim: t.aim });
  }
  // 13
  const quadrants = quadrantsOfPoint(ship.position as Point, ship.heading as number, t.aim);
  if (!quadrants.some((q) => weapon.arcs.includes(q))) {
    return reject("OUT_OF_ARC", `The aim point is outside ${weapon.name}'s arc`, { quadrants, arcs: weapon.arcs });
  }
  // 14
  const range = novaRange(ship, t.aim);
  const min = weapon.minRange ?? 0;
  const max = weapon.range ?? 0;
  if (!(approxGe(range, min) && approxLe(range, max))) {
    return reject("OUT_OF_RANGE", `${weapon.name} reaches ${cm(min)}–${cm(max)} to the template's edge; that's ${cm(range)}`, {
      range,
      min,
      max,
    });
  }
  // 15
  if (novaLineBlocked(state, ship, t.aim)) {
    return reject("LINE_OF_FIRE_BLOCKED", "A hulk or a planet blocks the line of fire", { aim: t.aim });
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
