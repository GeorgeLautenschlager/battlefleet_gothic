/** Fixtures for validator tests: the spec's example state, moved to interesting moments. */
import { expect } from "vitest";
import { validate } from "../src/validator/validate";
import { cloneJson } from "../src/state/json";
import type { Activation, BlastMarker, GameState, Phase, Ship, Step, TorpedoSalvo, Weapon } from "../src/state/types";
import type { ReasonCode } from "../src/validator/reasons";
import { specExampleState } from "./helpers";

/** The §14 example: p2 (Unclean, ship-2) is active, player turn 1. */
export function battle(phase: Phase = "movement", step: Step = "move_ships", playerTurn = 1): GameState {
  const s = specExampleState();
  s.clock = { stage: "battle", setupStep: null, playerTurn, phase, step };
  s.turnState.playerTurn = playerTurn;
  s.nextId = 1000;
  return s;
}

export const agrippa = (s: GameState): Ship => s.ships.find((x) => x.id === "ship-1")!;
export const unclean = (s: GameState): Ship => s.ships.find((x) => x.id === "ship-2")!;

/** The reducer §13 broadside geometry: Unclean (100, 50) h180, Agrippa (76, 46) h0, p2 to fire. */
export function broadside(): GameState {
  const s = battle("shooting", "direct_fire");
  unclean(s).position = { x: 100, y: 50 };
  agrippa(s).position = { x: 76, y: 46 };
  return s;
}

let counter = 500;
export const nextId = (kind: string): string => `${kind}-${counter++}`;

export function addShip(s: GameState, template: Ship, patch: Partial<Ship>): Ship {
  const ship: Ship = { ...cloneJson(template), id: nextId("ship"), ...patch };
  s.ships.push(ship);
  s.turnState.ships[ship.id] = { moved: false, drifted: false, priorityTest: null, weaponsFired: [], disengage: null, boardingDeclared: null, boarded: false, teleported: false, repaired: false };
  return ship;
}

export function addBm(s: GameState, x: number, y: number): BlastMarker {
  const bm: BlastMarker = { id: nextId("bm"), position: { x, y }, placed: 1, cause: "shield_hit" };
  s.blastMarkers.push(bm);
  return bm;
}

export function addSalvo(s: GameState, patch: Partial<TorpedoSalvo>): TorpedoSalvo {
  const salvo: TorpedoSalvo = {
    id: nextId("ord"), kind: "torpedo_salvo", owner: "p1", launchedBy: "ship-1", launched: 1,
    position: { x: 0, y: 0 }, heading: 0, strength: 6, speed: 30, width: 2.5, attacks: [], ...patch,
  };
  s.ordnance.push(salvo);
  return salvo;
}

export function ordered(shipId: string, patch: Partial<Activation> = {}): Activation {
  return {
    kind: "move", shipId, stage: "ordered", order: null, aafExtra: null, ram: null,
    maxDistance: 0, minDistance: 0, start: { position: { x: 0, y: 0 }, heading: 0 },
    distanceMoved: 0, distanceSinceTurn: 0, turnsMade: 0, truncated: false, remainingPath: [],
    slowedByBlastMarkers: false, zeroShieldBMTestDone: false, disengage: false, boardTargetId: null, ...patch,
  };
}

export const weapon = (ship: Ship, id: string): Weapon => ship.profile.weapons.find((w) => w.id === id)!;

/** Assert the validator accepts. */
export function expectOk(s: GameState, t: unknown): void {
  const result = validate(s, t);
  expect(result.ok ? "ok" : result.reason).toBe("ok");
}

/** Assert the validator rejects with `code` (and, if given, these details). */
export function expectReject(s: GameState, t: unknown, code: ReasonCode, details?: Record<string, unknown>): void {
  const result = validate(s, t);
  expect(result.ok ? "ok" : result.reason.code).toBe(code);
  if (details !== undefined && !result.ok) expect(result.reason.details).toMatchObject(details);
  if (!result.ok) expect(result.reason.message.length).toBeGreaterThan(0);
}
