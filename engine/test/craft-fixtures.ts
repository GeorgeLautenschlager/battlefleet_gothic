/**
 * Attack craft fixtures. battle(): Agrippa (ship-1, p1) at (85, 15) h0; Unclean
 * (ship-2, p2) at (100, 105) h180. carriers() refits them as a Dictator and a Devastation.
 */
import { CATALOGUE } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import type { AttackCraftWave, GameState, Squadron } from "../src/state/types";
import { agrippa, nextId, unclean } from "./validator-fixtures";

export const FURY: Squadron = { role: "fighter", name: "Fury", speed: 30 };
export const STARHAWK: Squadron = { role: "bomber", name: "Starhawk", speed: 20 };
export const SWIFTDEATH: Squadron = { role: "fighter", name: "Swiftdeath", speed: 30 };
export const DOOMFIRE: Squadron = { role: "bomber", name: "Doomfire", speed: 20 };
export const DREADCLAW: Squadron = { role: "assault_boat", name: "Dreadclaw", speed: 30 };

/** Agrippa becomes a Dictator (3 turrets, 2 + 2 bays), Unclean a Devastation (3 turrets, 2 + 2 bays). */
export function carriers(s: GameState): GameState {
  agrippa(s).profile = cloneJson(CATALOGUE["dictator"]!.profile);
  agrippa(s).loaded = { torpedoes: true, launchBays: true };
  unclean(s).profile = cloneJson(CATALOGUE["devastation"]!.profile);
  unclean(s).loaded = { launchBays: true };
  return s;
}

export function addWave(s: GameState, patch: Partial<AttackCraftWave>): AttackCraftWave {
  const wave: AttackCraftWave = {
    id: nextId("ord"), kind: "attack_craft", owner: "p1", launchedBy: "ship-1", launched: 1,
    position: { x: 0, y: 0 }, squadrons: [{ ...FURY }], cap: null, ...patch,
  };
  s.ordnance.push(wave);
  return wave;
}

/** A CAP fighter on a ship: a single fighter at its stem. */
export function addCap(s: GameState, shipId: string, squadron: Squadron = FURY): AttackCraftWave {
  const ship = s.ships.find((x) => x.id === shipId)!;
  return addWave(s, { owner: ship.owner, launchedBy: ship.id, position: { ...ship.position! }, squadrons: [{ ...squadron }], cap: ship.id });
}
