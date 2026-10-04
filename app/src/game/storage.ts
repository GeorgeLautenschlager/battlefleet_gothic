/** Autosave to localStorage. Storage can be missing or full; the game carries on regardless. */
import { fromSave, toSave, type History } from "./history";

const KEY = "bfg.autosave";

export function loadAutosave(): History | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : fromSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function autosave(history: History | null): void {
  try {
    if (history === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(toSave(history)));
  } catch {
    // Private window or full storage: nothing to do.
  }
}
