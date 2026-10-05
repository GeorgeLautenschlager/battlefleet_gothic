/**
 * The plotter's state: the path being built for the ship that's moving, the
 * pointer preview on top of it, and the engine's verdict on both.
 */
import { useEffect, useState } from "react";
import { activePlayer, type GameState, type PathStep, type Point, type Ship, type Transform } from "@bfg/engine";
import { append, judge, propose, stats, type PlotStats, type Verdict } from "./plot";

type Plan = { shipId: string; playerTurn: number; path: PathStep[]; disengage: boolean };

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
  click: (p: Point, straight: boolean) => void;
  /** Add a typed step. */
  add: (step: PathStep) => void;
  back: () => void;
  clear: () => void;
  fullAhead: () => void;
  commit: () => void;
};

/** The ship the active player is plotting, if any. */
export function plottingShip(state: GameState): Ship | null {
  if (state.clock.stage !== "battle" || state.clock.step !== "move_ships" || state.pending.length > 0) return null;
  const open = state.activation;
  if (open !== null) return open.stage === "ordered" ? (state.ships.find((s) => s.id === open.shipId) ?? null) : null;
  const player = activePlayer(state);
  return state.ships.find((s) => s.owner === player && s.status === "active" && state.turnState.ships[s.id]?.moved !== true) ?? null;
}

export function usePlot(state: GameState | null, pointer: Point | null, straight: boolean, run: (t: Transform) => Promise<boolean>): Plot | null {
  const [plan, setPlan] = useState<Plan | null>(null);
  const ship = state === null ? null : plottingShip(state);

  const current = state !== null && ship !== null && plan?.shipId === ship.id && plan.playerTurn === state.clock.playerTurn ? plan : null;
  const path = current?.path ?? [];
  const disengage = current?.disengage ?? false;

  const update = (patch: Partial<Plan>) => {
    if (state === null || ship === null) return;
    setPlan({ shipId: ship.id, playerTurn: state.clock.playerTurn, path, disengage, ...patch });
  };

  const st = state === null || ship === null ? null : stats(state, ship, path);
  const preview = state === null || ship === null || pointer === null ? [] : propose(state, ship, path, pointer, straight);

  const move = (p: PathStep[]): Transform => ({ type: "move", player: ship?.owner ?? "p1", shipId: ship?.id ?? "", path: p, disengage });

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
    previewVerdict: judge(state, move(full)),
    disengage,
    setDisengage: (on) => update({ disengage: on }),
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
