/** Setup transforms (transform spec §4.1). */
import { otherPlayer } from "../../state/derived";
import type { ChooseFirstTurn, DeployShip } from "../../transforms/types";
import type { Ctx } from "../context";
import { getShip } from "../work";

/** Starting Leadership by D6 (p. 45): 1 → 6, 2–3 → 7, 4–5 → 8, 6 → 9. */
const LEADERSHIP = [0, 6, 7, 7, 8, 8, 9] as const;

export function rollLeadership(ctx: Ctx): void {
  for (const ship of ctx.state.ships) {
    const roll = ctx.d6();
    ship.leadership = LEADERSHIP[roll] ?? 6;
    ctx.log("leadership_roll", { shipId: ship.id, rolls: [roll], leadership: ship.leadership });
  }
  ctx.state.setup.leadershipRolled = true;
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
  const zone = state.setup.zones?.[t.player] ?? "A";
  ship.status = "active";
  ship.position = { ...t.position };
  ship.heading = state.scenario.deploymentFacing[zone];
  ctx.log("deploy", { shipId: ship.id, position: { ...t.position }, heading: ship.heading });
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
