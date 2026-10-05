/** Turret dice, own and massed (reducer spec §9.3, transform T23–T24). */
import { MAX_MASSED_TURRETS } from "../geometry/constants";
import { basesTouch } from "../geometry/basic";
import { isCrippled, turrets } from "../state/derived";
import type { GameState, Ship, TurretTarget } from "../state/types";

/** Turrets fire at torpedoes or attack craft in a phase, never both (p. 80). */
function free(state: GameState, ship: Ship, against: TurretTarget): boolean {
  const used = state.turnState.ships[ship.id]?.turrets ?? null; // absent in older saves
  return used === null || used.phase !== state.clock.phase || used.against === against;
}

/**
 * The dice a target's turrets roll: its own, if they're free for this kind of
 * ordnance, plus one per friendly ship massing for it (never in the Movement
 * Phase), up to 3. Marks every ship whose turrets fire (R19).
 */
export function turretDice(state: GameState, target: Ship, against: TurretTarget): { own: number; massed: string[]; dice: number } {
  const own = free(state, target, against) ? turrets(target) : 0;
  let helpers: Ship[] = [];
  const at = target.position;
  if (state.clock.phase !== "movement" && target.status === "active" && at !== null) {
    helpers = state.ships
      .filter(
        (x) =>
          x.id !== target.id &&
          x.owner === target.owner &&
          x.status === "active" &&
          !isCrippled(x) &&
          turrets(x) > 0 &&
          x.position !== null &&
          basesTouch(x.position, x.profile.baseSize, at, target.profile.baseSize) &&
          free(state, x, against),
      )
      .slice(0, MAX_MASSED_TURRETS);
  }
  const phase = state.clock.phase;
  if (phase !== null) {
    for (const x of own > 0 ? [target, ...helpers] : helpers) {
      const entry = state.turnState.ships[x.id];
      if (entry !== undefined) entry.turrets = { phase, against };
    }
  }
  return { own, massed: helpers.map((h) => h.id), dice: own + helpers.length };
}
