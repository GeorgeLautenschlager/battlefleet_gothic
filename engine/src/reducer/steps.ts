/**
 * Step advancement and turn boundaries (transform spec §2.3, §2.5).
 *
 * The reducer moves on from a step when `stepComplete` says so (or the player
 * sends `end_step`). Housekeeping runs on *entering* a step, so it never runs twice.
 */
import { bmTouchesBase } from "../geometry/basic";
import { emptyTurnState } from "../state/newGame";
import { activePlayer, bmsInContact, getShip, hasCritical, isDefence, isHulk, leadership, novaCannonBarred, onStandby, onTable, otherPlayer, score, squadronLd, squadronOf, victoryPoints, weaponDisabled } from "../state/derived";
import type { GameState, Ordnance, Phase, PlayerId, SetupStep, Step } from "../state/types";
import type { Ctx } from "./context";
import { anyTeleport, boardingsToFight } from "../rules/boarding";
import { grappledStayPut, grapplesFight } from "./boarding";
import { leaveGrapple } from "./grapple";
import { releaseCap } from "./cap";
import { planets } from "../rules/planets";
import { distance } from "../geometry/basic";
import { EPS } from "../geometry/constants";
import { canLaunchCraft } from "../rules/craft";
import { canArrive, eliminated, hasReserves } from "../rules/reserves";

const SETUP_ORDER: readonly SetupStep[] = [
  "roll_leadership",
  "roll_zones",
  "roll_deploy_order",
  "deploy",
  "roll_first_turn",
  "choose_first_turn",
];

/** The Bait: the bait deploys first and the pursued player goes first, so nothing else is rolled (state N55). */
const BAIT_SETUP_ORDER: readonly SetupStep[] = ["roll_leadership", "deploy"];

/** The Raiders: Leadership with the surprise roll, the defender's facing, then the defender deploys; the raiders go first. */
const RAIDERS_SETUP_ORDER: readonly SetupStep[] = ["roll_leadership", "choose_facing", "deploy"];

/** Surprise Attack: Leadership with the alert roll, the defender's units on alert, then the defender deploys; the attackers go first. */
const SURPRISE_SETUP_ORDER: readonly SetupStep[] = ["roll_leadership", "choose_alert", "deploy"];

/** Blockade Run: Leadership with the thirds, the blockader deploys then the runners, and the first turn rolled off (p. 133). */
const BLOCKADE_SETUP_ORDER: readonly SetupStep[] = ["roll_leadership", "deploy", "roll_first_turn", "choose_first_turn"];

/** Fleet Engagement replaces roll_zones with the formations and the set-up roll-off (transform §2.3). */
const ENGAGEMENT_SETUP_ORDER: readonly SetupStep[] = [
  "roll_leadership",
  "choose_formation",
  "roll_setup",
  "choose_setup",
  "roll_deploy_order",
  "deploy",
  "roll_first_turn",
  "choose_first_turn",
];

const SETUP_ORDERS: Readonly<Record<GameState["scenario"]["id"], readonly SetupStep[]>> = {
  cruiser_clash: SETUP_ORDER,
  the_bait: BAIT_SETUP_ORDER,
  raiders: RAIDERS_SETUP_ORDER,
  surprise_attack: SURPRISE_SETUP_ORDER,
  blockade_run: BLOCKADE_SETUP_ORDER,
  fleet_engagement: ENGAGEMENT_SETUP_ORDER,
};

const BATTLE_ORDER: readonly { phase: Phase; step: Step }[] = [
  { phase: "movement", step: "hulks_drift" },
  { phase: "movement", step: "move_ships" },
  { phase: "shooting", step: "direct_fire" },
  { phase: "shooting", step: "launch_ordnance" },
  { phase: "ordnance", step: "active_ordnance" },
  { phase: "ordnance", step: "inactive_ordnance" },
  { phase: "end", step: "boarding" },
  { phase: "end", step: "damage_control" },
  { phase: "end", step: "blast_marker_removal" },
];

const UNREPAIRABLE = new Set(["bridge_smashed", "shields_collapse"]);

/** Blast Markers not touching any ship on the table: the ones the End Phase may remove (p. 88). */
export function removableBlastMarkers(state: GameState): string[] {
  const ships = state.ships.filter(onTable);
  return state.blastMarkers
    .filter((bm) => !ships.some((s) => s.position !== null && bmTouchesBase(bm.position, s.position, s.profile.baseSize)))
    .map((bm) => bm.id);
}

/** Ordnance that must move in an Ordnance step: everything but CAP fighters, who stay with their ship (transform §2.3). */
const toMove = (o: Ordnance): boolean => o.kind !== "attack_craft" || o.cap === null;

/** Whether the current step has nothing left to do (transform spec §2.3, "Complete when"). */
export function stepComplete(state: GameState): boolean {
  const { clock, setup, turnState } = state;
  if (clock.stage === "setup") {
    switch (clock.setupStep) {
      case "roll_leadership":
        return setup.leadershipRolled;
      case "roll_zones":
        return setup.zones !== null;
      case "choose_formation":
        return setup.engagement !== undefined && setup.engagement.formations.p1 !== null && setup.engagement.formations.p2 !== null;
      case "roll_setup":
        return (setup.engagement?.setupChooser ?? null) !== null;
      case "choose_setup":
        return (setup.engagement?.map ?? null) !== null;
      case "choose_facing":
        return (setup.raid?.facing ?? null) !== null;
      case "choose_alert":
        return setup.surpriseAttack?.alertChosen === true;
      case "roll_deploy_order":
        return setup.firstDeployer !== null;
      case "deploy":
        return state.ships.every((s) => s.status !== "undeployed");
      case "roll_first_turn":
        return setup.firstTurnChooser !== null;
      case "choose_first_turn":
        return setup.firstPlayer !== null;
      default:
        return false;
    }
  }
  if (clock.stage !== "battle") return false;

  const active = activePlayer(state);
  const mine = state.ships.filter((s) => s.owner === active);
  const shipTurn = (id: string) => turnState.ships[id];
  const canAct = (id: string) => shipTurn(id)?.disengage !== "failed";

  switch (clock.step) {
    case "hulks_drift":
      // A stationary defence's hulk stays put (state N104).
      return mine.filter((s) => isHulk(s) && !isDefence(s)).every((s) => shipTurn(s.id)?.drifted === true);
    case "move_ships":
      // While reserves could still arrive, the step waits for them or an end_step (transform T95).
      return (
        state.activation === null &&
        mine.filter((s) => s.status === "active" && !isDefence(s)).every((s) => shipTurn(s.id)?.moved === true) &&
        !canArrive(state, active)
      );
    case "direct_fire":
      return !mine.some(
        (s) =>
          s.status === "active" &&
          !onStandby(s) &&
          canAct(s.id) &&
          s.profile.weapons.some(
            (w) =>
              (w.kind === "battery" || w.kind === "lance" || (w.kind === "nova_cannon" && novaCannonBarred(s) === null)) &&
              !(shipTurn(s.id)?.weaponsFired.includes(w.id) ?? false) &&
              !weaponDisabled(state, s, w),
          ),
      );
    case "launch_ordnance":
      return !mine.some(
        (s) =>
          s.status === "active" &&
          !onStandby(s) &&
          canAct(s.id) &&
          ((s.loaded.torpedoes === true &&
            s.profile.weapons.some(
              (w) => w.kind === "torpedoes" && !(shipTurn(s.id)?.weaponsFired.includes(w.id) ?? false) && !weaponDisabled(state, s, w),
            )) ||
            canLaunchCraft(state, s)),
      );
    case "active_ordnance":
      return state.ordnance.filter((o) => o.owner === active && toMove(o)).every((o) => turnState.ordnanceMoved.includes(o.id));
    case "inactive_ordnance":
      return state.ordnance.filter((o) => o.owner !== active && toMove(o)).every((o) => turnState.ordnanceMoved.includes(o.id));
    case "boarding":
      // Reducer §10.4: nothing left to fight and no teleport to make (or the player ends the step).
      return !state.meta.options.boarding || (boardingsToFight(state).length === 0 && !anyTeleport(state));
    case "damage_control":
      return state.ships.every(
        (s) => s.status !== "active" || !s.criticals.some((c) => !UNREPAIRABLE.has(c.kind)) || shipTurn(s.id)?.repaired === true,
      );
    case "blast_marker_removal":
      return turnState.blastMarkersRemoved || removableBlastMarkers(state).length === 0;
    default:
      return false;
  }
}

/** Leave the current step for the next one, running boundary housekeeping. */
export function advanceStep(ctx: Ctx): void {
  ctx.housekeeping(() => {
    const { state } = ctx;
    const { clock } = state;
    if (clock.stage === "setup") {
      const order = SETUP_ORDERS[state.scenario.id];
      const i = order.indexOf(clock.setupStep as SetupStep);
      const next = order[i + 1];
      if (next === undefined) {
        startBattle(ctx);
      } else {
        clock.setupStep = next;
        ctx.log("step", { setupStep: next });
      }
      return;
    }
    const i = BATTLE_ORDER.findIndex((s) => s.step === clock.step);
    const next = BATTLE_ORDER[i + 1];
    if (next === undefined) {
      defenceBlastMarkers(ctx);
      endPlayerTurn(ctx);
    }
    else enterStep(ctx, next.phase, next.step);
  });
}

function enterStep(ctx: Ctx, phase: Phase, step: Step): void {
  const { state } = ctx;
  state.clock.phase = phase;
  state.clock.step = step;
  ctx.log("step", { phase, step });
  switch (step) {
    case "move_ships":
      orbitFalls(ctx);
      alertTests(ctx);
      grappledStayPut(ctx);
      standbyStayPut(ctx);
      break;
    case "direct_fire":
      reservesGivenUp(ctx);
      break;
    case "boarding":
      grapplesFight(ctx);
      break;
    case "active_ordnance":
    case "inactive_ordnance":
      state.turnState.ordnanceMoved = [];
      break;
    case "blast_marker_removal":
      // Fires burn: each of the active player's ships with fires (transform §4.6, state N6).
      for (const ship of state.ships) {
        if (ship.owner === activePlayer(state) && ship.status === "active" && ship.criticals.some((c) => c.kind === "fire")) {
          state.queue.push({ kind: "fire_damage", shipId: ship.id });
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Surprise Attack: each of the active player's units on standby takes a Leadership test to go on alert
 * (state N78, transform T118, reducer R51), in ships order, a squadron once at its first member.
 */
function alertTests(ctx: Ctx): void {
  const { state } = ctx;
  const player = activePlayer(state);
  const tested = new Set<string>();
  for (const ship of state.ships) {
    if (ship.owner !== player || !onStandby(ship) || tested.has(ship.id)) continue;
    const sq = squadronOf(state, ship);
    const unit = (sq?.shipIds ?? [ship.id]).map((id) => getShip(state, id));
    for (const s of unit) tested.add(s.id);
    const ld = sq !== undefined ? squadronLd(state, sq) : leadership(state, ship);
    const { rolls, passed } = ctx.test(2, ld);
    if (passed) {
      for (const s of unit) {
        delete s.standby;
        const turn = state.turnState.ships[s.id];
        if (turn !== undefined) turn.alerted = true;
      }
    }
    ctx.log("alert_test", { shipIds: unit.map((s) => s.id), ...(sq !== undefined ? { squadronId: sq.id } : {}), rolls, leadership: ld, passed });
  }
}

/** Orbit Lost (state N99, transform T136, reducer R59): each of the active player's defences with it falls D6 cm toward the planet. */
function orbitFalls(ctx: Ctx): void {
  const { state } = ctx;
  const planet = planets(state)[0];
  if (planet === undefined) return;
  for (const ship of state.ships) {
    if (ship.owner !== activePlayer(state) || ship.status !== "active" || !hasCritical(ship, "orbit_lost") || ship.position === null) continue;
    const roll = ctx.d6();
    const from = ship.position;
    const gap = distance(from, planet.position);
    const toEdge = Math.max(0, gap - planet.diameter / 2);
    if (roll >= toEdge - EPS) {
      leaveGrapple(ctx, ship);
      releaseCap(ctx, ship);
      ship.status = "destroyed";
      ship.damage = ship.profile.hits;
      ship.position = null;
      ship.heading = null;
      ship.specialOrder = null;
      ctx.log("orbit_fall", { shipId: ship.id, rolls: [roll], distance: toEdge, position: null, destroyed: true });
      continue;
    }
    const f = roll / gap;
    ship.position = { x: from.x + (planet.position.x - from.x) * f, y: from.y + (planet.position.y - from.y) * f };
    ctx.log("orbit_fall", { shipId: ship.id, rolls: [roll], distance: roll, position: { ...ship.position } });
  }
}

/** In every End Phase, each stationary defence sheds D6 of the Blast Markers touching it (state N100, transform T137, reducer R60). */
function defenceBlastMarkers(ctx: Ctx): void {
  const { state } = ctx;
  for (const ship of state.ships) {
    if (!isDefence(ship) || ship.status !== "active") continue;
    const touching = bmsInContact(state, ship);
    if (touching.length === 0) continue;
    const roll = ctx.d6();
    const removed = [...touching].sort((a, b) => idNumber(a.id) - idNumber(b.id)).slice(0, roll).map((bm) => bm.id);
    state.blastMarkers = state.blastMarkers.filter((bm) => !removed.includes(bm.id));
    ctx.log("defence_blast_markers", { shipId: ship.id, rolls: [roll], removed });
  }
}

const idNumber = (id: string): number => Number(id.slice(id.lastIndexOf("-") + 1));

/** Ships still on standby stay put this Movement Phase, as grappled ones do (transform T117). */
function standbyStayPut(ctx: Ctx): void {
  const { state } = ctx;
  for (const ship of state.ships) {
    if (ship.owner !== activePlayer(state) || !onStandby(ship)) continue;
    const turn = state.turnState.ships[ship.id];
    if (turn !== undefined) turn.moved = true;
    ship.lastMove = { playerTurn: state.clock.playerTurn, distance: 0 };
  }
}

/** A player who ends their Movement with nothing on the table gives up their waiting reserves (state N52). */
function reservesGivenUp(ctx: Ctx): void {
  const { state } = ctx;
  const player = activePlayer(state);
  if (state.ships.some((s) => s.owner === player && s.status === "active") || !hasReserves(state, player)) return;
  const shipIds: string[] = [];
  for (const ship of state.ships) {
    if (ship.owner !== player || ship.status !== "reserve") continue;
    ship.status = "disengaged";
    shipIds.push(ship.id);
  }
  ctx.log("reserves_disengaged", { player, shipIds });
}

/** Leaving the last setup step: the battle begins (transform §2.5). */
function startBattle(ctx: Ctx): void {
  const { clock } = ctx.state;
  clock.stage = "battle";
  clock.setupStep = null;
  ctx.log("battle_start", { firstPlayer: ctx.state.setup.firstPlayer });
  startPlayerTurn(ctx, 1);
}

function startPlayerTurn(ctx: Ctx, playerTurn: number): void {
  const { state } = ctx;
  state.clock.playerTurn = playerTurn;
  state.turnState = emptyTurnState(playerTurn, state.ships);
  const player = activePlayer(state);
  ctx.log("turn_start", { round: Math.ceil(playerTurn / 2), player });
  // The active player's orders from their last turn expire now (p. 51).
  for (const ship of state.ships) {
    const order = ship.specialOrder;
    if (ship.owner === player && order !== null && order.expires.at === "movement_start" && order.expires.playerTurn <= playerTurn) {
      ship.specialOrder = null;
      ctx.log("order_expired", { shipId: ship.id, order: order.kind });
    }
  }
  enterStep(ctx, "movement", "hulks_drift");
}

/** Leaving blast_marker_removal: Brace expiries, then the next turn or the end of the game. */
function endPlayerTurn(ctx: Ctx): void {
  const { state } = ctx;
  const now = state.clock.playerTurn;
  for (const ship of state.ships) {
    const order = ship.specialOrder;
    if (order !== null && order.expires.at === "turn_end" && order.expires.playerTurn === now) {
      ship.specialOrder = null;
      ctx.log("order_expired", { shipId: ship.id, order: order.kind });
    }
  }
  const { maxRounds } = state.scenario;
  if (maxRounds !== null && now >= 2 * maxRounds) endGame(ctx, "rounds_complete");
  else startPlayerTurn(ctx, now + 1);
}

/** A side with no active ship left, and none waiting in reserve: the game ends at once (state D6, N52). */
export function eliminatedSide(state: GameState): PlayerId | null {
  for (const player of ["p1", "p2"] as const) if (eliminated(state, player)) return player;
  return null;
}

export function endGame(ctx: Ctx, reason: "rounds_complete" | "fleet_eliminated"): void {
  ctx.housekeeping(() => {
    const { state } = ctx;
    const scores = { p1: score(state, "p1"), p2: score(state, "p2") };
    const winner = scores.p1 === scores.p2 ? null : scores.p1 > scores.p2 ? "p1" : otherPlayer("p1");
    state.result = { reason, scores, winner };
    state.activation = null;
    state.clock = { ...state.clock, stage: "ended", setupStep: null, phase: null, step: null };
    if (state.scenario.scoring === "victory_points") {
      const breakdown = { p1: victoryPoints(state, "p1"), p2: victoryPoints(state, "p2") };
      const plain = (v: ReturnType<typeof victoryPoints>) => ({ ships: v.ships.map((x) => ({ ...x })), field: v.field });
      ctx.log("game_end", { reason, scores, winner, scoring: "victory_points", breakdown: { p1: plain(breakdown.p1), p2: plain(breakdown.p2) } });
    } else {
      ctx.log("game_end", { reason, scores, winner });
    }
  });
}
