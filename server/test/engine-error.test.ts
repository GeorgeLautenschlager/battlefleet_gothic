import { expect, test, vi } from "vitest";
import { Harness } from "./harness";

// The reducer throws on Leadership rolls: an engine bug, as far as the room can tell.
vi.mock("@bfg/engine", async (original) => {
  const engine = await original<typeof import("@bfg/engine")>();
  return {
    ...engine,
    reduce: (state: Parameters<typeof engine.reduce>[0], t: Parameters<typeof engine.reduce>[1]) => {
      if (t.type === "roll_leadership") throw new Error("boom");
      return engine.reduce(state, t);
    },
  };
});

test("an engine failure rejects the proposal and leaves the game as it was", async () => {
  const h = await Harness.started();
  const before = JSON.stringify(h.room.data.snapshot);
  const replies = await h.propose("a", { type: "roll_leadership", player: "p1" });
  expect(replies).toEqual([{ type: "rejected", id: expect.any(String), reason: { code: "ENGINE_ERROR", message: expect.stringContaining("boom") } }]);
  expect(h.room.seq).toBe(0);
  expect(JSON.stringify(h.room.data.snapshot)).toBe(before);
});
