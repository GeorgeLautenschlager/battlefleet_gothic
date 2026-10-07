/**
 * Deploying a ship (transform `deploy_ship`): where it goes and which way it faces.
 * Most divisions set the heading; Surprise Attack's defender gives one (T116):
 * any way on full alert, broadside to the planet on standby (state N74).
 */
import { engagement, geometry, planets, type GameState, type PlayerId, type Point, type Ship, type Transform } from "@bfg/engine";

/** The defender's choices: a heading for ships on alert, and which side faces the planet for ships on standby. */
export type DeployAim = { facing: number; planetTo: "port" | "starboard" };

export const DEFAULT_AIM: DeployAim = { facing: 0, planetTo: "starboard" };

/** The ship's divisions leave the heading to the player (Surprise Attack's defender). */
export const freeHeading = (state: GameState, player: PlayerId, ship: Ship): boolean =>
  engagement.deploymentDivisions(state, player, ship).some((d) => d.heading === null);

/** Which way the ship faces if it deploys at `p`. */
export function deployHeading(state: GameState, player: PlayerId, ship: Ship, p: Point, aim: DeployAim): number {
  const divisions = engagement.deploymentDivisions(state, player, ship);
  if (!divisions.some((d) => d.heading === null)) return (divisions[engagement.divisionAt(divisions, p)] ?? divisions[0])?.heading ?? 0;
  const planet = planets.planets(state)[0];
  if (ship.standby !== true || planet === undefined) return aim.facing;
  // Broadside on: the planet's bearing a quarter turn off the bow.
  const bearing = geometry.tableBearing(p, planet.position);
  return geometry.norm(bearing + (aim.planetTo === "starboard" ? -90 : 90));
}

/** The deploy_ship transform for a click at `p`. */
export function deployAt(state: GameState, player: PlayerId, ship: Ship, p: Point, aim: DeployAim): Transform {
  const t: Transform = { type: "deploy_ship", player, shipId: ship.id, position: p };
  return freeHeading(state, player, ship) ? { ...t, heading: Math.round(deployHeading(state, player, ship, p, aim) * 1000) / 1000 % 360 } : t;
}
