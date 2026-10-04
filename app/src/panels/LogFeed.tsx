import { useEffect, useRef } from "react";
import type { GameState } from "@bfg/engine";
import { describe } from "../log/format";
import { playerClass } from "../players";

const QUIET = new Set(["step"]);

export function LogFeed({ state }: { state: GameState }) {
  const end = useRef<HTMLLIElement>(null);
  const entries = state.log.filter((e) => !QUIET.has(e.kind));
  useEffect(() => {
    // Braces matter: newer Chromes return a Promise from scrollIntoView, and React would call it as a cleanup.
    void end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);
  return (
    <ol className="log" aria-label="Game log">
      {entries.map((e) => (
        <li key={e.id} className={e.actor === null ? "" : playerClass(e.actor)}>
          {describe(state, e)}
        </li>
      ))}
      <li ref={end} className="log-end" aria-hidden />
    </ol>
  );
}
