/**
 * The attack craft plotter: waypoints for the wave being flown, the pointer
 * preview after them, and the transforms that fly it (or put it on CAP).
 */
import { useState } from "react";
import { craft, type AttackCraftWave, type GameState, type MoveOrdnance, type Point } from "@bfg/engine";
import { pick } from "../game/pick";
import { capChoices, movableWaves, moveTransform, nextWaypoint, pathLength } from "./craft";

type Plan = { ordnanceId: string; key: string; path: Point[] };

export type CraftPlot = {
  wave: AttackCraftWave;
  path: Point[];
  /** Where a click at the pointer would put the next waypoint. */
  preview: Point | null;
  /** Path length so far, and the wave's speed. */
  used: number;
  speed: number;
  click: (p: Point) => void;
  back: () => void;
  clear: () => void;
  /** Fly the plotted path; with `cap`, end on CAP over that ship. */
  fly: (cap?: string) => MoveOrdnance;
  /** Friendly ships the path ends touching, that its fighters could fly CAP over. */
  capShips: { id: string; name: string }[];
};

export function useCraftPlot(state: GameState | null, pointer: Point | null, focus: string | null): CraftPlot | null {
  const [plan, setPlan] = useState<Plan | null>(null);
  const wave = state === null ? undefined : pick(movableWaves(state), focus);
  if (state === null || wave === undefined) return null;

  const key = `${state.clock.playerTurn}/${state.clock.step}`;
  const path = plan !== null && plan.ordnanceId === wave.id && plan.key === key ? plan.path : [];
  const setPath = (next: Point[]) => setPlan({ ordnanceId: wave.id, key, path: next });
  const speed = craft.waveSpeed(wave);
  const used = pathLength(wave.position, path);
  const preview = pointer === null || used >= speed - 0.1 ? null : nextWaypoint(state, wave, path, pointer);

  return {
    wave,
    path,
    preview,
    used,
    speed,
    click: (p) => {
      if (used < speed - 0.1) setPath([...path, nextWaypoint(state, wave, path, p)]);
    },
    back: () => setPath(path.slice(0, -1)),
    clear: () => setPath([]),
    fly: (cap) => moveTransform(state, wave, path, cap),
    capShips: capChoices(state, wave, path).map((s) => ({ id: s.id, name: s.name })),
  };
}
