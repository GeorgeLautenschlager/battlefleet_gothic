/** Hot-seat: the game is this browser's history (ADR 0002). */
import { useState } from "react";
import type { Reason, Transform } from "@bfg/engine";
import { apply, canUndo, current, undo, type History } from "./history";
import type { GameSource } from "./source";

export function useLocalSource(history: History | null, setHistory: (h: History) => void): GameSource | null {
  const [rejection, setRejection] = useState<Reason | null>(null);
  if (history === null) return null;
  return {
    kind: "local",
    state: current(history),
    seat: "both",
    status: "ready",
    rejection,
    canUndo: canUndo(history),
    undo: () => {
      setHistory(undo(history));
      setRejection(null);
    },
    run: (t: Transform) => {
      const r = apply(history, t);
      if (r.ok) {
        setHistory(r.history);
        setRejection(null);
      } else {
        setRejection(r.reason);
      }
      return Promise.resolve(r.ok);
    },
  };
}
