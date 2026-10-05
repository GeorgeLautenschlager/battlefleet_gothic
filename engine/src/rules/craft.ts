/**
 * Attack craft helpers (state spec §10.2, transform spec §4.4) shared by the
 * validator, the reducer and the UI.
 */
import { CRAFT_RADIUS } from "../geometry/constants";
import { approxLe, baseRadius, distance } from "../geometry/basic";
import { fleetBays, launchBays, launchCapacity, waves, weaponDisabled } from "../state/derived";
import type { AttackCraftWave, CraftOption, CraftRole, GameState, Point, Ship, Squadron } from "../state/types";

/** A wave's footprint: radius CRAFT_RADIUS × √n for n markers (state N8). */
export const waveRadius = (wave: AttackCraftWave): number => CRAFT_RADIUS * Math.sqrt(wave.squadrons.length);

/** A wave moves at its slowest squadron's speed (p. 85). */
export const waveSpeed = (wave: AttackCraftWave): number => Math.min(...wave.squadrons.map((s) => s.speed));

export const isFighter = (s: Squadron): boolean => s.role === "fighter";
export const isStriker = (s: Squadron): boolean => s.role !== "fighter";

export const fighters = (wave: AttackCraftWave): number => wave.squadrons.filter(isFighter).length;
export const strikers = (wave: AttackCraftWave): number => wave.squadrons.filter(isStriker).length;

/** The ship's CAP fighters, in ordnance order. */
export const capOf = (state: GameState, shipId: string): AttackCraftWave[] => waves(state).filter((w) => w.cap === shipId);

/** The craft a ship's launch bays carry for a role, or undefined. */
export function craftFor(ship: Ship, role: CraftRole): CraftOption | undefined {
  for (const bay of launchBays(ship)) {
    const option = bay.craft?.find((c) => c.role === role);
    if (option !== undefined) return option;
  }
  return undefined;
}

/** The roles a ship's launch bays carry, in bay order. */
export function rolesCarried(ship: Ship): CraftRole[] {
  const roles: CraftRole[] = [];
  for (const bay of launchBays(ship)) for (const c of bay.craft ?? []) if (!roles.includes(c.role)) roles.push(c.role);
  return roles;
}

/** A wave's footprint, centred at `at`, touches the ship's base (inclusive). */
export function waveTouchesShip(wave: AttackCraftWave, at: Point, ship: Ship): boolean {
  return ship.position !== null && approxLe(distance(at, ship.position), waveRadius(wave) + baseRadius(ship.profile.baseSize));
}

/**
 * Whether the ship could launch attack craft now: bays loaded, unfired and not
 * disabled, some capacity, and room under the fleet limit after recalling every
 * free-flying wave (transform §4.3, used for launch_ordnance's completion).
 */
export function canLaunchCraft(state: GameState, ship: Ship): boolean {
  if (ship.status !== "active" || ship.loaded.launchBays !== true) return false;
  const turn = state.turnState.ships[ship.id];
  const bays = launchBays(ship);
  if (bays.length === 0) return false;
  if (bays.every((w) => (turn?.weaponsFired.includes(w.id) ?? false) || weaponDisabled(state, ship, w))) return false;
  if (launchCapacity(ship) === 0) return false;
  const onCap = waves(state)
    .filter((w) => w.owner === ship.owner && w.cap !== null)
    .reduce((n, w) => n + w.squadrons.length, 0);
  return onCap + 1 <= fleetBays(state, ship.owner);
}
