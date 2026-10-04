/** Work-queue helpers (reducer spec §1). */
import type { GameState, WorkItem } from "../state/types";

/** Insert items at the front of the queue, in the order they should run. */
export function enqueueFront(state: GameState, items: WorkItem[]): void {
  state.queue.unshift(...items);
}
