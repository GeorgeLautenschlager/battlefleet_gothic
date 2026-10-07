/** Setup transforms (transform spec §4.1). */
import { otherPlayer, squadronOf } from "../../state/derived";
import { deploymentDivisions, divisionAt, isSplit, setupBonus, setupOptions } from "../../rules/engagement";
import type { ChooseAlert, ChooseFacing, ChooseFirstTurn, ChooseFormation, ChooseSetup, DeployShip } from "../../transforms/types";
import { unitShips } from "../../rules/surprise";
import type { Ctx } from "../context";
import { getShip } from "../work";

/** Starting Leadership by D6 (p. 45): 1 → 6, 2–3 → 7, 4–5 → 8, 6 → 9. */
const LEADERSHIP = [0, 6, 7, 7, 8, 8, 9] as const;

export function rollLeadership(ctx: Ctx): void {
  for (const ship of ctx.state.ships) {
    // An escort squadron rolls once, at its first member (T78); the rest share it.
    const sq = squadronOf(ctx.state, ship);
    const rolled = sq?.type === "escort" ? sq.shipIds.map((id) => getShip(ctx.state, id)).find((s) => s.leadership !== null) : undefined;
    if (rolled !== undefined) {
      ship.leadership = rolled.leadership;
      continue;
    }
    const roll = ctx.d6();
    ship.leadership = LEADERSHIP[roll] ?? 6;
    ctx.log("leadership_roll", { shipId: ship.id, rolls: [roll], leadership: ship.leadership, ...(sq?.type === "escort" ? { squadronId: sq.id } : {}) });
  }
  // The Raiders: one more D6, how many rounds the defenders are caught napping (state N61, reducer R45).
  const raid = ctx.state.setup.raid;
  if (raid !== undefined) {
    const roll = ctx.d6();
    raid.surpriseTurns = roll;
    ctx.log("surprise_roll", { rolls: [roll], turns: roll });
  }
  // Surprise Attack: one more D6, halved rounding up, for the units on full alert (state N77, reducer R50).
  const surprise = ctx.state.setup.surpriseAttack;
  if (surprise !== undefined) {
    const roll = ctx.d6();
    surprise.alertUnits = Math.ceil(roll / 2);
    ctx.log("alert_roll", { rolls: [roll], units: surprise.alertUnits });
  }
  ctx.state.setup.leadershipRolled = true;
}

/** The Raiders: the table edge the defender's fleet faces (T103). */
export function chooseFacing(ctx: Ctx, t: ChooseFacing): void {
  const raid = ctx.state.setup.raid;
  if (raid === undefined) return; // unreachable after validation
  raid.facing = t.heading;
  ctx.log("facing", { player: t.player, heading: t.heading });
}

/** Surprise Attack: the units named are on full alert; every other ship of the defender's is on standby (T115). */
export function chooseAlert(ctx: Ctx, t: ChooseAlert): void {
  const { state } = ctx;
  const surprise = state.setup.surpriseAttack;
  if (surprise === undefined) return; // unreachable after validation
  const alert = new Set(t.units.flatMap((u) => unitShips(state, u)));
  const standby: string[] = [];
  for (const ship of state.ships) {
    if (ship.owner !== t.player || alert.has(ship.id)) continue;
    ship.standby = true;
    standby.push(ship.id);
  }
  surprise.alertChosen = true;
  ctx.log("alert_choice", { player: t.player, units: [...t.units], standby });
}

export function rollZones(ctx: Ctx): void {
  const roll = ctx.d6();
  const zones = roll <= 3 ? ({ p1: "A", p2: "B" } as const) : ({ p1: "B", p2: "A" } as const);
  ctx.state.setup.zoneRoll = roll;
  ctx.state.setup.zones = { ...zones };
  ctx.log("zone_roll", { rolls: [roll], zones: { ...zones } });
}

/** Both roll; returns the lower or higher roller, or null on a tie. */
function rollOff(ctx: Ctx, winner: "lower" | "higher"): { rolls: { p1: number; p2: number }; winner: "p1" | "p2" | null } {
  const p1 = ctx.d6();
  const p2 = ctx.d6();
  if (p1 === p2) return { rolls: { p1, p2 }, winner: null };
  const p1Wins = winner === "lower" ? p1 < p2 : p1 > p2;
  return { rolls: { p1, p2 }, winner: p1Wins ? "p1" : "p2" };
}

export function rollDeployOrder(ctx: Ctx): void {
  const result = rollOff(ctx, "lower");
  ctx.state.setup.deployOrderRolls.push(result.rolls);
  if (result.winner !== null) ctx.state.setup.firstDeployer = result.winner;
  ctx.log("deploy_order_roll", { rolls: [result.rolls.p1, result.rolls.p2], winner: result.winner });
}

export function deployShip(ctx: Ctx, t: DeployShip): void {
  const { state } = ctx;
  const ship = getShip(state, t.shipId);
  const divisions = deploymentDivisions(state, t.player, ship);
  ship.status = "active";
  ship.position = { ...t.position };
  // The division's heading: Cruiser Clash's zone facing, or the map's arrow (p. 142); Surprise Attack's defender gives one (T116).
  ship.heading = divisions[divisionAt(divisions, t.position)]?.heading ?? t.heading ?? 0;
  ctx.log("deploy", { shipId: ship.id, position: { ...t.position }, heading: ship.heading });
}

// --- Fleet Engagement (pp. 142–143)

/** A formation, on the honour system (state N16). The first pick's log entry doesn't name it (T50). */
export function chooseFormation(ctx: Ctx, t: ChooseFormation): void {
  const engagement = ctx.state.setup.engagement;
  if (engagement === undefined) return; // unreachable after validation
  engagement.formations[t.player] = t.formation;
  const { p1, p2 } = engagement.formations;
  if (p1 === null || p2 === null) {
    ctx.log("formation", { player: t.player });
    return;
  }
  const options = setupOptions(ctx.state).map((o) => ({ map: o.map, colours: { ...o.colours } }));
  ctx.log("formation", { player: t.player, formations: { p1, p2 }, options });
}

/** Both roll D6, plus the bonuses on a split; the higher total picks the set-up, ties re-roll (T51). */
export function rollSetup(ctx: Ctx): void {
  const engagement = ctx.state.setup.engagement;
  if (engagement === undefined) return;
  const rolls = { p1: ctx.d6(), p2: ctx.d6() };
  const bonus = { p1: setupBonus(ctx.state, "p1"), p2: setupBonus(ctx.state, "p2") };
  const totals = { p1: rolls.p1 + bonus.p1, p2: rolls.p2 + bonus.p2 };
  const winner = totals.p1 === totals.p2 ? null : totals.p1 > totals.p2 ? "p1" : "p2";
  engagement.setupRolls.push({ rolls, bonus });
  if (winner !== null) engagement.setupChooser = winner;
  ctx.log("setup_roll", {
    rolls: [rolls.p1, rolls.p2],
    bonus: [bonus.p1, bonus.p2],
    totals: [totals.p1, totals.p2],
    split: isSplit(ctx.state),
    winner,
  });
}

/** The roll-off's winner picks the map and their colour; the other player takes the other colour (T52). */
export function chooseSetup(ctx: Ctx, t: ChooseSetup): void {
  const engagement = ctx.state.setup.engagement;
  if (engagement === undefined) return;
  const theirs = t.colour === "white" ? "dark" : "white";
  engagement.map = t.map;
  engagement.colours = t.player === "p1" ? { p1: t.colour, p2: theirs } : { p1: theirs, p2: t.colour };
  ctx.log("setup_choice", { player: t.player, map: t.map, colours: { ...engagement.colours } });
}

export function rollFirstTurn(ctx: Ctx): void {
  const result = rollOff(ctx, "higher");
  ctx.state.setup.firstTurnRolls.push(result.rolls);
  if (result.winner !== null) ctx.state.setup.firstTurnChooser = result.winner;
  ctx.log("first_turn_roll", { rolls: [result.rolls.p1, result.rolls.p2], winner: result.winner });
}

export function chooseFirstTurn(ctx: Ctx, t: ChooseFirstTurn): void {
  const firstPlayer = t.goFirst ? t.player : otherPlayer(t.player);
  ctx.state.setup.firstPlayer = firstPlayer;
  ctx.log("first_turn_choice", { firstPlayer });
}
