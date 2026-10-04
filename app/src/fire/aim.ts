import { activePlayer, weaponDisabled, type GameState, type Ship, type Weapon } from "@bfg/engine";

/** The weapon a player has picked up in the current shooting step. */
export type Aim = { shipId: string; weaponId: string; playerTurn: number; step: string };

/** The aim if it still applies: same turn and step, the weapon unfired, usable, and the ship still active. */
export function liveAim(state: GameState, aim: Aim | null): { ship: Ship; weapon: Weapon } | null {
  if (aim === null || state.pending.length > 0) return null;
  if (aim.playerTurn !== state.clock.playerTurn || aim.step !== state.clock.step) return null;
  const ship = state.ships.find((s) => s.id === aim.shipId);
  const weapon = ship?.profile.weapons.find((w) => w.id === aim.weaponId);
  if (ship === undefined || weapon === undefined || ship.status !== "active" || ship.owner !== activePlayer(state)) return null;
  if (state.turnState.ships[ship.id]?.weaponsFired.includes(weapon.id) === true || weaponDisabled(state, ship, weapon)) return null;
  return { ship, weapon };
}
