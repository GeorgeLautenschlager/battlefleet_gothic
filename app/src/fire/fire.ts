/**
 * Shooting helpers for the UI: which targets a weapon can take, the arc /
 * aspect choices the validator asks for, and torpedo bearings. Legality is
 * always the engine's; this only enumerates candidates and asks it.
 */
import { effectiveStrength, formation, geometry, inFormation, novaScatterDice, onTable, squadronOf, targeting, validate, weaponDisabled } from "@bfg/engine";
import { mm } from "../table/view";
import type { Fire, FireNovaCannon, GameState, Point, Quadrant, Ship, Transform, Weapon } from "@bfg/engine";

/** Each quadrant's bearings off the bow, as [from, to] clockwise (aviation style). */
export const QUADRANT_SPAN: Record<Quadrant, [number, number]> = {
  front: [-45, 45],
  right: [45, 135],
  rear: [135, 225],
  left: [225, 315],
};

const QUADRANT_NAMES: Record<Quadrant, string> = { front: "prow", right: "starboard", rear: "aft", left: "port" };
export const quadrantName = (q: Quadrant): string => QUADRANT_NAMES[q];

export type FireOption = { transform: Fire; label: string };
export type TargetChoice = {
  kind: "ship" | "ordnance";
  id: string;
  name: string;
  distance: number;
  /** Legal ways to fire at it (more than one when an arc or aspect must be chosen), or why not. */
  options: FireOption[];
  reason: string | null;
};

/**
 * Every legal complete `fire` for this weapon and target. The validator asks
 * for an arc or aspect only when the target sits on a boundary; then each
 * option it offers becomes a choice.
 */
export function fireOptions(state: GameState, base: Fire): FireOption[] | { reason: string } {
  const v = validate(state, base);
  if (v.ok) return [{ transform: base, label: "Fire" }];
  const { code, message, details } = v.reason;
  const offered = Array.isArray(details?.["options"]) ? (details["options"] as Quadrant[]) : [];
  if (code === "ARC_CHOICE_REQUIRED" || code === "ASPECT_CHOICE_REQUIRED") {
    const key = code === "ARC_CHOICE_REQUIRED" ? "arc" : "aspect";
    const out: FireOption[] = [];
    for (const q of offered) {
      const next = fireOptions(state, { ...base, [key]: q });
      if (Array.isArray(next)) {
        const what = key === "arc" ? `from the ${quadrantName(q)} arc` : `at its ${quadrantName(q)}`;
        out.push(...next.map((o) => ({ transform: o.transform, label: o.label === "Fire" ? `Fire ${what}` : `${o.label}, ${what}` })));
      }
    }
    return out.length > 0 ? out : { reason: message };
  }
  return { reason: message };
}

/**
 * The same shots with every other ready battery that can join them in one
 * volley (T32), offered first: firepower adds up before the Gunnery Table.
 */
export function withVolleys(state: GameState, ship: Ship, weapon: Weapon, options: FireOption[]): FireOption[] {
  if (weapon.kind !== "battery") return options;
  const fired = state.turnState.ships[ship.id]?.weaponsFired ?? [];
  const others = ship.profile.weapons.filter((w) => w.kind === "battery" && w.id !== weapon.id && !fired.includes(w.id) && !weaponDisabled(state, ship, w));
  const out: FireOption[] = [];
  for (const o of options) {
    const joining = others.filter((w) => validate(state, { ...o.transform, combineWith: [w.id] }).ok);
    if (joining.length > 0) {
      const transform = { ...o.transform, combineWith: joining.map((w) => w.id) };
      if (validate(state, transform).ok) {
        const fp = [weapon, ...joining].reduce((n, w) => n + effectiveStrength(ship, w), 0);
        const label = o.label === "Fire" ? `Fire with ${joining.map((w) => w.name).join(" and ")} (${fp})` : `${o.label}, with ${joining.length} more (${fp})`;
        out.push({ transform, label });
      }
    }
    out.push(o);
  }
  return out;
}

/**
 * The same shots with every squadron-mate's ready weapon of this kind that can
 * join (T84), offered first: a squadron combines its fire (p. 99).
 */
export function withSquadron(state: GameState, ship: Ship, weapon: Weapon, options: FireOption[]): FireOption[] {
  const sq = squadronOf(state, ship);
  if (sq === undefined || !inFormation(state, ship)) return options;
  const mates = formation(state, sq).filter((m) => m.id !== ship.id);
  const out: FireOption[] = [];
  for (const o of options) {
    if (o.transform.target.kind !== "ship") {
      out.push(o);
      continue;
    }
    const fired = (m: Ship) => state.turnState.ships[m.id]?.weaponsFired ?? [];
    const joining = mates.flatMap((m) => {
      const ids = m.profile.weapons
        .filter((w) => w.kind === weapon.kind && !fired(m).includes(w.id) && !weaponDisabled(state, m, w))
        .filter((w) => validate(state, { ...o.transform, withShips: [{ shipId: m.id, weaponIds: [w.id] }] }).ok)
        .map((w) => w.id);
      return ids.length > 0 ? [{ shipId: m.id, weaponIds: ids }] : [];
    });
    if (joining.length > 0) {
      const transform = { ...o.transform, withShips: joining };
      if (validate(state, transform).ok) {
        const names = joining.map((j) => mates.find((m) => m.id === j.shipId)?.name ?? j.shipId).join(", ");
        out.push({ transform, label: `${o.label === "Fire" ? "Squadron volley" : `${o.label}, squadron volley`} with ${names}` });
      }
    }
    out.push(o);
  }
  return out;
}

const ASPECTS = [
  { id: "closing", name: "closing" },
  { id: "moving_away", name: "moving away" },
  { id: "abeam", name: "abeam" },
] as const;

/** At a squadron, each aspect its ships in reach show is a choice (T85): the attacker picks which to fire at. */
export function withAspects(state: GameState, options: FireOption[]): FireOption[] {
  const out: FireOption[] = [];
  for (const o of options) {
    const target = o.transform.target.kind === "ship" ? state.ships.find((s) => s.id === o.transform.target.id) : undefined;
    const squadron = target !== undefined && targeting.squadronTarget(state, target) !== null;
    const shown = squadron ? ASPECTS.filter((a) => validate(state, { ...o.transform, targetAspect: a.id }).ok) : [];
    if (shown.length < 2) {
      out.push(o);
      continue;
    }
    for (const a of shown) out.push({ transform: { ...o.transform, targetAspect: a.id }, label: `${o.label}, at its ${a.name} ships` });
  }
  return out;
}

/** Enemy ships and salvos this weapon might shoot at, nearest first, each with its options or the reason it can't. */
export function targets(state: GameState, ship: Ship, weapon: Weapon): TargetChoice[] {
  const from = ship.position;
  if (from === null) return [];
  const base = { type: "fire", player: ship.owner, shipId: ship.id, weaponId: weapon.id } as const;
  const out: TargetChoice[] = [];
  for (const s of state.ships) {
    if (s.owner === ship.owner || !onTable(s) || s.position === null) continue;
    const r = fireOptions(state, { ...base, target: { kind: "ship", id: s.id } });
    const options = Array.isArray(r) ? withAspects(state, withSquadron(state, ship, weapon, withVolleys(state, ship, weapon, r))) : [];
    out.push({ kind: "ship", id: s.id, name: s.name, distance: geometry.distance(from, s.position), options, reason: Array.isArray(r) ? null : r.reason });
  }
  for (const o of state.ordnance) {
    if (o.owner === ship.owner || (o.kind === "attack_craft" && o.cap !== null)) continue; // CAP can't be shot at
    const launcher = state.ships.find((s) => s.id === o.launchedBy)?.name;
    const r = fireOptions(state, { ...base, target: { kind: "ordnance", id: o.id } });
    const options = Array.isArray(r) ? withVolleys(state, ship, weapon, r) : [];
    out.push({
      kind: "ordnance",
      id: o.id,
      name: `${launcher ? `${launcher}'s ` : ""}${o.kind === "torpedo_salvo" ? `torpedoes (${o.strength})` : o.squadrons.map((q) => q.name).join(", ")}`,
      distance: geometry.distance(from, o.position),
      options,
      reason: Array.isArray(r) ? null : r.reason,
    });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// --- Torpedoes

const signed = (b: number) => (b > 180 ? b - 360 : b);
const norm = (b: number) => ((b % 360) + 360) % 360;

/** Whether a bearing off the bow lies in one of the arcs (boundaries included). */
export function inArcs(bearing: number, arcs: readonly Quadrant[]): boolean {
  return arcs.some((q) => {
    const [from, to] = QUADRANT_SPAN[q];
    const rel = norm(bearing - from);
    return rel <= to - from;
  });
}

/** The bearing in the arcs closest to `bearing`: itself if it's inside, else the nearest arc edge. */
export function clampToArcs(bearing: number, arcs: readonly Quadrant[]): number {
  const b = norm(Math.round(bearing));
  if (arcs.length === 0 || inArcs(b, arcs)) return b;
  const edges = arcs.flatMap((q) => QUADRANT_SPAN[q].map(norm));
  const gap = (e: number) => Math.abs(signed(norm(e - b)));
  return edges.reduce((best, e) => (gap(e) < gap(best) ? e : best));
}

/** Launch bearing (off the bow, integer degrees in [0, 360)) toward a table point, clamped into the weapon's arcs. */
export function bearingToward(ship: Ship, weapon: Weapon, point: Point): number {
  if (ship.position === null || ship.heading === null) return 0;
  return clampToArcs(geometry.relBearing(ship.position, ship.heading, point), weapon.arcs);
}

export const launch = (ship: Ship, weapon: Weapon, bearing: number): Transform => ({
  type: "launch_torpedoes",
  player: ship.owner,
  shipId: ship.id,
  weaponId: weapon.id,
  bearing,
});

/** "12° to starboard", "dead ahead"… */
export function describeBearing(b: number): string {
  const s = signed(norm(b));
  if (s === 0) return "dead ahead";
  return `${Math.abs(s)}° to ${s > 0 ? "starboard" : "port"}`;
}

// --- Nova cannon

export const novaShot = (ship: Ship, weapon: Weapon, aim: Point): FireNovaCannon => ({
  type: "fire_nova_cannon",
  player: ship.owner,
  shipId: ship.id,
  weaponId: weapon.id,
  aim: mm(aim),
});

/** Range to the template's near edge, and how many D6 it scatters from there (p. 63). */
export function novaReach(ship: Ship, aim: Point): { range: number; dice: number } {
  const range = targeting.novaRange(ship, aim);
  return { range, dice: novaScatterDice(range) };
}

/** Enemy ships to drop the template on, nearest first, each with the shot or the reason it can't be made. */
export function novaTargets(state: GameState, ship: Ship, weapon: Weapon): { id: string; name: string; range: number; shot: FireNovaCannon | null; reason: string | null }[] {
  if (ship.position === null) return [];
  return state.ships
    .filter((s) => s.owner !== ship.owner && onTable(s) && s.position !== null)
    .map((s) => {
      const shot = novaShot(ship, weapon, s.position as Point);
      const v = validate(state, shot);
      return { id: s.id, name: s.name, range: targeting.novaRange(ship, shot.aim), shot: v.ok ? shot : null, reason: v.ok ? null : v.reason.message };
    })
    .sort((a, b) => a.range - b.range);
}
