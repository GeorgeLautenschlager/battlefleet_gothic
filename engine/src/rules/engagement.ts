/**
 * Fleet Engagement's set-up (pp. 142–143; state §4–§5, §11): the formation
 * table, the four set-up maps and their divisions, and where each player deploys.
 */
import { EPS } from "../geometry/constants";
import { otherPlayer, squadronOf } from "../state/derived";
import { RUNNERS_ZONE, thirdRect } from "./blockade";
import { BAIT_DIVISIONS, pursuedPlayer, RAIDERS_ZONE } from "./reserves";
import { ALERT_ZONE } from "./surprise";
import type { Colour, Formation, GameState, PlayerId, Point, Rect, SetupMap, Ship } from "../state/types";

/** A division: a rectangle (bottom-left corner) for stems, and the heading its ships face, or null when the deployer gives one (Surprise Attack, T116). */
export type Division = { rect: Rect; heading: number | null };

const div = (x: number, y: number, width: number, height: number, heading: number): Division => ({ rect: { x, y, width, height }, heading });

/** The set-up maps (state §4, N15): white along the top edge, dark grey along the bottom and sides. */
export const SETUP_MAPS: Readonly<Record<SetupMap, Readonly<Record<Colour, readonly Division[]>>>> = {
  A: {
    white: [div(60, 90, 60, 30, 180)],
    dark: [div(0, 0, 30, 120, 45), div(30, 0, 120, 30, 0), div(150, 0, 30, 120, 315)],
  },
  B: {
    white: [div(0, 90, 67.5, 30, 90), div(67.5, 90, 45, 30, 90), div(112.5, 90, 67.5, 30, 90)],
    dark: [div(0, 0, 67.5, 30, 270), div(67.5, 0, 45, 30, 270), div(112.5, 0, 67.5, 30, 270)],
  },
  C: {
    white: [div(60, 75, 60, 45, 180)],
    dark: [div(0, 0, 30, 120, 0), div(150, 0, 30, 120, 0)],
  },
  D: {
    white: [div(45, 90, 90, 30, 180)],
    dark: [div(0, 0, 60, 30, 0), div(60, 0, 60, 30, 0), div(120, 0, 60, 30, 0)],
  },
};

/** Your formation's row, the opponent's column (p. 142): "B", or the two set-ups on offer as a map and your colour. */
const FORMATION_TABLE: Readonly<Record<Formation, Readonly<Record<Formation, "B" | readonly [SetupMap, Colour][]>>>> = {
  sphere: { sphere: "B", wedge: [["A", "dark"], ["C", "dark"]], cross: [["A", "dark"], ["D", "dark"]] },
  wedge: { sphere: [["A", "white"], ["C", "white"]], wedge: [["D", "dark"], ["D", "white"]], cross: "B" },
  cross: { sphere: [["A", "white"], ["D", "white"]], wedge: "B", cross: "B" },
};

export type SetupOption = { map: SetupMap; colours: { p1: Colour; p2: Colour } };

const other = (c: Colour): Colour => (c === "white" ? "dark" : "white");
const coloursFor = (p1: Colour) => ({ p1, p2: other(p1) });

function tableEntry(state: GameState): "B" | readonly [SetupMap, Colour][] | null {
  const f = state.setup.engagement?.formations;
  if (f === undefined || f.p1 === null || f.p2 === null) return null;
  return FORMATION_TABLE[f.p1][f.p2];
}

/** The two set-ups on offer, from p1's row: a split, or B with each colour (state N19). Empty until both formations are in. */
export function setupOptions(state: GameState): SetupOption[] {
  const entry = tableEntry(state);
  if (entry === null) return [];
  if (entry === "B") return [{ map: "B", colours: coloursFor("white") }, { map: "B", colours: coloursFor("dark") }];
  return entry.map(([map, colour]) => ({ map, colours: coloursFor(colour) }));
}

/** A split result (p. 142): the table offered two set-ups, which takes the roll-off bonuses. A plain B isn't one. */
export const isSplit = (state: GameState): boolean => {
  const entry = tableEntry(state);
  return entry !== null && entry !== "B";
};

/**
 * The roll-off bonus on a split (p. 142): +1 for the fastest ship, faster than
 * any enemy's; +1 for the better fleet commander (N46); +1 for more escorts.
 */
export function setupBonus(state: GameState, player: PlayerId): number {
  if (!isSplit(state)) return 0;
  const mine = state.ships.filter((s) => s.owner === player);
  const theirs = state.ships.filter((s) => s.owner === otherPlayer(player));
  const fastest = (ships: typeof mine) => Math.max(0, ...ships.map((s) => s.profile.speed));
  const escorts = (ships: typeof mine) => ships.filter((s) => s.profile.type === "escort").length;
  // An Admiral or the Warmaster, at the Leadership they were bought with; none counts as 0 (N46).
  const admiral = (ships: typeof mine) =>
    Math.max(0, ...ships.map((s) => (s.commander != null && s.commander.kind !== "lord" ? s.commander.leadership : 0)));
  return (
    (fastest(mine) > fastest(theirs) ? 1 : 0) + (admiral(mine) > admiral(theirs) ? 1 : 0) + (escorts(mine) > escorts(theirs) ? 1 : 0)
  );
}

/**
 * Where a player deploys (state §11): Cruiser Clash's zone, their colour's divisions on the Fleet Engagement map, or The Bait's (§4).
 * Surprise Attack's defender: the whole table for `ship` on standby, otherwise the alert zone, with no heading of their own.
 */
export function deploymentDivisions(state: GameState, player: PlayerId, ship?: Ship): readonly Division[] {
  if (state.scenario.id === "blockade_run") {
    if (player === state.scenario.attacker) return [{ rect: { ...RUNNERS_ZONE }, heading: 0 }];
    // The blockader: the ship's unit's third, or every third a unit rolled (state §4, N82, N84).
    const thirds = state.setup.blockade?.thirds ?? null;
    if (thirds === null) return [];
    const mine = ship === undefined ? Object.values(thirds) : [thirds[squadronOf(state, ship)?.id ?? ship.id]].flatMap((k) => (k === undefined ? [] : [k]));
    return [...new Set(mine)].sort().map((k) => ({ rect: thirdRect(k), heading: null }));
  }
  if (state.scenario.id === "surprise_attack") {
    if (player === state.scenario.attacker) return [];
    const { width, height } = state.table;
    return [{ rect: ship?.standby === true ? { x: 0, y: 0, width, height } : { ...ALERT_ZONE }, heading: null }];
  }
  if (state.scenario.id === "the_bait") return player === pursuedPlayer(state) ? BAIT_DIVISIONS.pursued : BAIT_DIVISIONS.pursuers;
  if (state.scenario.id === "raiders") {
    const facing = state.setup.raid?.facing ?? null;
    return player === state.scenario.attacker || facing === null ? [] : [{ rect: { ...RAIDERS_ZONE }, heading: facing }];
  }
  const engagement = state.setup.engagement;
  if (engagement !== undefined) {
    if (engagement.map === null || engagement.colours === null) return [];
    return SETUP_MAPS[engagement.map][engagement.colours[player]];
  }
  const zone = state.setup.zones?.[player];
  const rect = zone === undefined ? undefined : state.scenario.deploymentZones?.[zone];
  const heading = zone === undefined ? undefined : state.scenario.deploymentFacing?.[zone];
  return rect === undefined || heading === undefined ? [] : [{ rect, heading }];
}

const inRect = (r: Rect, p: Point): boolean =>
  p.x >= r.x - EPS && p.x <= r.x + r.width + EPS && p.y >= r.y - EPS && p.y <= r.y + r.height + EPS;

/** The first division holding a stem (the first in list order on a shared edge, state N18), or -1. */
export const divisionAt = (divisions: readonly Division[], p: Point): number => divisions.findIndex((d) => inRect(d.rect, p));

/** Indexes of the player's divisions that none of their deployed ships stands in (validator V13). */
export function emptyDivisions(state: GameState, player: PlayerId): number[] {
  const divisions = deploymentDivisions(state, player);
  const used = new Set(
    state.ships.filter((s) => s.owner === player && s.position !== null && s.status !== "undeployed").map((s) => divisionAt(divisions, s.position as Point)),
  );
  return divisions.map((_, i) => i).filter((i) => !used.has(i));
}
