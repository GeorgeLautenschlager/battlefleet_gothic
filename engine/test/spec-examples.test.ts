/**
 * The examples in game_state/SPEC.md are executable: these tests read the JSON
 * straight out of the spec, so the spec and the code can't drift apart.
 */
import { describe, expect, test } from "vitest";
import { checkInvariants } from "../src/state/invariants";
import * as d from "../src/state/derived";
import type { GameState } from "../src/state/types";
import { specExampleState, specJsonBlocks } from "./helpers";

describe("game_state/SPEC.md §14", () => {
  test("start of round 1 is a valid state", () => {
    const s = specExampleState();
    expect(checkInvariants(s)).toEqual([]);
    expect(d.actor(s)).toBe("p2"); // "Unclean's player won the first-turn roll and chose to go first"
    expect(d.roundOf(s.clock.playerTurn)).toBe(1);
  });

  test("its JSON round-trips exactly (principle 1)", () => {
    const s = specExampleState();
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s);
  });

  test("mid-game fragment: a pending brace, with the derived values the spec states", () => {
    const [, fragment] = specJsonBlocks("game_state/SPEC.md") as [unknown, Pick<GameState, "clock" | "pending" | "queue">];
    const s = specExampleState();

    // Apply the fragment, plus the facts the prose around it gives.
    Object.assign(s, fragment);
    s.turnState.playerTurn = s.clock.playerTurn;
    s.nextId = 50;
    const agrippa = d.getShip(s, "ship-1");
    const unclean = d.getShip(s, "ship-2");
    unclean.damage = 3; // "damage": 3
    unclean.criticals = [{ id: "crit-30", kind: "thrusters", playerTurn: 2 }];
    s.blastMarkers = [{ id: "bm-31", position: { x: 100, y: 105 - 2.5 }, placed: 3, cause: "shield_hit" }]; // one BM touching
    agrippa.specialOrder = { kind: "lock_on", issued: 4, expires: { playerTurn: 6, at: "movement_start" }, replaced: null };

    expect(checkInvariants(s)).toEqual([]);
    expect(d.actor(s)).toBe("p2"); // the reducer is asking p2
    // "not crippled (3 × 2 < 8), speed 15 cm, max shields 2, shield capacity 1 (one BM in contact),
    //  and a brace Command check on Ld 7 − 1 (Under Fire) + 1 (Agrippa is on Lock On) = 7"
    expect(d.isCrippled(unclean)).toBe(false);
    expect(d.speed(unclean)).toBe(15);
    expect(d.maxShields(unclean)).toBe(2);
    expect(d.shieldCapacity(s, unclean)).toBe(1);
    expect(d.commandCheckLd(s, unclean)).toBe(7);
  });
});
