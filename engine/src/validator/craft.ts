/** Attack craft checks (validator spec §4.2–4.4): release_cap, launch_attack_craft, move_ordnance. */
import { approxLe, baseRadius, distance } from "../geometry/basic";
import { EPS } from "../geometry/constants";
import { craftFor, waveRadius, waveSpeed } from "../rules/craft";
import { activePlayer, craftInPlay, fleetBays, isWave, launchBays, launchCapacity } from "../state/derived";
import type { AttackCraftWave, GameState, Ordnance } from "../state/types";
import type { LaunchAttackCraft, MoveOrdnance, ReleaseCap } from "../transforms/types";
import { isResult } from "./movement";
import { cm, OK, reject, type ValidationResult } from "./reasons";
import { shooter } from "./shooting";

function ownOrdnance(state: GameState, id: string, player: string): Ordnance | ValidationResult {
  const o = state.ordnance.find((x) => x.id === id);
  if (o === undefined) return reject("UNKNOWN_ORDNANCE", `No ordnance ${id}`, { ordnanceId: id });
  if (o.owner !== player) return reject("NOT_YOUR_ORDNANCE", "That ordnance isn't yours", { ordnanceId: o.id });
  return o;
}

const isOrdnance = (x: Ordnance | ValidationResult): x is Ordnance => !("ok" in x);

export function checkReleaseCap(state: GameState, t: ReleaseCap): ValidationResult {
  const o = state.ordnance.find((x) => x.id === t.ordnanceId);
  // 1–3
  if (o === undefined || !isWave(o)) return reject("UNKNOWN_ORDNANCE", `No attack craft ${t.ordnanceId}`, { ordnanceId: t.ordnanceId });
  if (o.owner !== t.player) return reject("NOT_YOUR_ORDNANCE", "Those attack craft aren't yours", { ordnanceId: o.id });
  if (o.cap === null) return reject("NOT_ON_CAP", "Those attack craft aren't on Combat Air Patrol", { ordnanceId: o.id });
  // 4: only at the start of the Movement Phase (p. 82); grappled ships were marked moved on entry
  const active = activePlayer(state);
  const moved = state.ships.some((s) => s.owner === active && s.grapple === null && state.turnState.ships[s.id]?.moved === true);
  if (state.activation !== null || moved) {
    return reject("TOO_LATE_TO_RELEASE", "CAP can only be released at the start of the Movement Phase, before any ship moves", {
      ordnanceId: o.id,
    });
  }
  return OK;
}

export function checkLaunchAttackCraft(state: GameState, t: LaunchAttackCraft): ValidationResult {
  // 1–6
  const ship = shooter(state, t.shipId, t.player);
  if (isResult(ship)) return ship;
  // 7–8
  if (launchBays(ship).length === 0) return reject("NO_LAUNCH_BAYS", `${ship.name} has no launch bays`, { shipId: ship.id });
  if (ship.loaded.launchBays !== true) {
    return reject("NOT_LOADED", `${ship.name}'s launch bays need reloading`, { shipId: ship.id });
  }
  // 9–11
  if (t.waves.length === 0 || t.waves.some((w) => w.roles.length === 0)) {
    return reject("EMPTY_WAVE", "Every wave needs at least one squadron");
  }
  for (const w of t.waves) {
    const missing = w.roles.find((role) => craftFor(ship, role) === undefined);
    if (missing !== undefined) return reject("CRAFT_NOT_CARRIED", `${ship.name}'s launch bays don't carry ${missing}s`, { role: missing });
    if (w.cap && w.roles.some((role) => role !== "fighter")) {
      return reject("CAP_NOT_FIGHTERS", "Only fighters can fly Combat Air Patrol");
    }
  }
  // 12
  const launching = t.waves.reduce((n, w) => n + w.roles.length, 0);
  const capacity = launchCapacity(ship);
  if (launching > capacity) {
    return reject("TOO_MANY_SQUADRONS", `${ship.name} can launch ${capacity} squadrons, not ${launching}`, { launching, capacity });
  }
  // 13
  const seen = new Set<string>();
  let recalled = 0;
  for (const id of t.recall) {
    const o = state.ordnance.find((x) => x.id === id);
    if (o === undefined || !isWave(o) || o.owner !== t.player || o.cap !== null || seen.has(id)) {
      return reject("INVALID_RECALL", "Recall only your own attack craft in flight, each once", { ordnanceId: id });
    }
    seen.add(id);
    recalled += o.squadrons.length;
  }
  // 14
  const inPlay = craftInPlay(state, t.player);
  const limit = fleetBays(state, t.player);
  if (inPlay - recalled + launching > limit) {
    return reject("FLEET_LIMIT", `Your fleet can have ${limit} squadrons in play; that would make ${inPlay - recalled + launching}`, {
      inPlay,
      recalled,
      launching,
      limit,
    });
  }
  return OK;
}

export function checkMoveOrdnance(state: GameState, t: MoveOrdnance): ValidationResult {
  // 1–2
  const o = ownOrdnance(state, t.ordnanceId, t.player);
  if (!isOrdnance(o)) return o;
  // 3
  if (state.turnState.ordnanceMoved.includes(o.id)) {
    return reject("ORDNANCE_ALREADY_MOVED", "That ordnance has already moved this step", { ordnanceId: o.id });
  }
  // 4
  if (o.kind === "torpedo_salvo") {
    if (t.path !== undefined || t.cap !== undefined) {
      return reject("WRONG_ORDNANCE_MOVE", "Torpedoes move straight ahead: no path or CAP", { ordnanceId: o.id });
    }
    return OK;
  }
  if (t.path === undefined) return reject("WRONG_ORDNANCE_MOVE", "Attack craft need a path (empty to stay put)", { ordnanceId: o.id });
  return checkCraftPath(state, o, t.path, t.cap);
}

function checkCraftPath(state: GameState, wave: AttackCraftWave, path: readonly { x: number; y: number }[], cap: string | undefined): ValidationResult {
  // 5: a CAP fighter moves only in its owner's part of the opponent's Ordnance Phase (p. 82)
  if (wave.cap !== null && state.clock.step !== "inactive_ordnance") {
    return reject("ON_CAP", "CAP fighters can only leave CAP in the opponent's Ordnance Phase", { ordnanceId: wave.id });
  }
  // 6
  let total = 0;
  let from = wave.position;
  for (const p of path) {
    total += distance(from, p);
    from = p;
  }
  const limit = waveSpeed(wave);
  if (!approxLe(total, limit)) {
    return reject("PATH_TOO_LONG", `That path is ${cm(total)}; the wave flies ${cm(limit)}`, { total, limit });
  }
  // 7
  const { width, height } = state.table;
  const off = path.findIndex((p) => p.x < -EPS || p.x > width + EPS || p.y < -EPS || p.y > height + EPS);
  if (off >= 0) return reject("PATH_OFF_TABLE", "Attack craft can't leave the table", { index: off });
  if (cap === undefined) return OK;
  // 8–10
  if (wave.squadrons.some((s) => s.role !== "fighter")) return reject("CAP_NOT_FIGHTERS", "Only fighters can fly Combat Air Patrol");
  const ship = state.ships.find((s) => s.id === cap);
  if (ship === undefined || ship.owner !== wave.owner || ship.status !== "active" || ship.position === null) {
    return reject("INVALID_CAP_SHIP", "CAP needs one of your own active ships", { shipId: cap });
  }
  const d = distance(from, ship.position);
  const needed = waveRadius(wave) + baseRadius(ship.profile.baseSize);
  if (!approxLe(d, needed)) return reject("NOT_IN_CONTACT", `The wave must end touching ${ship.name}'s base`, { distance: d, needed });
  return OK;
}
