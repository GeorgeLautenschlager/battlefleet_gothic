/**
 * Placing the planet holder's mines and minefields (transform `place_defence`, T143–T146):
 * what goes next, and the transform for a click on the table.
 */
import { minefields, type GameState, type PlayerId, type Point, type Rect, type Transform } from "@bfg/engine";

export type PlaceKind = "orbital_mine" | "minefield";
/** What the holder is placing: a mine, or the next minefield, turned a quarter or not. */
export type PlaceAim = { kind: PlaceKind; turned: boolean };

export const DEFAULT_PLACE: PlaceAim = { kind: "minefield", turned: false };

/** What's left to place: mines, and the minefields' sizes in the order they go. */
export function leftToPlace(state: GameState): { mines: number; fields: { width: number; height: number }[] } {
  const left = state.setup.emplacements?.unplaced;
  return { mines: left?.orbitalMines ?? 0, fields: left?.minefields ?? [] };
}

/** The kind the aim asks for, or the other one if none of that kind is left. */
export function kindFor(state: GameState, aim: PlaceAim): PlaceKind {
  const { mines, fields } = leftToPlace(state);
  if (aim.kind === "minefield" && fields.length === 0) return "orbital_mine";
  if (aim.kind === "orbital_mine" && mines === 0) return "minefield";
  return aim.kind;
}

/** The place_defence transform for a click at `p`. */
export function placeAt(state: GameState, player: PlayerId, aim: PlaceAim, p: Point): Transform {
  const kind = kindFor(state, aim);
  return { type: "place_defence", player, kind, position: p, ...(kind === "minefield" && aim.turned ? { turned: true } : {}) };
}

/** The rectangle the next minefield would cover centred at `p`, or null when it's a mine. */
export function fieldAt(state: GameState, aim: PlaceAim, p: Point): Rect | null {
  const size = leftToPlace(state).fields[0];
  return kindFor(state, aim) !== "minefield" || size === undefined ? null : minefields.minefieldRect(size, p, aim.turned);
}
