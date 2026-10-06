/**
 * The Gothic War fleet lists (fleets book: Gothic Sector p. 35, Chaos Incursion
 * p. 232; transform §5, T58–T60, T65) and their fleet commanders (state §7.4).
 */
import type { Commander, FactionId, Mark, ShipCategory, ShipProfile } from "../state/types";

/** A commander as bought with the fleet (transform §5). */
export type CommanderConfig =
  | { kind: "admiral"; leadership: 8 | 9 | 10; extraRerolls: 0 | 1 | 2 | 3 }
  | { kind: "warmaster"; leadership: 8 | 9; marks: Mark[] }
  | { kind: "lord"; mark: Mark | null };

export type FleetList = {
  id: "gothic_sector" | "chaos_incursion";
  name: string;
  page: number;
  /** Every class the list allows. */
  classes: readonly string[];
  /** The larger hulls, each held to one per `per` of the hulls in `of` (T59, T68). */
  ratios: readonly { category: ShipCategory; per: number; of: readonly ShipCategory[] }[];
  /** The fleet commander's kind. */
  commander: "admiral" | "warmaster";
};

export const FLEET_LISTS: Partial<Record<FactionId, FleetList>> = {
  imperial_navy: {
    id: "gothic_sector",
    name: "Gothic Sector",
    page: 35,
    classes: ["lunar", "gothic", "tyrant", "dominator", "dictator", "dauntless", "mars", "overlord", "emperor", "retribution", "firestorm", "sword", "cobra"],
    ratios: [
      { category: "battlecruiser", per: 2, of: ["cruiser", "light_cruiser"] },
      { category: "battleship", per: 3, of: ["cruiser", "light_cruiser", "battlecruiser"] },
    ],
    commander: "admiral",
  },
  chaos: {
    id: "chaos_incursion",
    name: "Chaos Incursion",
    page: 232,
    classes: ["murder", "murder_lances", "carnage", "inferno", "slaughter", "devastation", "styx", "hecate", "hades", "acheron", "repulsive", "chaos_battle_barge", "despoiler", "desolator", "idolator", "infidel", "iconoclast"],
    ratios: [
      { category: "heavy_cruiser", per: 2, of: ["cruiser", "light_cruiser"] },
      { category: "grand_cruiser", per: 3, of: ["cruiser", "light_cruiser", "heavy_cruiser"] },
      { category: "battleship", per: 3, of: ["cruiser", "light_cruiser", "heavy_cruiser"] },
    ],
    commander: "warmaster",
  },
};

export const MAX_CRUISERS = 12;
const LABELS: Record<ShipCategory, string> = {
  cruiser: "cruiser",
  light_cruiser: "light cruiser",
  heavy_cruiser: "heavy cruiser",
  battlecruiser: "battlecruiser",
  grand_cruiser: "grand cruiser",
  battleship: "battleship",
  escort: "escort",
};
export const ADMIRAL_POINTS: Record<8 | 9 | 10, number> = { 8: 50, 9: 100, 10: 150 }; // Fleet-Admiral, Admiral, Solar Admiral
export const EXTRA_REROLL_POINTS = [0, 25, 75, 150] as const;
export const WARMASTER_POINTS: Record<8 | 9, number> = { 8: 50, 9: 100 };
export const LORD_POINTS = 50; // Chaos Lord, Ld 8
export const MARK_POINTS: Record<Mark, number> = { slaanesh: 25, khorne: 20, tzeentch: 30, nurgle: 35 };

const marksOf = (c: CommanderConfig): Mark[] => (c.kind === "warmaster" ? [...c.marks] : c.kind === "lord" && c.mark !== null ? [c.mark] : []);

/** What a commander costs: themselves, extra re-rolls and Marks. */
export function commanderPoints(c: CommanderConfig): number {
  const marks = marksOf(c).reduce((n, m) => n + MARK_POINTS[m], 0);
  if (c.kind === "admiral") return ADMIRAL_POINTS[c.leadership] + EXTRA_REROLL_POINTS[c.extraRerolls];
  if (c.kind === "warmaster") return WARMASTER_POINTS[c.leadership] + marks;
  return LORD_POINTS + marks;
}

/** The commander as they sit on their ship (state §7.4). */
export function buildCommander(c: CommanderConfig): Commander {
  const marks = marksOf(c);
  const tzeentch = marks.includes("tzeentch") ? 1 : 0;
  const base = c.kind === "admiral" ? 1 + c.extraRerolls : c.kind === "warmaster" ? 1 : 0;
  return { kind: c.kind, leadership: c.kind === "lord" ? 8 : c.leadership, points: commanderPoints(c), marks, rerolls: base + tzeentch };
}

/**
 * Why one side breaks its fleet list, or null (T58–T60, T65). `ships` are
 * that side's ships, as fielded, with any commander.
 */
export function fleetListProblem(faction: FactionId, ships: readonly { classId: string; profile: ShipProfile; commander?: CommanderConfig }[]): string | null {
  const list = FLEET_LISTS[faction];
  if (list === undefined) return `there's no fleet list for ${faction}`;
  const off = ships.find((s) => !list.classes.includes(s.classId));
  if (off !== undefined) return `a ${off.classId} isn't on the ${list.name} fleet list`;
  // A light cruiser is sold as a cruiser (T67): it counts towards the twelve and the ratios.
  const count = (of: readonly ShipCategory[]) => ships.filter((s) => of.includes(s.profile.category ?? "cruiser")).length;
  const cruisers = count(["cruiser", "light_cruiser"]);
  if (cruisers > MAX_CRUISERS) return `the ${list.name} list allows at most ${MAX_CRUISERS} cruisers`;
  for (const r of list.ratios) {
    const allowed = Math.floor(count(r.of) / r.per);
    if (count([r.category]) > allowed) {
      const of = r.of.includes("heavy_cruiser") ? "cruisers or heavy cruisers" : r.of.includes("battlecruiser") ? "cruisers or battlecruisers" : "cruisers";
      return `one ${LABELS[r.category]} per ${r.per === 2 ? "two" : "three"} ${of}: ${count(r.of)} ${of} allow ${allowed}`;
    }
  }

  const commanders = ships.filter((s) => s.commander !== undefined);
  const fleet = commanders.filter((s) => s.commander?.kind === list.commander);
  const lords = commanders.filter((s) => s.commander?.kind === "lord");
  if (commanders.some((s) => s.commander?.kind !== list.commander && s.commander?.kind !== "lord") || (list.commander === "admiral" && lords.length > 0)) {
    return `the ${list.name} list's commanders are ${list.commander === "admiral" ? "Admirals" : "a Warmaster and Chaos Lords"}`;
  }
  if (fleet.length > 1) return `only one ${list.commander === "admiral" ? "Admiral" : "Warmaster"}`;
  if (lords.length > 3) return "at most three Chaos Lords";
  const total = ships.reduce((n, s) => n + s.profile.points + (s.commander !== undefined ? commanderPoints(s.commander) : 0), 0);
  if (list.commander === "admiral" && fleet.length === 0 && total > 750) return `a fleet over 750 points (${total}) must have an Admiral`;
  if (list.commander === "warmaster") {
    const warmaster = fleet[0];
    if (warmaster === undefined) return "a Chaos Incursion fleet must have a Warmaster";
    const top = Math.max(...ships.map((s) => s.profile.points));
    if (warmaster.profile.points < top) return "the Warmaster goes on the most expensive ship";
  }
  for (const s of commanders) {
    const c = s.commander;
    if (c?.kind === "warmaster" && (new Set(c.marks).size !== c.marks.length || c.marks.length > 4)) return "a Warmaster's Marks are each taken once";
  }
  return null;
}
