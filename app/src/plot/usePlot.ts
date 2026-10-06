/**
 * The plotter's state: the path being built for the ship that's moving, the
 * pointer preview on top of it, and the engine's verdict on both.
 */
import { useEffect, useState } from "react";
import { activePlayer, geometry, squadronOf, type GameState, type PathStep, type Point, type Ship, type Transform } from "@bfg/engine";
import { pick } from "../game/pick";
import { append, judge, propose, stats, type PlotStats, type Verdict } from "./plot";

type Plan = { shipId: string; playerTurn: number; path: PathStep[]; disengage: boolean; board: string | null };

export type Plot = {
  ship: Ship;
  path: PathStep[];
  /** What a click at the pointer would add. */
  preview: PathStep[];
  stats: PlotStats;
  /** Stats including the preview. */
  previewStats: PlotStats;
  verdict: Verdict;
  previewVerdict: Verdict;
  disengage: boolean;
  setDisengage: (on: boolean) => void;
  /** Enemy ships the path ends touching, which the move could board (boarding on only). */
  boardable: Ship[];
  /** The ship this move boards, if one is picked and the path still ends touching it. */
  board: string | null;
  setBoard: (id: string | null) => void;
  click: (p: Point, straight: boolean) => void;
  /** Add a typed step. */
  add: (step: PathStep) => void;
  back: () => void;
  clear: () => void;
  fullAhead: () => void;
  commit: () => void;
};

/**
 * Ships the active player may pick to move next: none once one has declared an order (it must move first),
 * and only a squadron's own members while it's part-way through its move (state N37).
 */
export function movableShips(state: GameState): Ship[] {
  if (state.clock.stage !== "battle" || state.clock.step !== "move_ships" || state.pending.length > 0 || state.activation !== null) return [];
  const player = activePlayer(state);
  const members = state.turnState.squadronMove?.members ?? null;
  return state.ships.filter(
    (s) => s.owner === player && s.status === "active" && state.turnState.ships[s.id]?.moved !== true && (members === null || members.includes(s.id)),
  );
}

/** The ship the active player is plotting, if any: the one with an order, else the one picked (`focus`), else the first. */
export function plottingShip(state: GameState, focus: string | null = null): Ship | null {
  if (state.clock.stage !== "battle" || state.clock.step !== "move_ships" || state.pending.length > 0) return null;
  const open = state.activation;
  if (open !== null) return open.stage === "ordered" ? (state.ships.find((s) => s.id === open.shipId) ?? null) : null;
  return pick(movableShips(state), focus) ?? null;
}

export function usePlot(state: GameState | null, pointer: Point | null, straight: boolean, run: (t: Transform) => Promise<boolean>, focus: string | null = null): Plot | null {
  const [plan, setPlan] = useState<Plan | null>(null);
  const ship = state === null ? null : plottingShip(state, focus);

  const current = state !== null && ship !== null && plan?.shipId === ship.id && plan.playerTurn === state.clock.playerTurn ? plan : null;
  const path = current?.path ?? [];
  // A disengaging escort squadron's members, and those following a squadron-mate that asked, start with it ticked (state N41).
  const sq = state === null || ship === null ? undefined : squadronOf(state, ship);
  const sm = state?.turnState.squadronMove ?? null;
  const disengage = current?.disengage ?? (sq?.disengaging === true || (sq?.type === "escort" && sm?.squadronId === sq.id && sm.disengage === true));
  const picked = current?.board ?? null;

  const update = (patch: Partial<Plan>) => {
    if (state === null || ship === null) return;
    setPlan({ shipId: ship.id, playerTurn: state.clock.playerTurn, path, disengage, board: picked, ...patch });
  };

  const st = state === null || ship === null ? null : stats(state, ship, path);
  const preview = state === null || ship === null || pointer === null ? [] : propose(state, ship, path, pointer, straight);

  const boardable = state === null || ship === null || st === null ? [] : boardableAt(state, ship, st.end.position);
  const board = boardable.some((s) => s.id === picked) ? picked : null;
  const move = (p: PathStep[], withBoard = true): Transform => ({
    type: "move",
    player: ship?.owner ?? "p1",
    shipId: ship?.id ?? "",
    path: p,
    disengage,
    ...(withBoard && board !== null ? { boardTargetId: board } : {}),
  });

  // Keyboard: Backspace steps back, Escape clears, Enter moves.
  const committable = state !== null && ship !== null && judge(state, move(path)).kind === "ok";
  useEffect(() => {
    if (ship === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(el.tagName)) return;
      if (e.key === "Backspace") setPlan((p) => (p === null ? p : { ...p, path: p.path.slice(0, -1) }));
      else if (e.key === "Escape") setPlan((p) => (p === null ? p : { ...p, path: [] }));
      else if (e.key === "Enter" && committable) document.querySelector<HTMLButtonElement>("button[data-commit-move]")?.click();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ship, committable]);

  if (state === null || ship === null || st === null) return null;
  const full = append(path, preview);
  return {
    ship,
    path,
    preview,
    stats: st,
    previewStats: stats(state, ship, full),
    verdict: judge(state, move(path)),
    previewVerdict: judge(state, move(full, false)),
    disengage,
    setDisengage: (on) => update({ disengage: on }),
    boardable,
    board,
    setBoard: (id) => update({ board: id }),
    click: (p, straightOnly) => update({ path: append(path, propose(state, ship, path, p, straightOnly)) }),
    add: (step) => update({ path: append(path, [step]) }),
    back: () => update({ path: path.slice(0, -1) }),
    clear: () => update({ path: [] }),
    fullAhead: () => {
      const rest = Math.round((st.max - st.total) * 10) / 10;
      if (rest > 0) update({ path: append(path, [{ kind: "advance", distance: rest }]) });
    },
    commit: () => {
      void run(move(path)).then((ok) => {
        if (ok) setPlan(null);
      });
    },
  };
}

/** Active, ungrappled enemy ships whose bases touch the moving ship's base at `end` (validator V7). */
function boardableAt(state: GameState, ship: Ship, end: Point): Ship[] {
  if (!state.meta.options.boarding) return [];
  return state.ships.filter(
    (s) =>
      s.owner !== ship.owner &&
      s.status === "active" &&
      s.grapple === null &&
      s.position !== null &&
      geometry.basesTouch(end, ship.profile.baseSize, s.position, s.profile.baseSize),
  );
}
