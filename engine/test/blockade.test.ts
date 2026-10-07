/**
 * Blockade Run (p. 133): state v0.21 §4–§5, §7, §11, N81–N89; transforms v0.19
 * T123–T130; validator v0.16 V32; reducer v0.16 R54–R56.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, getShip, shipValue, victoryPoints } from "../src/state/derived";
import { deploymentDivisions } from "../src/rules/engagement";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 (Imperial) blockades with a Lunar, a Gothic and two Swords; p2 (Chaos) runs with a Murder and two Iconoclasts. */
const BLOCKADE: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "blockade_run",
  forces: { kind: "points", limit: 750 },
  attacker: "p2",
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    { owner: "p1", name: "Invincible", classId: "gothic" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p1", name: `Blade ${i}`, classId: "sword", squadron: "Blades" })),
    { owner: "p2", name: "Unclean", classId: "murder" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p2", name: `Knife ${i}`, classId: "iconoclast", squadron: "Knives" })),
  ],
};

const reason = (s: GameState, t: unknown) => {
  const v = validate(s, t);
  return v.ok ? "ok" : v.reason.code;
};
const deploy = (player: "p1" | "p2", shipId: string, x: number, y: number, heading?: number): Transform => ({
  type: "deploy_ship",
  player,
  shipId,
  position: { x, y },
  ...(heading === undefined ? {} : { heading }),
});

/** Leadership 8 all round; Agrippa to the left third (1), Invincible the centre (4), the Blades the right (6). */
function atDeploy(): GameState {
  return playDice(newGame(cloneJson(BLOCKADE)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 1, 4, 6]);
}

/** Everything deployed and the runners going first: player turn 1, the runners' move. */
function atBattle(): GameState {
  let s = atDeploy();
  s = play(s, deploy("p1", "ship-1", 30, 80, 90));
  s = play(s, deploy("p1", "ship-2", 90, 80, 270));
  s = play(s, deploy("p1", "ship-3", 150, 80, 180));
  s = play(s, deploy("p1", "ship-4", 160, 80, 180));
  s = play(s, deploy("p2", "ship-5", 90, 10));
  s = play(s, deploy("p2", "ship-6", 40, 10));
  s = play(s, deploy("p2", "ship-7", 50, 10));
  s = playDice(s, { type: "roll_first_turn", player: "p1" }, [6, 1]);
  return play(s, { type: "choose_first_turn", player: "p1", goFirst: false });
}

describe("a game of Blockade Run (transform §5, T123)", () => {
  test("6 rounds, victory points; the blockader deploys first; the first turn is rolled off", () => {
    const s = newGame(cloneJson(BLOCKADE));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario).toEqual({ id: "blockade_run", maxRounds: 6, forces: { kind: "points", limit: 750 }, scoring: "victory_points", attacker: "p2" });
    expect(s.setup.blockade).toEqual({ thirds: null });
    expect(s.ships.every((x) => x.status === "undeployed")).toBe(true);
    expect([s.setup.firstDeployer, s.setup.firstPlayer]).toEqual(["p1", null]);
  });

  test("the blockader up to the limit, the runners up to half (N81)", () => {
    const runners = (classes: string[]): ShipConfig[] => classes.map((classId, i) => ({ owner: "p2", name: `R${i}`, classId }));
    expect(() => newGame({ ...cloneJson(BLOCKADE), ships: [BLOCKADE.ships[0]!, ...runners(["murder", "carnage"])] })).not.toThrow(); // 350 of 375
    expect(() => newGame({ ...cloneJson(BLOCKADE), forces: { kind: "points", limit: 500 }, ships: [BLOCKADE.ships[0]!, ...runners(["murder", "carnage"])] })).toThrow(
      /the runners' fleet is 350 pts, over the 250 pt limit/,
    );
    const unnamed = cloneJson(BLOCKADE);
    delete unnamed.attacker;
    expect(() => newGame(unnamed)).toThrow(/Blockade Run needs the blockade runners named as the attacker/);
  });
});

describe("set-up (state §4–§5, N82–N86)", () => {
  test("a D6 per blockading unit after Leadership: 1–2 left, 3–4 centre, 5–6 right (R54)", () => {
    const s = atDeploy();
    expect(s.setup.blockade?.thirds).toEqual({ "ship-1": 0, "ship-2": 1, "sq-8": 2 });
    expect(logOf(s, "thirds_roll").at(-1)?.data).toEqual({ rolls: [1, 4, 6], thirds: { "ship-1": 0, "ship-2": 1, "sq-8": 2 } });
    expect(s.clock.setupStep).toBe("deploy");
    expect(deploymentDivisions(s, "p1").map((d) => d.rect.x)).toEqual([0, 60, 120]);
    expect(deploymentDivisions(s, "p1", s.ships[0]).map((d) => d.rect)).toEqual([{ x: 0, y: 60, width: 60, height: 60 }]);
  });

  test("blockaders in their third, 60 cm from the runners' edge, any facing; then the runners along their edge (T124, T126)", () => {
    let s = atDeploy();
    expect(actor(s)).toBe("p1");
    expect(reason(s, deploy("p1", "ship-1", 30, 80))).toBe("HEADING_REQUIRED");
    expect(reason(s, deploy("p1", "ship-1", 30, 59, 90))).toBe("NOT_IN_ZONE"); // too near the runners' edge
    expect(reason(s, deploy("p1", "ship-1", 70, 80, 90))).toBe("NOT_IN_ZONE"); // the centre third
    expect(reason(s, deploy("p1", "ship-1", 60, 60, 90))).toBe("ok"); // both boundaries are inclusive
    s = play(s, deploy("p1", "ship-1", 30, 80, 135));
    expect(s.ships[0]).toMatchObject({ position: { x: 30, y: 80 }, heading: 135 });
    // The blockader carries on, all of them, before the runners deploy any (N85).
    expect(actor(s)).toBe("p1");
    s = play(s, deploy("p1", "ship-2", 90, 80, 270));
    s = play(s, deploy("p1", "ship-3", 150, 80, 180));
    s = play(s, deploy("p1", "ship-4", 160, 80, 180));
    expect(actor(s)).toBe("p2");
    expect(reason(s, deploy("p2", "ship-5", 90, 10, 0))).toBe("HEADING_NOT_ALLOWED");
    expect(reason(s, deploy("p2", "ship-5", 90, 16))).toBe("NOT_IN_ZONE");
    s = play(s, deploy("p2", "ship-5", 90, 10));
    expect(s.ships[4]?.heading).toBe(0);
    s = play(s, deploy("p2", "ship-6", 40, 10));
    s = play(s, deploy("p2", "ship-7", 50, 10));
    expect(s.clock.setupStep).toBe("roll_first_turn");
  });
});

describe("running the blockade (state N87–N88, T127–T129)", () => {
  /** Unclean placed near an edge in the runners' first move, then moved 20 cm straight on. */
  const runFrom = (x: number, y: number, heading: number, damage = 0): GameState => {
    const s = cloneJson(atBattle());
    const unclean = getShip(s, "ship-5");
    unclean.position = { x, y };
    unclean.heading = heading;
    unclean.damage = damage;
    return play(s, { type: "move", player: "p2", shipId: "ship-5", path: [{ kind: "advance", distance: 20 }], disengage: false });
  };

  test("a ship off the blockader's edge scores its full value for the runners; the blockader still scores it as disengaged", () => {
    const s = runFrom(90, 110, 0);
    const unclean = getShip(s, "ship-5");
    expect(unclean).toMatchObject({ status: "disengaged", exitEdge: 180, position: null });
    expect(logOf(s, "disengaged").at(-1)?.data).toEqual({ shipId: "ship-5", reason: "table_edge", edge: 180 });
    expect(victoryPoints(s, "p2").ships).toEqual([{ shipId: "ship-5", vp: shipValue(unclean), why: "ran_the_blockade" }]);
    expect(victoryPoints(s, "p1").ships).toEqual([{ shipId: "ship-5", vp: Math.ceil(shipValue(unclean) / 10), why: "disengaged" }]);
  });

  test("crippled, it scores a quarter; off another edge, nothing for the run (N88)", () => {
    const crippled = runFrom(90, 110, 0, 5);
    const unclean = getShip(crippled, "ship-5");
    expect(victoryPoints(crippled, "p2").ships).toEqual([{ shipId: "ship-5", vp: Math.ceil(shipValue(unclean) / 4), why: "ran_the_blockade" }]);
    const sideways = runFrom(170, 40, 90);
    expect(getShip(sideways, "ship-5").exitEdge).toBe(270);
    expect(victoryPoints(sideways, "p2").ships).toEqual([]);
  });
});

describe("full games of Blockade Run", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(BLOCKADE), seed });
    for (let n = 0; s.clock.stage !== "ended"; n++) {
      if (n > 8000) throw new Error(`seed ${seed}: no end in sight at ${JSON.stringify(s.clock)}`);
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
    expect(s.clock.playerTurn).toBeLessThanOrEqual(12);
    expect(logOf(s, "thirds_roll")).toHaveLength(1);
  }, 120_000);
});
