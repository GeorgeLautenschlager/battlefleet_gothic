/**
 * Whole games through the room (spec §10): the engine's bot plays both seats,
 * choosing every move from the *redacted* state its client was sent. Checks
 * that redaction never gets in the way of validate, both seats always see the
 * same state, the dice stay hidden until the end, and the end verifies.
 */
import { describe, expect, test } from "vitest";
import { validate, type GameState, type PlayerId } from "@bfg/engine";
import { candidates } from "../../engine/test/bot";
import { verifyEnded } from "../src/verify";
import type { Ended } from "../src/protocol";
import { Harness, type Fleet } from "./harness";

const CONN: Record<PlayerId, string> = { p1: "a", p2: "b" };

async function playOut(seed: number, fleets?: { host: Fleet; guest: Fleet }): Promise<{ h: Harness; undos: number }> {
  const h = await Harness.started(seed, fleets);
  let undos = 0;
  for (let n = 0; h.room.data.status !== "ended"; n++) {
    if (n > 5000) throw new Error(`seed ${seed}: no end in sight`);
    const seen = h.stateOf("a") as GameState;
    expect(h.stateOf("b")).toEqual(seen);
    expect(seen.rng).toMatchObject({ seed: 0, state: 0 });

    // Now and then, take back our own last move if the rules allow (spec §6).
    const last = h.room.data.transforms.at(-1);
    if (n % 13 === 5 && last !== undefined && !last.rolled) {
      await h.send(CONN[last.by], { type: "undo", id: h.nextId(), seq: last.seq });
      expect(h.last(CONN[last.by])).toMatchObject({ type: "undone" });
      undos++;
      continue;
    }

    const t = candidates(seen, n).find((c) => validate(seen, c).ok);
    if (t === undefined) throw new Error(`seed ${seed}: stuck at ${JSON.stringify(seen.clock)}`);
    const replies = await h.propose(CONN[t.player], t);
    expect(replies.find((m) => m.type === "rejected")).toBeUndefined();
  }
  return { h, undos };
}

describe("full games through the room", () => {
  test.each([1, 2, 3, 4, 5, 6])("seed %i", async (seed) => {
    const { h, undos } = await playOut(seed);
    const ended = h.inbox.get("a")!.find((m) => m.type === "ended") as Ended;
    expect(ended).toBeDefined();
    expect(h.inbox.get("b")!.find((m) => m.type === "ended")).toEqual(ended);
    expect(ended.seed).toBe(h.room.data.config!.seed);
    expect(undos).toBeGreaterThan(0);

    // Before the end, no message carried the seed or the RNG state.
    const before = h.inbox.get("a")!.slice(0, h.inbox.get("a")!.indexOf(ended));
    const secret = h.room.data.config!.seed;
    for (const m of before) {
      if ((m.type === "applied" || m.type === "welcome" || m.type === "undone") && m.state !== null) {
        expect(m.state.rng.seed).toBe(0);
        expect(m.state.rng.state).toBe(0);
      }
    }
    expect(JSON.stringify(before)).not.toContain(`"seed":${secret}`);

    // The client's check passes, and catches tampering.
    const final = h.stateOf("a")!;
    expect(verifyEnded(ended, final)).toEqual({ ok: true });
    expect(verifyEnded({ ...ended, transforms: ended.transforms.slice(0, -1) }, final).ok).toBe(false);
    expect(verifyEnded({ ...ended, config: { ...ended.config, seed: ended.config.seed + 1 } }, final).ok).toBe(false);
  });
});

describe("full games with fleets through the room", () => {
  const fleet = (faction: Fleet["faction"], classId: string, prefix: string, n: number): Fleet => ({
    faction,
    ships: Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i + 1}`, classId })),
  });
  test.each([
    ["4 Lunars vs 4 Murders", { host: fleet("imperial_navy", "lunar", "Ann", 4), guest: fleet("chaos", "murder", "Bo", 4) }],
    ["mirror: 2 Murders a side", { host: fleet("chaos", "murder", "Ann", 2), guest: fleet("chaos", "murder", "Bo", 2) }],
  ] as const)("%s", async (_, fleets) => {
    const { h } = await playOut(7, fleets);
    const ended = h.inbox.get("a")!.find((m) => m.type === "ended") as Ended;
    expect(ended.config.ships).toHaveLength(fleets.host.ships.length * 2);
    expect(verifyEnded(ended, h.stateOf("a")!)).toEqual({ ok: true });
  });
});
