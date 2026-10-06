/**
 * The Bait (p. 130) and reserves (state v0.17 §4–§7, N47–N55; transforms v0.15
 * T93–T99; validator v0.12 V19–V21; reducer v0.12 R42–R44).
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, victoryPoints } from "../src/state/derived";
import { canArrive, entryEdges } from "../src/rules/reserves";
import { deploymentDivisions } from "../src/rules/engagement";
import { validate } from "../src/validator/validate";
import type { GameState, PlayerId } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 (Imperial) is pursued: a Lunar as bait, a Gothic and three Swords in reserve. p2 (Chaos) pursues. */
const BAIT: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "the_bait",
  forces: { kind: "points", limit: 500 },
  attacker: "p2",
  ships: [
    { owner: "p1", name: "Bait", classId: "lunar" },
    { owner: "p1", name: "Relief", classId: "gothic", reserve: true },
    ...[1, 2, 3].map((i): ShipConfig => ({ owner: "p1", name: `Hound ${i}`, classId: "sword", squadron: "Hounds", reserve: true })),
    { owner: "p2", name: "Unclean", classId: "murder" },
    { owner: "p2", name: "Despair", classId: "carnage" },
  ],
};

const reason = (s: GameState, t: Transform) => {
  const v = validate(s, t);
  return v.ok ? "ok" : v.reason.code;
};
const with_ = (ships: ShipConfig[], extra: Partial<GameConfig> = {}): GameConfig => ({ ...cloneJson(BAIT), ships, ...extra });

/** Through set-up: the bait at the centre, the pursuers in the west strip. Player turn 1, p1's move_ships. */
function atBattle(config: GameConfig = BAIT): GameState {
  let s = play(newGame(cloneJson(config)), { type: "roll_leadership", player: "p1" });
  s = play(s, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 90, y: 60 } });
  for (const [k, ship] of s.ships.filter((x) => x.owner === "p2").entries()) {
    s = play(s, { type: "deploy_ship", player: "p2", shipId: ship.id, position: { x: 15, y: 50 + 20 * k } });
  }
  return s;
}

const arrive = (player: PlayerId, ...placements: { shipId: string; x: number; y: number; heading: number }[]): Transform => ({
  type: "arrive",
  player,
  placements: placements.map(({ shipId, x, y, heading }) => ({ shipId, position: { x, y }, heading })),
});

describe("a game of The Bait (transform §5, T93)", () => {
  test("points forces, victory points, no round limit; reinforcements start in reserve", () => {
    const s = newGame(cloneJson(BAIT));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario).toEqual({ id: "the_bait", maxRounds: null, forces: { kind: "points", limit: 500 }, scoring: "victory_points", attacker: "p2" });
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "reserve", "reserve", "reserve", "reserve", "undeployed", "undeployed"]);
    expect(s.setup.firstDeployer).toBe("p1");
    expect(s.setup.firstPlayer).toBe("p1");
  });

  test("the forces scale with the limit: bait ≤ half, reinforcements ≤ limit, pursuers ≤ limit (N48)", () => {
    const pursuers: ShipConfig[] = [{ owner: "p2", name: "U", classId: "murder" }];
    expect(() => newGame(with_([{ owner: "p1", name: "B", classId: "dictator" }, ...pursuers]))).not.toThrow(); // 220 ≤ 250
    expect(() => newGame(with_([{ owner: "p1", name: "B", classId: "lunar" }, ...pursuers], { forces: { kind: "points", limit: 300 } }))).toThrow(/the bait is 180 pts, over the 150/);
    expect(() =>
      newGame(with_([{ owner: "p1", name: "B", classId: "lunar" }, ...["lunar", "gothic", "dictator"].map((c, i): ShipConfig => ({ owner: "p1", name: `R${i}`, classId: c, reserve: true })), ...pursuers])),
    ).toThrow(/reinforcements are 580 pts, over the 500/);
    expect(() =>
      newGame(with_([{ owner: "p1", name: "B", classId: "lunar" }, ...["murder", "carnage", "murder"].map((c, i): ShipConfig => ({ owner: "p2", name: `P${i}`, classId: c }))])),
    ).toThrow(/pursuers' fleet is 520 pts/);
  });

  test("the bait is one ship or one squadron; squadrons aren't split; the pursuers keep nothing back", () => {
    const pursuers: ShipConfig[] = [{ owner: "p2", name: "U", classId: "murder" }];
    expect(() => newGame(with_([{ owner: "p1", name: "A", classId: "sword", squadron: "S" }, { owner: "p1", name: "B", classId: "sword", squadron: "S" }, ...pursuers]))).not.toThrow();
    expect(() => newGame(with_([{ owner: "p1", name: "A", classId: "dauntless" }, { owner: "p1", name: "B", classId: "sword", squadron: "S" }, ...pursuers]))).toThrow(/one ship or one squadron/);
    expect(() => newGame(with_([{ owner: "p1", name: "A", classId: "lunar", reserve: true }, ...pursuers]))).toThrow(/one ship or one squadron/);
    expect(() =>
      newGame(with_([{ owner: "p1", name: "B", classId: "lunar" }, { owner: "p1", name: "S1", classId: "sword", squadron: "S", reserve: true }, { owner: "p1", name: "S2", classId: "sword", squadron: "S" }, ...pursuers])),
    ).toThrow(/all in reserve or none/);
    expect(() => newGame(with_([{ owner: "p1", name: "B", classId: "lunar" }, { owner: "p2", name: "U", classId: "murder", reserve: true }]))).toThrow(/pursuers have no reinforcements/);
  });

  test("an attacker for The Bait only; reserves for The Bait only; victory points only", () => {
    const unnamed = cloneJson(BAIT);
    delete unnamed.attacker;
    expect(() => newGame(unnamed)).toThrow(/attacker/);
    expect(() => newGame({ ...cloneJson(LUNAR_VS_MURDER), attacker: "p1" })).toThrow(/only The Bait has an attacker/);
    expect(() => newGame({ ...cloneJson(LUNAR_VS_MURDER), forces: { kind: "points", limit: 500 }, ships: [{ owner: "p1", name: "A", classId: "lunar", reserve: true }, { owner: "p2", name: "U", classId: "murder" }] })).toThrow(/reinforcements in reserve/);
    expect(() => newGame({ ...cloneJson(BAIT), scoring: "cruiser_clash" })).toThrow(/victory points/);
  });
});

describe("set-up (state §4–§5, N49–N50, N55)", () => {
  test("Leadership for everyone, reserves included; then the bait deploys, then the pursuers; no other rolls", () => {
    let s = play(newGame(cloneJson(BAIT)), { type: "roll_leadership", player: "p1" });
    expect(s.ships.every((x) => x.leadership !== null)).toBe(true);
    expect(s.clock.setupStep).toBe("deploy");
    expect(actor(s)).toBe("p1");
    expect(reason(s, { type: "deploy_ship", player: "p1", shipId: "ship-2", position: { x: 90, y: 60 } })).toBe("IN_RESERVE");
    expect(reason(s, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 110, y: 60 } })).toBe("NOT_IN_ZONE");
    s = play(s, { type: "deploy_ship", player: "p1", shipId: "ship-1", position: { x: 100, y: 55 } });
    expect(s.ships[0]?.heading).toBe(90);
    expect(actor(s)).toBe("p2");
    expect(reason(s, { type: "deploy_ship", player: "p2", shipId: "ship-6", position: { x: 31, y: 60 } })).toBe("NOT_IN_ZONE");
    s = play(s, { type: "deploy_ship", player: "p2", shipId: "ship-6", position: { x: 30, y: 60 } });
    s = play(s, { type: "deploy_ship", player: "p2", shipId: "ship-7", position: { x: 5, y: 20 } });
    expect(s.ships[6]?.heading).toBe(90);
    expect(s.clock).toMatchObject({ stage: "battle", playerTurn: 1, phase: "movement" });
    expect(actor(s)).toBe("p1");
    expect(logOf(s, "battle_start").at(-1)?.data).toEqual({ firstPlayer: "p1" });
    expect(deploymentDivisions(s, "p1")[0]?.rect).toEqual({ x: 75, y: 45, width: 30, height: 30 });
  });
});

describe("arriving (transform §4.2, T94–T98)", () => {
  test("round 1: the east edge only, facing in", () => {
    const s = atBattle();
    expect(s.clock.step).toBe("move_ships");
    expect(entryEdges(s, "p1")).toEqual([{ from: { x: 180, y: 0 }, to: { x: 180, y: 120 }, inward: 270 }]);
    expect(entryEdges(s, "p2")).toEqual([]);
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 170, y: 0, heading: 0 }))).toBe("NOT_ON_ENTRY_EDGE");
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 90 }))).toBe("NOT_FACING_IN");
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 0 }))).toBe("NOT_FACING_IN"); // along the edge isn't in
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 0, heading: 240 }))).toBe("NOT_FACING_IN"); // the corner: in from both edges
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 0, heading: 330 }))).toBe("ok");
    expect(reason(s, arrive("p1", { shipId: "ship-1", x: 180, y: 60, heading: 270 }))).toBe("NOT_IN_RESERVE");
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 200 }))).toBe("ok");
  });

  test("an arriving ship is unmoved and must move; the step waits for reserves or an end_step", () => {
    let s = atBattle();
    s = play(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 270 }));
    expect(s.ships[1]).toMatchObject({ status: "active", position: { x: 180, y: 60 }, heading: 270 });
    expect(logOf(s, "arrive").at(-1)?.data).toEqual({ player: "p1", ships: [{ shipId: "ship-2", position: { x: 180, y: 60 }, heading: 270 }] });
    expect(reason(s, { type: "end_step", player: "p1" })).toBe("SHIPS_TO_MOVE");
    s = play(s, { type: "move", player: "p1", shipId: "ship-2", path: [{ kind: "advance", distance: 20 }], disengage: false });
    expect(s.ships[1]?.position?.x).toBeCloseTo(160);
    s = play(s, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 20 }], disengage: false });
    // The Swords are still waiting: the step stays open
    expect(s.clock.step).toBe("move_ships");
    expect(canArrive(s, "p1")).toBe(true);
    s = play(s, { type: "end_step", player: "p1" });
    expect(s.clock.step).not.toBe("move_ships");
    expect(s.ships.filter((x) => x.status === "reserve").map((x) => x.id)).toEqual(["ship-3", "ship-4", "ship-5"]);
  });

  test("without reserves, end_step in move_ships is refused and the step ends by itself", () => {
    let s = atBattle(with_([{ owner: "p1", name: "Bait", classId: "lunar" }, { owner: "p2", name: "U", classId: "murder" }]));
    expect(reason(s, { type: "end_step", player: "p1" })).toBe("NO_ENTRY_EDGE");
    s = play(s, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 20 }], disengage: false });
    expect(s.clock.step).not.toBe("move_ships");
  });

  test("a squadron arrives whole, in formation, without overlapping (T94, V5)", () => {
    const s = atBattle();
    expect(reason(s, arrive("p1", { shipId: "ship-3", x: 180, y: 40, heading: 270 }))).toBe("ARRIVE_ONE_UNIT");
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 20, heading: 270 }, { shipId: "ship-3", x: 180, y: 40, heading: 270 }))).toBe("ARRIVE_ONE_UNIT");
    const hounds = (y3: number) =>
      arrive("p1", { shipId: "ship-3", x: 180, y: 40, heading: 270 }, { shipId: "ship-4", x: 180, y: 50, heading: 270 }, { shipId: "ship-5", x: 180, y: y3, heading: 270 });
    expect(reason(s, hounds(80))).toBe("NOT_IN_FORMATION");
    expect(reason(s, hounds(51))).toBe("BASES_OVERLAP");
    const next = play(s, hounds(60));
    expect(next.ships.slice(2, 5).every((x) => x.status === "active")).toBe(true);
    expect(logOf(next, "arrive").at(-1)?.data["ships"]).toHaveLength(3);
  });

  test("not while a ship is part-way through its move", () => {
    let s = atBattle();
    s = play(s, { type: "declare_order", player: "p1", shipId: "ship-1", order: "lock_on" });
    expect(s.activation).not.toBeNull();
    expect(reason(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 270 }))).toBe("ACTIVATION_OPEN");
  });

  test("from round 2 the long edges open 30 cm a round, next to the east edge (N51)", () => {
    const s = atBattle();
    const round = (n: number) => {
      const t = cloneJson(s);
      t.clock.playerTurn = 2 * n - 1;
      t.turnState.playerTurn = 2 * n - 1;
      return t;
    };
    expect(entryEdges(round(2), "p1")).toEqual([
      { from: { x: 180, y: 0 }, to: { x: 180, y: 120 }, inward: 270 },
      { from: { x: 150, y: 0 }, to: { x: 180, y: 0 }, inward: 0 },
      { from: { x: 150, y: 120 }, to: { x: 180, y: 120 }, inward: 180 },
    ]);
    expect(entryEdges(round(4), "p1")[1]?.from).toEqual({ x: 90, y: 0 }); // "turn 4 → up to 90 cm along a long edge"
    expect(entryEdges(round(9), "p1")[1]?.from).toEqual({ x: 0, y: 0 });
    expect(reason(round(2), arrive("p1", { shipId: "ship-2", x: 150, y: 0, heading: 0 }))).toBe("ok");
    expect(reason(round(2), arrive("p1", { shipId: "ship-2", x: 149, y: 0, heading: 0 }))).toBe("NOT_ON_ENTRY_EDGE");
    expect(reason(round(2), arrive("p1", { shipId: "ship-2", x: 160, y: 120, heading: 135 }))).toBe("ok");
  });
});

describe("the end (state N52, D6; reducer R43–R44)", () => {
  /** The bait destroyed where it stands, from outside the rules. */
  const sink = (s: GameState, id: string): GameState => {
    const t = cloneJson(s);
    const ship = t.ships.find((x) => x.id === id)!;
    Object.assign(ship, { status: "destroyed", damage: ship.profile.hits, position: null, heading: null });
    expect(checkInvariants(t)).toEqual([]);
    return t;
  };

  test("losing the bait doesn't end the game while reinforcements wait", () => {
    let s = sink(atBattle(), "ship-1");
    // An end_step with nothing to move would give the reserves up; arriving keeps the fight going.
    s = play(s, arrive("p1", { shipId: "ship-2", x: 180, y: 60, heading: 270 }));
    expect(s.clock.stage).toBe("battle");
  });

  test("ending the Movement Phase with nothing on the table gives the reserves up: they disengage, and the game ends", () => {
    let s = sink(atBattle(), "ship-1");
    s = play(s, { type: "end_step", player: "p1" });
    expect(s.clock.stage).toBe("ended");
    expect(s.result?.reason).toBe("fleet_eliminated");
    expect(logOf(s, "reserves_disengaged").at(-1)?.data).toEqual({ player: "p1", shipIds: ["ship-2", "ship-3", "ship-4", "ship-5"] });
    const vp = victoryPoints(s, "p2");
    // The Lunar destroyed (180), the Gothic disengaged (10% of 180 = 18), the Swords disengaged (10% of 105, rounded up: 11)
    expect(vp.ships).toEqual([
      { shipId: "ship-1", vp: 180, why: "destroyed" },
      { shipId: "ship-2", vp: 18, why: "disengaged" },
    ]);
    expect(vp.squadrons).toEqual([{ squadronId: "sq-8", vp: 11, why: "disengaged" }]);
    expect(s.result?.winner).toBe("p2");
  });

  test("reserves still waiting when the pursuers are gone score nothing (R44)", () => {
    let s = atBattle();
    s = sink(sink(s, "ship-6"), "ship-7");
    s = play(s, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 20 }], disengage: false });
    expect(s.clock.stage).toBe("ended");
    expect(s.ships.filter((x) => x.status === "reserve")).toHaveLength(4);
    expect(victoryPoints(s, "p2").total).toBe(0);
    expect(s.result?.winner).toBe("p1");
  });
});

describe("full games of The Bait", () => {
  const playOut = (seed: number, config: GameConfig): GameState => {
    let s = newGame({ ...cloneJson(config), seed });
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
  test.each([1, 2, 3, 4, 5, 6])("seed %i plays until a fleet is gone", (seed) => {
    const s = playOut(seed, BAIT);
    expect(s.result?.reason).toBe("fleet_eliminated");
    expect(logOf(s, "arrive").length).toBeGreaterThan(0);
  }, 60_000);
});
