/**
 * Surprise Attack (p. 132): state v0.20 §4–§5, §7–§8, N72–N80; transforms v0.18
 * T114–T122; validator v0.15 V28–V31; reducer v0.15 R50–R53.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, getShip, onStandby } from "../src/state/derived";
import { arrivalEdge, entryEdges } from "../src/rules/reserves";
import { alertCount, planetForLimit, unitIds } from "../src/rules/surprise";
import { canBrace } from "../src/reducer/work";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 (Imperial) defends with a Lunar, a Gothic and two Swords; p2 (Chaos) attacks with a Murder and two Iconoclasts. */
const SURPRISE: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  scenario: "surprise_attack",
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
const deploy = (shipId: string, x: number, y: number, heading?: number): Transform => ({
  type: "deploy_ship",
  player: "p1",
  shipId,
  position: { x, y },
  ...(heading === undefined ? {} : { heading }),
});
const move = (player: "p1" | "p2", shipId: string, distance: number): Transform => ({ type: "move", player, shipId, path: [{ kind: "advance", distance }], disengage: false });

/** Leadership 8 all round and one unit on alert (a 2), Agrippa: Invincible and the Blades on standby. */
function atAlert(): GameState {
  const s = playDice(newGame(cloneJson(SURPRISE)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 2]);
  return play(s, { type: "choose_alert", player: "p1", units: ["ship-1"] });
}

/** Deployed round the medium planet (centre 90, 60; 12.5 cm radius): player turn 1, the attackers' move. */
function atBattle(): GameState {
  let s = atAlert();
  s = play(s, deploy("ship-1", 40, 40, 45));
  s = play(s, deploy("ship-2", 90, 80, 90)); // 20 cm from the centre, 7.5 from the edge; the planet off its starboard side
  s = play(s, deploy("ship-3", 130, 60, 0)); // the planet off its port side
  return play(s, deploy("ship-4", 130, 70, 0));
}

describe("a game of Surprise Attack (transform §5, T114)", () => {
  test("no round limit, victory points; the defender deploys, the attackers start in reserve and go first", () => {
    const s = newGame(cloneJson(SURPRISE));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.scenario).toEqual({ id: "surprise_attack", maxRounds: null, forces: { kind: "points", limit: 750 }, scoring: "victory_points", attacker: "p2" });
    expect(s.setup.surpriseAttack).toEqual({ alertUnits: null, alertChosen: false, entryEdge: null });
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "undeployed", "undeployed", "undeployed", "reserve", "reserve", "reserve"]);
    expect([s.setup.firstDeployer, s.setup.firstPlayer]).toEqual(["p1", "p2"]);
  });

  test("the planet by points (N73): small up to 500, medium up to 1,500, large above; a config planet must agree", () => {
    expect([500, 501, 1500, 1501].map(planetForLimit)).toEqual(["small", "medium", "medium", "large"]);
    const s = newGame(cloneJson(SURPRISE));
    expect(s.table.features).toEqual([{ kind: "planet", id: "planet-10", position: { x: 90, y: 60 }, size: "medium", diameter: 25, well: 15 }]);
    expect(s.nextId).toBe(11);
    expect(newGame({ ...cloneJson(SURPRISE), planet: "medium" }).table.features?.[0]).toMatchObject({ size: "medium" });
    expect(() => newGame({ ...cloneJson(SURPRISE), planet: "large" })).toThrow(/at 750 pts has a medium planet, not a large one/);
  });

  test("equal points (N72), no reinforcement ticks, an attacker named", () => {
    expect(() => newGame({ ...cloneJson(SURPRISE), forces: { kind: "points", limit: 400 } })).toThrow(/p1's fleet is \d+ pts, over the 400 pt limit/);
    expect(() => newGame({ ...cloneJson(SURPRISE), ships: [...SURPRISE.ships.slice(0, 4), { ...SURPRISE.ships[4]!, reserve: true }] })).toThrow(/every attacker moves on/);
    const unnamed = cloneJson(SURPRISE);
    delete unnamed.attacker;
    expect(() => newGame(unnamed)).toThrow(/Surprise Attack needs the attackers named as the attacker/);
    expect(() => newGame({ ...cloneJson(SURPRISE), forces: { kind: "cruiser_clash" } })).toThrow(/Surprise Attack is fought at a points limit/);
  });
});

describe("set-up (state §5, N74–N77)", () => {
  test("Leadership, then the alert D3 (R50)", () => {
    const s = playDice(newGame(cloneJson(SURPRISE)), { type: "roll_leadership", player: "p1" }, [1, 6, 4, 2, 3, 5]);
    // Agrippa 1 → 6, Invincible 6 → 9, the Blades one roll 4 → 8, Unclean 2 → 7, the Knives 3 → 7; then 5 → three units on alert
    expect(s.ships.map((x) => x.leadership)).toEqual([6, 9, 8, 8, 7, 7, 7]);
    expect(s.setup.surpriseAttack?.alertUnits).toBe(3);
    expect(logOf(s, "alert_roll").at(-1)?.data).toEqual({ rolls: [5], units: 3 });
    expect(s.clock.setupStep).toBe("choose_alert");
    expect(alertCount(s, "p1")).toBe(3); // Agrippa, Invincible, the Blades: all of them
  });

  test("the defender names D3 units on full alert; the rest go on standby (T115)", () => {
    const s = playDice(newGame(cloneJson(SURPRISE)), { type: "roll_leadership", player: "p1" }, [4, 4, 4, 4, 4, 3]);
    expect(actor(s)).toBe("p1");
    expect(unitIds(s, "p1")).toEqual(["ship-1", "ship-2", "sq-8"]);
    const choose = (units: string[]): Transform => ({ type: "choose_alert", player: "p1", units });
    expect(reason(s, { ...choose(["ship-1", "ship-2"]), player: "p2" })).toBe("NOT_YOUR_TURN");
    expect(reason(s, choose(["ship-1"]))).toBe("INVALID_ALERT"); // two, not one
    expect(reason(s, choose(["ship-1", "ship-1"]))).toBe("INVALID_ALERT");
    expect(reason(s, choose(["ship-1", "ship-3"]))).toBe("INVALID_ALERT"); // a squadron is named by its id
    expect(reason(s, choose(["ship-1", "ship-5"]))).toBe("INVALID_ALERT"); // not the defender's
    const next = play(s, choose(["ship-1", "sq-8"]));
    expect(next.ships.map((x) => x.standby ?? false)).toEqual([false, true, false, false, false, false, false]);
    expect(next.setup.surpriseAttack?.alertChosen).toBe(true);
    expect(logOf(next, "alert_choice").at(-1)?.data).toEqual({ player: "p1", units: ["ship-1", "sq-8"], standby: ["ship-2"] });
    expect(next.clock.setupStep).toBe("deploy");
  });

  test("alert ships deploy 30 cm in from the edges at any heading; standby ships abeam of the planet, the first within 15 cm (T116, N74–N75)", () => {
    let s = atAlert();
    expect(reason(s, deploy("ship-1", 40, 40))).toBe("HEADING_REQUIRED");
    expect(reason(s, deploy("ship-1", 40, 40, 360))).toBe("MALFORMED");
    expect(reason(s, deploy("ship-1", 29, 40, 45))).toBe("NOT_IN_ZONE");
    s = play(s, deploy("ship-1", 40, 40, 45));
    expect(s.ships[0]).toMatchObject({ position: { x: 40, y: 40 }, heading: 45 });
    // Invincible on standby: anywhere on the table, but abeam, and the first within 15 cm of the template
    expect(reason(s, deploy("ship-2", 90, 80, 0))).toBe("NOT_ABEAM"); // the planet dead astern
    expect(reason(s, deploy("ship-2", 90, 100, 90))).toBe("STANDBY_TOO_FAR"); // 27.5 cm from the edge
    expect(reason(s, deploy("ship-2", 90, 87.5, 270))).toBe("ok"); // 15 cm exactly, the planet to port
    s = play(s, deploy("ship-2", 90, 80, 90));
    // Later standby ships may go further out, still abeam
    expect(reason(s, deploy("ship-3", 10, 60, 90))).toBe("NOT_ABEAM");
    expect(reason(s, deploy("ship-3", 10, 60, 0))).toBe("ok");
    s = play(s, deploy("ship-3", 130, 60, 0));
    expect(reason(s, deploy("ship-4", 130, 90, 0))).toBe("NOT_IN_FORMATION");
    s = play(s, deploy("ship-4", 130, 70, 0));
    expect(s.clock).toMatchObject({ stage: "battle", playerTurn: 1, step: "move_ships" });
    expect(actor(s)).toBe("p2");
  });

  test("anywhere else, the division sets the heading (HEADING_NOT_ALLOWED)", () => {
    let s = playDice(newGame(cloneJson(LUNAR_VS_MURDER)), { type: "roll_leadership", player: "p1" }, [4, 4]);
    s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
    s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
    expect(reason(s, deploy("ship-1", 90, 100, 0))).toBe("HEADING_NOT_ALLOWED");
    expect(reason(s, deploy("ship-1", 90, 100))).toBe("ok");
  });
});

describe("the attackers arrive from one edge (state N76, T119)", () => {
  test("the first arrival picks it; the unit's stems all on it", () => {
    let s = atBattle();
    expect(entryEdges(s, "p2").map((e) => e.inward)).toEqual([180, 270, 0, 90]);
    expect(arrivalEdge(s, { position: { x: 0, y: 0 }, heading: 45 })).toBe(90); // a tie: west first
    expect(arrivalEdge(s, { position: { x: 0, y: 0 }, heading: 30 })).toBe(0);
    const corner: Transform = {
      type: "arrive",
      player: "p2",
      placements: [
        { shipId: "ship-6", position: { x: 0, y: 5 }, heading: 90 },
        { shipId: "ship-7", position: { x: 5, y: 0 }, heading: 0 },
      ],
    };
    expect(reason(s, corner)).toBe("ONE_ENTRY_EDGE");
    s = play(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-5", position: { x: 0, y: 60 }, heading: 60 }] });
    expect(s.setup.surpriseAttack?.entryEdge).toBe(90);
    expect(entryEdges(s, "p2").map((e) => e.inward)).toEqual([90]);
    expect(reason(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-6", position: { x: 90, y: 120 }, heading: 180 }, { shipId: "ship-7", position: { x: 100, y: 120 }, heading: 180 }] })).toBe(
      "NOT_ON_ENTRY_EDGE",
    );
    s = play(s, move("p2", "ship-5", 15));
    expect(reason(s, { type: "end_step", player: "p2" })).toBe("RESERVES_MUST_ARRIVE");
    s = play(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-6", position: { x: 0, y: 20 }, heading: 90 }, { shipId: "ship-7", position: { x: 0, y: 30 }, heading: 90 }] });
    for (const id of ["ship-6", "ship-7"]) s = play(s, move("p2", id, 15));
    expect(s.clock.step).toBe("direct_fire");
  });
});

/** The attackers all on and moved, shooting skipped: the end_step that hands the turn to the defender. */
function toDefenderTurn(): GameState {
  let s = atBattle();
  s = play(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-5", position: { x: 0, y: 100 }, heading: 90 }] });
  s = play(s, { type: "arrive", player: "p2", placements: [{ shipId: "ship-6", position: { x: 0, y: 110 }, heading: 90 }, { shipId: "ship-7", position: { x: 0, y: 118 }, heading: 90 }] });
  for (const id of ["ship-5", "ship-6", "ship-7"]) s = play(s, move("p2", id, 15));
  expect(s.clock.step).toBe("direct_fire");
  return s;
}

describe("standby and going on alert (state N78, T117–T121)", () => {
  test("each unit on standby tests at the start of the defender's Movement Phase; a pass goes on alert, a failure stays put", () => {
    // Invincible (Ld 8) rolls 3 + 3: on alert. The Blades (Ld 8) roll 6 + 5: still on standby.
    const s = playDice(toDefenderTurn(), { type: "end_step", player: "p2" }, [3, 3, 6, 5]);
    expect(s.clock).toMatchObject({ playerTurn: 2, step: "move_ships" });
    expect(logOf(s, "alert_test").map((e) => e.data)).toEqual([
      { shipIds: ["ship-2"], rolls: [3, 3], leadership: 8, passed: true },
      { shipIds: ["ship-3", "ship-4"], squadronId: "sq-8", rolls: [6, 5], leadership: 8, passed: false },
    ]);
    const ship = (id: string) => getShip(s, id);
    expect(onStandby(ship("ship-2"))).toBe(false);
    expect(s.turnState.ships["ship-2"]).toMatchObject({ alerted: true, moved: false });
    for (const id of ["ship-3", "ship-4"]) {
      expect(onStandby(ship(id))).toBe(true);
      expect(s.turnState.ships[id]?.moved).toBe(true);
      expect(ship(id).lastMove).toEqual({ playerTurn: 2, distance: 0 });
    }

    // On alert this turn: it moves, but takes no special orders, Brace included (T120)
    expect(reason(s, { type: "declare_order", player: "p1", shipId: "ship-2", order: "lock_on" })).toBe("JUST_ALERTED");
    expect(canBrace(s, ship("ship-2"), { kind: "ship", id: "ship-5" })).toBe(false);
    // On standby: no moves, orders or fire; Brace still allowed (T117)
    expect(reason(s, move("p1", "ship-3", 10))).toBe("ON_STANDBY");
    expect(reason(s, { type: "declare_order", player: "p1", shipId: "ship-3", order: "lock_on" })).toBe("ON_STANDBY");
    expect(canBrace(s, ship("ship-3"), { kind: "ship", id: "ship-5" })).toBe(true);
    expect(reason(s, { type: "declare_order", player: "p1", shipId: "ship-1", order: "lock_on" })).toBe("ok");

    let t = play(s, move("p1", "ship-1", 10));
    t = play(t, move("p1", "ship-2", 5)); // high orbit: no minimum (N69)
    expect(t.clock.step).toBe("direct_fire");
    expect(reason(t, { type: "fire", player: "p1", shipId: "ship-3", weaponId: t.ships[2]!.profile.weapons[0]!.id, target: { kind: "ship", id: "ship-5" } })).toBe("ON_STANDBY");
  });

  test("the alerted flag lapses with the defender's turn (R52)", () => {
    let s = playDice(toDefenderTurn(), { type: "end_step", player: "p2" }, [3, 3, 6, 5]);
    s = play(s, move("p1", "ship-1", 10));
    s = play(s, move("p1", "ship-2", 5));
    while (s.clock.playerTurn === 2) s = play(s, { type: "end_step", player: "p1" }); // no shots, no torpedoes
    expect(s.clock).toMatchObject({ playerTurn: 3, step: "move_ships" });
    expect(s.turnState.ships["ship-2"]?.alerted).toBeUndefined();
    expect(canBrace(s, getShip(s, "ship-2"), { kind: "ship", id: "ship-5" })).toBe(true);
  });
});

describe("full games of Surprise Attack", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(SURPRISE), seed });
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
    expect(logOf(s, "alert_choice")).toHaveLength(1);
    expect(logOf(s, "arrive").length).toBeGreaterThan(0);
  }, 120_000);
});
