/** Movement checks (validator spec §4.2): drift_hulk, declare_order, move. */
import { BM_SLOWDOWN } from "../geometry/constants";
import { approxEq, approxGe, approxLe, baseRadius, basesTouch, distance, norm } from "../geometry/basic";
import { gravityTurnProblem, gravityWellAt } from "../rules/planets";
import { exitDistance, touchesAnyBm, walkShipPath } from "../geometry/path";
import { allAheadFullEnd, moveParameters, movingOrder } from "../rules/move";
import { bmsInContact, canBeBoarded, isHulk, onStandby, onTable, rerollFor, squadronOf, wentOnAlert } from "../state/derived";
import type { GameState, Point, Ship } from "../state/types";
import type { DeclareOrder, DriftHulk, Move } from "../transforms/types";
import { cm, OK, reject, type ValidationResult } from "./reasons";

/** Shared checks 1–2: the ship exists and belongs to the player. */
export function ownShip(state: GameState, shipId: string, player: string): Ship | ValidationResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (ship === undefined) return reject("UNKNOWN_SHIP", `No ship ${shipId}`, { shipId });
  if (ship.owner !== player) return reject("NOT_YOUR_SHIP", `${ship.name} isn't yours`, { shipId });
  return ship;
}

export const isResult = (x: Ship | ValidationResult): x is ValidationResult => "ok" in x;

/** Shared checks 1–3: own ship, and active. */
export function ownActiveShip(state: GameState, shipId: string, player: string): Ship | ValidationResult {
  const ship = ownShip(state, shipId, player);
  if (isResult(ship)) return ship;
  if (ship.status !== "active") {
    return reject("SHIP_NOT_ACTIVE", `${ship.name} is ${ship.status.replace("_", " ")}`, { shipId, status: ship.status });
  }
  return ship;
}

export function checkDriftHulk(state: GameState, t: DriftHulk): ValidationResult {
  const ship = ownShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  if (!isHulk(ship)) return reject("NOT_A_HULK", `${ship.name} isn't a hulk`, { shipId: ship.id });
  if (state.turnState.ships[ship.id]?.drifted === true) {
    return reject("ALREADY_DRIFTED", `${ship.name} has already drifted this turn`, { shipId: ship.id });
  }
  return OK;
}

export function checkDeclareOrder(state: GameState, t: DeclareOrder): ValidationResult {
  const ship = ownActiveShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  // 3a–3b: Surprise Attack's standby, and the turn a ship goes on alert (T117, T120)
  if (onStandby(ship)) return reject("ON_STANDBY", `${ship.name} is on standby: it takes no special orders but Brace`, { shipId: ship.id });
  if (wentOnAlert(state, ship)) return reject("JUST_ALERTED", `${ship.name} went on alert this turn: no special orders`, { shipId: ship.id });
  if (state.turnState.ships[ship.id]?.moved === true) {
    return reject("ALREADY_MOVED", `${ship.name} has already moved this turn`, { shipId: ship.id });
  }
  if (state.activation !== null) {
    return reject("ACTIVATION_OPEN", "Another ship has declared an order and must move first", {
      shipId: state.activation.shipId,
    });
  }
  if (state.turnState.commandCheckFailed) {
    return reject("ORDERS_LOCKED", "Your fleet failed a Command check this turn: no more special orders");
  }
  if (ship.specialOrder !== null) {
    return reject("ALREADY_ON_ORDERS", `${ship.name} is already on ${ship.specialOrder.kind.replaceAll("_", " ")}`, {
      shipId: ship.id,
      order: ship.specialOrder.kind,
    });
  }
  if (t.order === "brace_for_impact") {
    return reject("INVALID_ORDER", "Brace For Impact! is only declared when a ship is attacked");
  }
  if (t.order === "come_to_new_heading" && ship.profile.traits?.noComeToNewHeading === true) {
    return reject("INVALID_ORDER", `${ship.name} is too ponderous to Come To New Heading`, { shipId: ship.id });
  }
  if (t.ramTargetId !== undefined) {
    if (t.order !== "all_ahead_full" || !state.meta.options.ramming) {
      return reject("RAM_NOT_ALLOWED", "Ramming needs All Ahead Full, with ramming enabled");
    }
    const target = state.ships.find((s) => s.id === t.ramTargetId);
    if (target === undefined || target.owner === ship.owner || !onTable(target)) {
      return reject("INVALID_RAM_TARGET", `${t.ramTargetId} isn't an enemy ship on the table`, {
        ramTargetId: t.ramTargetId,
      });
    }
  }
  // 11: a re-roll to use if the check fails
  const reroll = rerollCheck(state, ship, t.reroll);
  if (!reroll.ok) return reroll;
  // 12–13: a squadron that has begun moving already has its order; another squadron's move comes first
  const sm = state.turnState.squadronMove ?? null;
  if (sm !== null) {
    if (squadronOf(state, ship)?.id === sm.squadronId) {
      return reject("SQUADRON_ORDERED", `${ship.name}'s squadron is already moving on its order`, { squadronId: sm.squadronId });
    }
    return reject("SQUADRON_MOVING", "Another squadron must finish moving first", { squadronId: sm.squadronId });
  }
  return OK;
}

export function checkMove(state: GameState, t: Move): ValidationResult {
  // 1–5: identify the move
  const ship = ownActiveShip(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  if (onStandby(ship)) return reject("ON_STANDBY", `${ship.name} is on standby: it doesn't move`, { shipId: ship.id });
  if (state.turnState.ships[ship.id]?.moved === true) {
    return reject("ALREADY_MOVED", `${ship.name} has already moved this turn`, { shipId: ship.id });
  }
  const { activation } = state;
  if (activation !== null && !(activation.stage === "ordered" && activation.shipId === ship.id)) {
    return reject("ACTIVATION_OPEN", "Another ship has declared an order and must move first", {
      shipId: activation.shipId,
    });
  }

  // 5a–5c: squadron moves (state N37, N41)
  const sm = state.turnState.squadronMove ?? null;
  if (sm !== null && !sm.members.includes(ship.id)) {
    return reject("SQUADRON_MOVING", "Another squadron must finish moving first", { squadronId: sm.squadronId });
  }
  const sq = squadronOf(state, ship);
  const leaves = exitDistance(walkShipPath(ship, t.path), state.table) !== null;
  if (sq?.disengaging === true && !leaves && !t.disengage) {
    return reject("MUST_DISENGAGE", `${ship.name}'s squadron is disengaging: it must try to as well`, { squadronId: sq.id });
  }
  if (sq?.type === "escort" && sm !== null && sm.squadronId === sq.id && sm.disengage !== null && !sq.disengaging && !leaves && t.disengage !== sm.disengage) {
    return reject("SQUADRON_DISENGAGE", `An escort squadron disengages together: ${sm.disengage ? "every" : "no"} member asks for the test`, { disengage: sm.disengage });
  }

  // Parameters, as the reducer computes them
  const p = moveParameters(ship, movingOrder(state, ship));
  const walk = walkShipPath(ship, t.path);
  const exit = exitDistance(walk, state.table);
  const slowed = touchesAnyBm(state, ship, walk);
  const limit = p.maxIfBR - (slowed ? BM_SLOWDOWN : 0);

  // 6: step shapes
  for (const [stepIndex, step] of t.path.entries()) {
    const bad = step.kind === "advance" ? !(step.distance > 0) : step.degrees === 0;
    if (bad) return reject("INVALID_PATH_STEP", `Step ${stepIndex} doesn't move or turn`, { stepIndex });
  }
  // 6a: gravity turns, first and/or last, in a well, toward the planet (state N68)
  const last = t.path.length - 1;
  for (const g of walk.gravityTurns) {
    const where = g.stepIndex === 0 || g.stepIndex === last;
    const both = walk.gravityTurns.length > 1 && walk.legs.length === 0;
    const problem = !where || both ? "position" : gravityTurnProblem(state, g.at, g.headingBefore, g.degrees);
    if (problem !== null) {
      const why = {
        position: "A gravity turn comes at the start or the end of the move",
        not_in_well: `${ship.name} isn't in a gravity well there`,
        direction: "A gravity turn swings the bow toward the planet",
        too_sharp: "A gravity turn is at most 45°, and no further than the planet",
      }[problem];
      return reject("INVALID_GRAVITY_TURN", why, { stepIndex: g.stepIndex, reason: problem });
    }
  }
  // 7: turn angle
  for (const turn of walk.turns) {
    if (!approxLe(Math.abs(turn.degrees), ship.profile.turns)) {
      return reject("TURN_TOO_SHARP", `${ship.name} can turn at most ${ship.profile.turns}°`, {
        stepIndex: turn.stepIndex,
        degrees: turn.degrees,
        max: ship.profile.turns,
      });
    }
  }
  // 8: number of turns
  if (walk.turns.length > p.turnsAllowed) {
    return reject("TOO_MANY_TURNS", `${ship.name} may make ${p.turnsAllowed} turn(s) this move`, {
      turns: walk.turns.length,
      allowed: p.turnsAllowed,
    });
  }
  // 9: distance before each turn (Burn Retros may turn without moving first)
  for (const turn of walk.turns) {
    const exempt = p.order === "burn_retros" && turn.sinceLastTurn === 0;
    if (!exempt && !approxGe(turn.sinceLastTurn, p.turnDistance)) {
      return reject(
        "TURN_TOO_EARLY",
        `${ship.name} must move ${cm(p.turnDistance)} before turning (has moved ${cm(turn.sinceLastTurn)})`,
        { stepIndex: turn.stepIndex, sinceLastTurn: turn.sinceLastTurn, required: p.turnDistance },
      );
    }
  }
  // 10, 11: leaving the table
  if (exit !== null) {
    const last = t.path.length - 1;
    const lastLeg = walk.legs[walk.legs.length - 1];
    if (lastLeg === undefined || lastLeg.stepIndex !== last || exit < lastLeg.distanceBefore) {
      return reject("PATH_CONTINUES_OFF_TABLE", "The ship leaves the table before its last step", { exit });
    }
    if (t.disengage) {
      return reject("ALREADY_LEAVING_TABLE", "This move leaves the table: no disengage test needed");
    }
  }

  // 14: All Ahead Full replaces 12 and 13
  if (p.order === "all_ahead_full") {
    const first = walk.gravityTurns.find((g) => g.stepIndex === 0);
    const aaf = allAheadFullEnd(state, ship, p.d0, first === undefined ? ship.heading : norm((ship.heading as number) + first.degrees));
    const leavesFirst = exit !== null && approxLe(exit, aaf.end);
    if (!leavesFirst && !approxEq(walk.total, aaf.end)) {
      const code = aaf.stoppedByBm ? "MUST_STOP_AT_BLAST_MARKER" : "MUST_MOVE_FULL_DISTANCE";
      const why = aaf.stoppedByBm ? "stop where it meets the Blast Marker" : "move its full distance";
      return reject(code, `On All Ahead Full, ${ship.name} must ${why}: ${cm(aaf.end)}`, {
        total: walk.total,
        required: aaf.end,
      });
    }
  } else {
    // 12: maximum
    if (!approxLe(walk.total, limit)) {
      return reject("PATH_TOO_LONG", `${ship.name} can move at most ${cm(limit)}`, { total: walk.total, limit, slowed });
    }
    // 13: minimum, unless leaving the table. A ship that starts on a Blast Marker can't move at all
    // without being slowed, so its minimum is capped by the slowed limit even when it stays put (V12).
    const startsOnBm = bmsInContact(state, ship).length > 0;
    // High orbit (state N69): a ship that starts in a gravity well needn't move.
    const orbit = gravityWellAt(state, ship.position as Point) !== undefined;
    const minimum = orbit ? 0 : Math.min(p.minDistance, startsOnBm ? p.maxIfBR - BM_SLOWDOWN : limit);
    if (exit === null && !approxGe(walk.total, minimum)) {
      return reject("PATH_TOO_SHORT", `${ship.name} must move at least ${cm(minimum)}`, {
        total: walk.total,
        limit: minimum,
        slowed,
      });
    }
  }

  // 15–19: a boarding declaration (transform T8); then 20, the re-roll
  if (t.boardTargetId === undefined) return rerollCheck(state, ship, t.reroll, t.disengage);
  if (!state.meta.options.boarding) return reject("BOARDING_OFF", "Boarding isn't in play in this game");
  const target = state.ships.find((s) => s.id === t.boardTargetId);
  if (target === undefined || target.owner === ship.owner || target.status !== "active") {
    return reject("INVALID_BOARDING_TARGET", "Only an active enemy ship can be boarded", { targetId: t.boardTargetId });
  }
  if (!canBeBoarded(target)) {
    return reject("INVALID_BOARDING_TARGET", `${target.name} bears the Mark of Nurgle: it can't be boarded`, { targetId: target.id });
  }
  if (target.grapple !== null) {
    return reject("TARGET_GRAPPLED", `${target.name} is already locked in a boarding action`, { targetId: target.id });
  }
  if (exit !== null || t.disengage) {
    return reject("CANNOT_BOARD_AND_LEAVE", "A ship can't board on a move that leaves the table or disengages");
  }
  const needed = baseRadius(ship.profile.baseSize) + baseRadius(target.profile.baseSize);
  const gap = distance(walk.end.position, target.position as Point);
  if (!basesTouch(walk.end.position, ship.profile.baseSize, target.position as Point, target.profile.baseSize)) {
    return reject("NOT_IN_CONTACT", `${ship.name} must end its move touching ${target.name}`, { distance: gap, needed });
  }
  return rerollCheck(state, ship, t.reroll, t.disengage);
}

/** `reroll` asks for a fleet commander re-roll: there must be one for this ship, and a test to use it on (V14). */
export function rerollCheck(state: GameState, ship: Ship, reroll: boolean | undefined, hasTest = true): ValidationResult {
  if (reroll !== true) return OK;
  if (!hasTest) return reject("NO_REROLL", "There's no test to re-roll", { shipId: ship.id });
  if (rerollFor(state, ship) === undefined) return reject("NO_REROLL", `${ship.name} has no fleet commander re-roll to use`, { shipId: ship.id });
  return OK;
}
