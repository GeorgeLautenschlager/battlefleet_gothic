/**
 * The Raiders (p. 131): state v0.18 §4–§5, N56–N63; transforms v0.16
 * T100–T106; validator v0.13 V22–V23; reducer v0.13 R45–R46.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, leadership } from "../src/state/derived";
import { entryEdges } from "../src/rules/reserves";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 (Imperial) defends with a Lunar and a Gothic; p2 (Chaos) raids with a Murder and two Iconoclasts. */
const RAID: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "raiders",
  forces: { kind: "points", limit: 500 },
  attacker: "p2",
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    { owner: "p1", name: "Invincible", classId: "gothic" },
    { owner: "p2", name: "Unclean", classId: "murder" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p2", name: `Knife ${i}`, classId: "iconoclast", squadron: "Knives" })),
  ],
};

const reason = (s: GameState, t: unknown) => {
  const v = validate(s, t);
  return v.ok ? "ok" : v.reason.code;
};
const deploy = (shipId: string, x: number, y: number): Transform => ({ type: "deploy_ship", player: "p1", shipId, position: { x, y } });

/** Leadership (Ld 8 all round, five rounds of surprise), facing south, the defenders at the centre: player turn 1, the raiders' move. */
function atBattle(): GameState {
  let s = playDice(newGame(cloneJson(RAID)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 5]);
  s = play(s, { type: "choose_facing", player: "p1", heading: 180 });
  s = play(s, deploy("ship-1", 60, 60));
  return play(s, deploy("ship-2", 120, 60));
}

describe("a game of The Raiders (transform §5, T100)", () => {
  test("8 rounds, victory points; the defender deploys, the raiders start in reserve and go first", () => {
    const s = newGame(cloneJson(RAID));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario).toEqual({ id: "raiders", maxRounds: 8, forces: { kind: "points", limit: 500 }, scoring: "victory_points", attacker: "p2" });
    expect(s.setup.raid).toEqual({ facing: null, surpriseTurns: null });
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "undeployed", "reserve", "reserve", "reserve"]);
    expect([s.setup.firstDeployer, s.setup.firstPlayer]).toEqual(["p1", "p2"]);
  });

  test("the defender up to the limit, the raiders up to half (N57); no reinforcement ticks; an attacker named", () => {
    const raiders = (classes: string[]): ShipConfig[] => classes.map((classId, i) => ({ owner: "p2", name: `R${i}`, classId }));
    expect(() => newGame({ ...cloneJson(RAID), ships: [RAID.ships[0]!, ...raiders(["murder"])] })).not.toThrow(); // 170 of 250
    expect(() => newGame({ ...cloneJson(RAID), ships: [RAID.ships[0]!, ...raiders(["murder", "carnage"])] })).toThrow(/the raiders' fleet is 350 pts, over the 250 pt limit/);
    expect(() => newGame({ ...cloneJson(RAID), ships: [...["lunar", "gothic", "dictator"].map((classId, i): ShipConfig => ({ owner: "p1", name: `D${i}`, classId })), RAID.ships[2]!] })).toThrow(/the defender's fleet is 580 pts/);
    expect(() => newGame({ ...cloneJson(RAID), ships: [RAID.ships[0]!, { ...RAID.ships[2]!, reserve: true }] })).toThrow(/every raider moves on/);
    const unnamed = cloneJson(RAID);
    delete unnamed.attacker;
    expect(() => newGame(unnamed)).toThrow(/raiders named as the attacker/);
  });
});

describe("set-up (state §5, N58–N61)", () => {
  test("Leadership, then the surprise D6 (R45)", () => {
    const s = playDice(newGame(cloneJson(RAID)), { type: "roll_leadership", player: "p1" }, [1, 6, 4, 2, 3]);
    // Agrippa 1 → 6, Invincible 6 → 9, Unclean 4 → 8, the Knives one roll 2 → 7; then three rounds of surprise
    expect(s.ships.map((x) => x.leadership)).toEqual([6, 9, 8, 7, 7]);
    expect(s.setup.raid?.surpriseTurns).toBe(3);
    expect(logOf(s, "surprise_roll").at(-1)?.data).toEqual({ rolls: [3], turns: 3 });
    expect(s.clock.setupStep).toBe("choose_facing");
  });

  test("the defender chooses a table edge to face; everything deploys at least 30 cm from the edges, 20 cm apart (T102–T103)", () => {
    let s = playDice(newGame(cloneJson(RAID)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 5]);
    expect(actor(s)).toBe("p1");
    expect(reason(s, { type: "choose_facing", player: "p2", heading: 0 })).toBe("NOT_YOUR_TURN");
    expect(reason(s, { type: "choose_facing", player: "p1", heading: 45 })).toBe("MALFORMED");
    s = play(s, { type: "choose_facing", player: "p1", heading: 180 });
    expect(logOf(s, "facing").at(-1)?.data).toEqual({ player: "p1", heading: 180 });
    expect(s.clock.setupStep).toBe("deploy");
    expect(reason(s, deploy("ship-1", 29, 60))).toBe("NOT_IN_ZONE");
    expect(reason(s, deploy("ship-1", 60, 91))).toBe("NOT_IN_ZONE");
    s = play(s, deploy("ship-1", 60, 60));
    expect(s.ships[0]?.heading).toBe(180);
    expect(reason(s, deploy("ship-2", 79, 60))).toBe("TOO_CLOSE");
    s = play(s, deploy("ship-2", 80, 60));
    expect(s.clock).toMatchObject({ stage: "battle", playerTurn: 1, step: "move_ships" });
    expect(actor(s)).toBe("p2");
  });
});

describe("the surprise (state N61, T106)", () => {
  test("the defenders take −1 Leadership in rounds 1 to n, the raiders never", () => {
    const s = atBattle();
    expect(s.setup.raid?.surpriseTurns).toBe(5);
    const at = (playerTurn: number) => {
      const t = cloneJson(s);
      t.clock.playerTurn = playerTurn;
      t.turnState.playerTurn = playerTurn;
      return t;
    };
    expect(leadership(at(1), s.ships[0]!)).toBe(7);
    expect(leadership(at(10), s.ships[0]!)).toBe(7); // round 5
    expect(leadership(at(11), s.ships[0]!)).toBe(8); // round 6: it's worn off
    expect(leadership(at(1), s.ships[2]!)).toBe(8);
  });
});

describe("the raiders arrive (state N60, T104–T105)", () => {
  test("from any edge, in their first turn, and all of them", () => {
    let s = atBattle();
    expect(entryEdges(s, "p2").map((e) => e.inward)).toEqual([180, 270, 0, 90]);
    expect(entryEdges(s, "p1")).toEqual([]);
    s = play(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-3", position: { x: 0, y: 60 }, heading: 90 }] });
    s = play(s, { type: "move", player: "p2", shipId: "ship-3", path: [{ kind: "advance", distance: 15 }], disengage: false });
    expect(reason(s, { type: "end_step", player: "p2" })).toBe("RESERVES_MUST_ARRIVE");
    expect(s.clock.step).toBe("move_ships");
    s = play(s, {
      type: "arrive",
      player: "p2",
      placements: [
        { shipId: "ship-4", position: { x: 90, y: 120 }, heading: 180 },
        { shipId: "ship-5", position: { x: 100, y: 120 }, heading: 180 },
      ],
    });
    for (const id of ["ship-4", "ship-5"]) s = play(s, { type: "move", player: "p2", shipId: id, path: [{ kind: "advance", distance: 15 }], disengage: false });
    expect(s.clock.step).not.toBe("move_ships");
    const later = cloneJson(s);
    later.clock.playerTurn = 3;
    later.turnState.playerTurn = 3;
    expect(entryEdges(later, "p2")).toEqual([]);
  });
});

describe("full games of The Raiders", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(RAID), seed });
    for (let n = 0; s.clock.stage !== "ended"; n++) {
      if (n > 6000) throw new Error(`seed ${seed}: no end in sight at ${JSON.stringify(s.clock)}`);
      const t = candidates(s, n).find((c) => validate(s, c).ok);
      if (t === undefined) {
        const why = [...new Set(candidates(s, n).map((c) => reason(s, c)))];
        throw new Error(`seed ${seed}: stuck at ${JSON.stringify(s.clock)}: ${why.join(", ")}`);
      }
      s = play(s, t);
    }
    return s;
  };
  test.each([1, 2, 3, 4, 5, 6])("seed %i plays to a result", (seed) => {
    const s = playOut(seed);
    expect(s.result).not.toBeNull();
    expect(logOf(s, "arrive").length).toBeGreaterThan(0);
    expect(s.log.some((e) => e.kind === "surprise_roll")).toBe(true);
  }, 60_000);
});
