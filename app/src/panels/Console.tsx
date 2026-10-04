import { useState } from "react";
import { validate, type GameState, type Transform } from "@bfg/engine";

/**
 * Type any transform as JSON and apply it. A stopgap until every step has
 * proper controls, and a debugging tool after that.
 */
export function Console({ state, onApply }: { state: GameState; onApply: (t: Transform) => void }) {
  const [text, setText] = useState("");
  let parsed: unknown = null;
  let verdict = "";
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
      const v = validate(state, parsed);
      verdict = v.ok ? "OK" : `${v.reason.code}: ${v.reason.message}`;
    } catch {
      verdict = "Not JSON yet";
    }
  }
  const ok = verdict === "OK";
  return (
    <details className="console">
      <summary>Transform console</summary>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={4}
        placeholder='{"type": "end_step", "player": "p1"}'
        aria-label="Transform JSON"
      />
      <div className="console-row">
        <span className={ok ? "verdict ok" : "verdict"}>{verdict}</span>
        <button type="button" disabled={!ok} onClick={() => onApply(parsed as Transform)}>
          Apply
        </button>
      </div>
    </details>
  );
}
