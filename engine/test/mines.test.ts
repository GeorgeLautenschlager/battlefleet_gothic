/**
 * Planetary defences, second slice: orbital mines, minefields and fire ships (fleets book pp. 512–513, 516):
 * state v0.23 §4–§5, §7.6, §10.2, N106–N122; transforms v0.21 T143–T156; validator v0.18 V37–V44;
 * reducer v0.18 R63–R74.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, getShip, victoryPoints } from "../src/state/derived";
import { validate } from "../src/validator/validate";
import type { AttackCraftWave, GameState, OrbitalMine, Phase, Step, TorpedoSalvo } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/**
 * p1 holds a medium planet (centre 90, 60; template edge 12.5 cm, well to 27.5 cm) with Agrippa and two fire ships,
 * three orbital mines and a minefield; p2 has Unclean and Despair.
 * Ids: ship-1 Agrippa, ship-2 and ship-3 the fire ships (sq-6), ship-4 Unclean, ship-5 Despair, planet-7.
 */
const MINED: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  forces: { kind: "points", limit: 750 },
  scoring: "victory_points",
  planet: "medium",
  planetHolder: "p1",
  orbitalMines: 3,
  minefields: 1,
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p1", name: `Torch ${i}`, classId: "fire_ship", squadron: "Torches" })),
    { owner: "p2", name: "Unclean", classId: "murder" },
    { owner: "p2", name: "Despair", classId: "carnage" },
  ],
};

const reason = (s: GameState, t: unknown) => {
  const v = validate(s, t);
  return v.ok ? "ok" : v.reason.code;
};
const place = (kind: "orbital_mine" | "minefield", x: number, y: number, turned?: boolean): Transform => ({
  type: "place_defence",
  player: "p1",
  kind,
  position: { x, y },
  ...(turned === undefined ? {} : { turned }),
});
const deploy = (player: "p1" | "p2", shipId: string, x: number, y: number, heading?: number): Transform => ({
  type: "deploy_ship",
  player,
  shipId,
  position: { x, y },
  ...(heading === undefined ? {} : { heading }),
});

/** Leadership 8 all round, p1 in zone A (the top), p1 deploying first; the minefield rolled 10 × 15 cm. */
function atPlacing(): GameState {
  let s = playDice(newGame(cloneJson(MINED)), { type: "roll_leadership", player: "p1" }, [4, 4, 4]);
  s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
  return playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6, 4, 6]);
}

/** Everything placed and deployed: the minefield at 55–65 × 52.5–67.5, mines at (90, 82), (110, 60) and (70, 75). */
function atFirstTurn(goFirst: boolean): GameState {
  let s = atPlacing();
  s = play(s, place("minefield", 60, 60));
  s = play(s, place("orbital_mine", 90, 82));
  s = play(s, place("orbital_mine", 110, 60));
  s = play(s, place("orbital_mine", 70, 75));
  s = play(s, deploy("p1", "ship-1", 90, 105));
  s = play(s, deploy("p2", "ship-4", 90, 15));
  s = play(s, deploy("p1", "ship-2", 80, 82, 90));
  s = play(s, deploy("p1", "ship-3", 85, 84, 90));
  s = play(s, deploy("p2", "ship-5", 120, 15));
  s = playDice(s, { type: "roll_first_turn", player: "p1" }, [6, 1]);
  return play(s, { type: "choose_first_turn", player: "p1", goFirst });
}

/** A copy with the clock moved to a step of the current player turn, nothing moving. */
function atStep(s0: GameState, phase: Phase, step: Step): GameState {
  const s = cloneJson(s0);
  s.clock.phase = phase;
  s.clock.step = step;
  s.turnState.ordnanceMoved = [];
  return s;
}

const mine = (s: GameState, id: string): OrbitalMine => s.ordnance.find((o): o is OrbitalMine => o.id === id && o.kind === "orbital_mine")!;
const mines = (s: GameState): OrbitalMine[] => s.ordnance.filter((o): o is OrbitalMine => o.kind === "orbital_mine");
/** The minefield's id, and the bought mines' ids in the order they were placed. */
const fieldId = (s: GameState): string => s.table.features?.find((f) => f.kind === "minefield")?.id ?? "";
const mineIds = (s: GameState): string[] => mines(s).map((m) => m.id);
/** A fresh id for ordnance a test adds by hand. */
const freshId = (s: GameState): string => `ord-${s.nextId++}`;

/** Drop every mine but those named. */
const keepMines = (s: GameState, ...ids: string[]) => {
  s.ordnance = s.ordnance.filter((o) => o.kind !== "orbital_mine" || ids.includes(o.id));
};

describe("buying mines and minefields (transform §5, T149, state N107)", () => {
  test("counts in the config, the holder's, inside the third; fire ships are ships", () => {
    const s = newGame(cloneJson(MINED));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.setup.emplacements).toEqual({ owner: "p1", orbitalMines: 3, minefields: 1, unplaced: { orbitalMines: 3, minefields: null } });
    expect(s.ships[1]?.profile).toMatchObject({ classId: "fire_ship", type: "escort", hits: 1, speed: 15, shields: 1, turrets: 1, weapons: [], traits: { planetaryDefence: true, fireShip: true } });
    expect(s.ships.map((x) => x.leadership)).toEqual([null, 7, 7, null, null]);
  });

  test("limits", () => {
    const base = cloneJson(MINED);
    expect(() => newGame({ ...base, minefields: 3 })).toThrow(/minefields are a whole number, 0–2, not 3/);
    expect(() => newGame({ ...base, orbitalMines: 1.5 })).toThrow(/orbitalMines is a whole number/);
    expect(() => newGame({ ...base, orbitalMines: 40 })).toThrow(/planetary defences are 260 pts, over a third of the limit \(250 pts\)/);
    const noPlanet = cloneJson(MINED);
    delete noPlanet.planet;
    expect(() => newGame(noPlanet)).toThrow(/need a planet on the table/);
    const sevenTorches = [...base.ships, ...[3, 4, 5, 6, 7].map((i): ShipConfig => ({ owner: "p1", name: `Torch ${i}`, classId: "fire_ship", squadron: "Torches" }))];
    expect(() => newGame({ ...base, ships: sevenTorches })).toThrow(/at most 6 fire ships, not 7/);
    // Mines count toward the holder's limit too: 750 − 180 for Agrippa − 20 for the torches leaves room for 110 mines' worth… but a third caps it.
    expect(() => newGame({ ...base, orbitalMines: 38 })).not.toThrow(); // 190 + 40 + 20 = 250
  });

  test("a game without them never enters place_defences", () => {
    const plain = cloneJson(MINED);
    delete plain.orbitalMines;
    delete plain.minefields;
    let s = playDice(newGame(plain), { type: "roll_leadership", player: "p1" }, [4, 4, 4]);
    s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
    s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
    expect(s.setup.emplacements).toBeUndefined();
    expect(s.clock.setupStep).toBe("deploy");
  });
});

describe("placing them (state N108, T143–T146, V37–V38)", () => {
  test("the minefield's size is rolled on entering the step; the holder places", () => {
    const s = atPlacing();
    expect(s.clock.setupStep).toBe("place_defences");
    expect(actor(s)).toBe("p1");
    expect(s.setup.emplacements?.unplaced).toEqual({ orbitalMines: 3, minefields: [{ width: 10, height: 15 }] });
    expect(logOf(s, "minefield_sizes").at(-1)?.data).toEqual({ rolls: [4, 6], sizes: [{ width: 10, height: 15 }] });
  });

  test("where they may go", () => {
    let s = atPlacing();
    expect(reason(s, { ...place("orbital_mine", 90, 82), player: "p2" })).toBe("NOT_YOUR_TURN");
    expect(reason(s, place("orbital_mine", 90, 82, true))).toBe("CANT_TURN_MINE");
    expect(reason(s, place("orbital_mine", 90, 90))).toBe("NOT_IN_GRAVITY_WELL"); // 30 cm out
    expect(reason(s, place("orbital_mine", 90, 65))).toBe("NOT_IN_GRAVITY_WELL"); // on the template
    expect(reason(s, place("minefield", 3, 60))).toBe("OFF_TABLE");
    expect(reason(s, place("minefield", 40, 60))).toBe("MINEFIELD_TOO_FAR"); // its edge at x = 45: 32.5 cm from the template
    expect(reason(s, place("minefield", 57.5, 60))).toBe("ok"); // nearest point (62.5, 60): exactly 15 cm (inclusive)
    expect(reason(s, place("minefield", 55, 60, true))).toBe("ok"); // turned: 15 wide, its edge at 62.5
    s = play(s, place("minefield", 60, 60));
    expect(s.table.features?.[1]).toEqual({ kind: "minefield", id: fieldId(s), owner: "p1", rect: { x: 55, y: 52.5, width: 10, height: 15 } });
    expect(reason(s, place("minefield", 60, 60))).toBe("NOTHING_TO_PLACE");
    for (const [x, y] of [[90, 82], [110, 60]] as const) s = play(s, place("orbital_mine", x, y));
    expect(s.clock.setupStep).toBe("place_defences");
    s = play(s, place("orbital_mine", 70, 75));
    expect(mines(s).map((m) => [m.position, m.source])).toEqual([
      [{ x: 90, y: 82 }, "bought"],
      [{ x: 110, y: 60 }, "bought"],
      [{ x: 70, y: 75 }, "bought"],
    ]);
    expect(s.clock.setupStep).toBe("deploy");
    expect(s.setup.emplacements?.unplaced).toEqual({ orbitalMines: 0, minefields: [] });
  });

  test("two minefields can't overlap, but may touch", () => {
    let s = newGame({ ...cloneJson(MINED), minefields: 2 });
    s = playDice(s, { type: "roll_leadership", player: "p1" }, [4, 4, 4]);
    s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
    s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6, 4, 6, 4, 6]);
    s = play(s, place("minefield", 60, 60));
    expect(reason(s, place("minefield", 65, 60))).toBe("MINEFIELDS_OVERLAP");
    expect(reason(s, place("minefield", 60, 75))).toBe("ok"); // y 67.5–82.5: sharing an edge
  });
});

describe("orbital mines (state N109–N113, R64–R65)", () => {
  test("a mine moves 10 cm toward the nearest enemy ship, in its owner's step of every Ordnance Phase", () => {
    const s0 = atStep(atFirstTurn(true), "ordnance", "active_ordnance");
    const [, , m3] = mineIds(s0);
    keepMines(s0, m3!);
    mine(s0, m3!).position = { x: 90, y: 45 };
    const s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: m3! });
    expect(mine(s, m3!).position).toEqual({ x: 90, y: 35 }); // straight at Unclean's stem (90, 15)
    expect(logOf(s, "mine_move").at(-1)?.data).toEqual({ ordnanceId: m3!, to: { x: 90, y: 35 }, quarryId: "ship-4" });
    expect(reason(s0, { type: "move_ordnance", player: "p1", ordnanceId: m3!, path: [] })).toBe("WRONG_ORDNANCE_MOVE");
  });

  test("on contact: Brace, turrets, then 8 dice against the armour it's on; shields work; the mine is gone and scores", () => {
    const s0 = atStep(atFirstTurn(true), "ordnance", "active_ordnance");
    const [, , m3] = mineIds(s0);
    keepMines(s0, m3!);
    mine(s0, m3!).position = { x: 90, y: 24 };
    let s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: m3! });
    expect(mine(s, m3!).position.y).toBeCloseTo(15 + 1.6 + 1, 6); // stopped touching its base
    const pending = s.pending.at(-1)!;
    expect(pending).toMatchObject({ player: "p2", shipId: "ship-4", source: { kind: "ordnance", id: m3! } });
    const turrets = getShip(s, "ship-4").profile.turrets;
    // Turrets miss; eight dice at armour 5: four hits, two on the shields, two damage (no criticals).
    s = playDice(s, { type: "answer_brace", player: "p2", pendingId: pending.id, attempt: false }, [...Array<number>(turrets).fill(1), 5, 6, 5, 6, 1, 2, 3, 4, 1, 1]);
    expect(logOf(s, "attack").at(-1)?.data).toMatchObject({ weapon: "mine", need: 5, rolls: [5, 6, 5, 6, 1, 2, 3, 4], hits: 4 });
    expect(logOf(s, "shields").at(-1)?.data).toMatchObject({ shipId: "ship-4", absorbed: 2 });
    expect(s.blastMarkers).toHaveLength(2);
    expect(getShip(s, "ship-4").damage).toBe(2);
    expect(mines(s)).toEqual([]);
    expect(logOf(s, "ordnance_removed").at(-1)?.data).toEqual({ ordnanceId: m3!, reason: "detonated" });
    // Bought mines gone score 5 each (N113): the two the test took off, and this one.
    expect([victoryPoints(s0, "p2").mines, victoryPoints(s, "p2").mines]).toEqual([10, 15]);
  });

  test("a turret hit halves it to four dice", () => {
    const s0 = atStep(atFirstTurn(true), "ordnance", "active_ordnance");
    const [, , m3] = mineIds(s0);
    keepMines(s0, m3!);
    mine(s0, m3!).position = { x: 90, y: 24 };
    let s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: m3! });
    const turrets = getShip(s, "ship-4").profile.turrets;
    s = playDice(s, { type: "answer_brace", player: "p2", pendingId: s.pending.at(-1)!.id, attempt: false }, [4, ...Array<number>(turrets - 1).fill(1), 1, 1, 1, 1]);
    expect(logOf(s, "turrets").at(-1)?.data).toMatchObject({ against: "mine", stopped: 1 });
    expect(logOf(s, "attack").at(-1)?.data).toMatchObject({ weapon: "mine", rolls: [1, 1, 1, 1], hits: 0 });
  });

  test("enemy fighters and a mine remove each other", () => {
    const s0 = atStep(atFirstTurn(true), "ordnance", "active_ordnance");
    const [, , m3] = mineIds(s0);
    const o12 = freshId(s0);
    keepMines(s0, m3!);
    mine(s0, m3!).position = { x: 90, y: 40 };
    const wave: AttackCraftWave = { id: o12, kind: "attack_craft", owner: "p2", launchedBy: "ship-4", launched: 1, position: { x: 90, y: 34 }, squadrons: [{ role: "fighter", name: "Swiftdeath", speed: 30 }], cap: null };
    s0.ordnance.push(wave);
    const s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: m3! });
    expect(s.ordnance).toEqual([]);
    expect(logOf(s, "mine_intercept").at(-1)?.data).toEqual({ ordnanceId: o12, mineId: m3!, lost: ["Swiftdeath"] });
  });

  test("ships moving past a mine leave it be (N112)", () => {
    const s0 = atFirstTurn(false); // p2 moves first
    const [, , m3] = mineIds(s0);
    keepMines(s0, m3!);
    mine(s0, m3!).position = { x: 90, y: 25 };
    const s = play(s0, { type: "move", player: "p2", shipId: "ship-4", path: [{ kind: "advance", distance: 20 }], disengage: false });
    expect(getShip(s, "ship-4").position).toEqual({ x: 90, y: 35 });
    expect(mines(s)).toHaveLength(1);
  });
});

describe("minefields (state N114–N120, R66–R73)", () => {
  test("ships touching one take a Leadership test there: a failure is D6 hits, with no Blast Markers", () => {
    const s0 = atFirstTurn(false);
    const mf = fieldId(s0);
    keepMines(s0);
    const unclean = getShip(s0, "ship-4");
    unclean.position = { x: 40, y: 60 };
    unclean.heading = 90;
    // 2D6 against Ld 8 fails on 6, 6; then D6 = 4 hits: two on the shields (no markers), two damage (no criticals).
    const s = playDice(s0, { type: "move", player: "p2", shipId: "ship-4", path: [{ kind: "advance", distance: 20 }], disengage: false }, [6, 6, 4, 1, 1]);
    expect(logOf(s, "minefield_test").at(-1)?.data).toEqual({ shipId: "ship-4", minefieldId: mf, leadership: 8, rolls: [6, 6], passed: false, hitRolls: [4] });
    expect(getShip(s, "ship-4")).toMatchObject({ damage: 2, position: { x: 60, y: 60 } });
    expect(s.blastMarkers).toEqual([]);
  });

  test("friendly ships test too, and an escort re-rolls a failure", () => {
    const s0 = atFirstTurn(true);
    const mf = fieldId(s0);
    const torch = getShip(s0, "ship-2");
    torch.position = { x: 45, y: 60 };
    torch.heading = 90;
    getShip(s0, "ship-3").position = { x: 45, y: 70 };
    const s = playDice(s0, { type: "move", player: "p1", shipId: "ship-2", path: [{ kind: "advance", distance: 10 }], disengage: false }, [6, 6, 1, 1]);
    expect(logOf(s, "minefield_test").at(-1)?.data).toEqual({ shipId: "ship-2", minefieldId: mf, leadership: 7, rolls: [6, 6], rerolls: [1, 1], passed: true });
  });

  test("lines of fire through a minefield are blocked", () => {
    const s0 = atStep(atFirstTurn(true), "shooting", "direct_fire");
    const agrippa = getShip(s0, "ship-1");
    agrippa.position = { x: 60, y: 72 };
    agrippa.heading = 90;
    const unclean = getShip(s0, "ship-4");
    unclean.position = { x: 60, y: 48 };
    const fire = (weaponId: string): Transform => ({ type: "fire", player: "p1", shipId: "ship-1", weaponId, target: { kind: "ship", id: "ship-4" } });
    expect(reason(s0, fire("starboard_battery"))).toBe("LINE_OF_FIRE_BLOCKED");
  });

  test("a minefield may be shot at as ordnance: each hit a Blast Marker at its edge facing the shooter", () => {
    const s0 = atStep(atFirstTurn(false), "shooting", "direct_fire");
    const mf = fieldId(s0);
    const unclean = getShip(s0, "ship-4");
    unclean.position = { x: 60, y: 40 };
    unclean.heading = 0;
    const t: Transform = { type: "fire", player: "p2", shipId: "ship-4", weaponId: "prow_lances", target: { kind: "minefield", id: mf } };
    expect(reason(s0, t)).toBe("ok");
    expect(reason(s0, { ...t, target: { kind: "minefield", id: "mf-99" } })).toBe("UNKNOWN_TARGET");
    const s = playDice(s0, t, [6, 6]); // lances need 6s against it
    expect(logOf(s, "minefield_hit").at(-1)?.data).toMatchObject({ minefieldId: mf, hits: 2 });
    expect(s.blastMarkers.map((bm) => bm.cause)).toEqual(["minefield", "minefield"]);
    expect(s.blastMarkers.map((bm) => bm.position)).toEqual([{ x: 60, y: 51.25 }, { x: 57.5, y: 51.25 }]);
  });

  test("each End Phase, a minefield sheds D6 of the Blast Markers touching it", () => {
    const s0 = atStep(atFirstTurn(true), "end", "blast_marker_removal");
    s0.blastMarkers = [0, 1].map((k) => ({ id: `bm-${s0.nextId++}`, position: { x: 57.5 + 2.5 * k, y: 51.25 }, placed: 1, cause: "minefield" as const }));
    const [b0, b1] = s0.blastMarkers.map((bm) => bm.id);
    // The player's own removal (D6 = 1) takes the second; then the minefield's own D6 = 1 sheds the other, apart from it.
    const s = playDice(s0, { type: "remove_blast_markers", player: "p1", priority: [b1!, b0!] }, [1, 1]);
    expect(logOf(s, "minefield_blast_markers").at(-1)?.data).toEqual({ minefieldId: fieldId(s0), rolls: [1], removed: [b0] });
    expect(s.blastMarkers).toEqual([]);
  });

  test("detection: in the owner's Ordnance Phase, a mine for each enemy ship detected, at the edge nearest it", () => {
    const s0 = atStep(atFirstTurn(true), "shooting", "launch_ordnance");
    const mf = fieldId(s0);
    keepMines(s0);
    const unclean = getShip(s0, "ship-4");
    unclean.position = { x: 40, y: 60 };
    const despair = getShip(s0, "ship-5");
    despair.position = { x: 60, y: 30 };
    despair.specialOrder = { kind: "all_ahead_full", issued: 0, expires: { playerTurn: 2, at: "movement_start" }, replaced: null };
    // Agrippa has torpedoes it needn't launch: end the step. Unclean rolls 4 (missed); Despair 4 + 1 for All Ahead Full.
    const s = playDice(s0, { type: "end_step", player: "p1" }, [4, 4]);
    expect(s.clock.step).toBe("active_ordnance");
    expect(logOf(s, "minefield_detection").at(-1)?.data).toEqual({
      minefieldId: mf,
      rolls: [4, 4],
      checks: [
        { shipId: "ship-4", roll: 4, modifier: 0, detected: false },
        { shipId: "ship-5", roll: 4, modifier: 1, detected: true, mineId: expect.any(String) },
      ],
    });
    expect(mines(s)).toEqual([{ id: expect.any(String), kind: "orbital_mine", owner: "p1", position: { x: 60, y: 52.5 }, source: "minefield" }]);
    expect(actor(s)).toBe("p1"); // it moves this step
    expect(victoryPoints(s, "p2").mines).toBe(15); // the three bought mines, dropped by the test setup, count as lost
  });

  test("torpedoes touching a minefield are destroyed; craft roll a D6", () => {
    const s0 = atStep(atFirstTurn(true), "ordnance", "active_ordnance");
    const mf = fieldId(s0);
    const o12 = freshId(s0);
    const o13 = freshId(s0);
    keepMines(s0);
    const salvo: TorpedoSalvo = { id: o12, kind: "torpedo_salvo", owner: "p1", launchedBy: "ship-1", launched: 1, position: { x: 75, y: 60 }, heading: 270, strength: 6, speed: 30, width: 2.5, attacks: [] };
    const wave: AttackCraftWave = { id: o13, kind: "attack_craft", owner: "p1", launchedBy: "ship-1", launched: 1, position: { x: 70, y: 68 }, squadrons: [{ role: "bomber", name: "Starhawk", speed: 20 }], cap: null };
    s0.ordnance.push(salvo, wave);
    let s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: o12 });
    expect(s.ordnance.map((o) => o.id)).toEqual([o13]);
    expect(logOf(s, "minefield_contact").at(-1)?.data).toEqual({ minefieldId: mf, ordnanceId: o12 });
    s = playDice(s, { type: "move_ordnance", player: "p1", ordnanceId: o13, path: [{ x: 50, y: 68 }] }, [6]);
    expect(logOf(s, "minefield_craft").at(-1)?.data).toEqual({ ordnanceId: o13, minefieldId: mf, rolls: [6], effect: "removed" });
    expect(s.ordnance).toEqual([]);
  });
});

describe("fire ships (state N121, T153, R71)", () => {
  test("3D6 cm: fires aboard capital ships, escorts and ordnance gone, a Blast Marker where it was", () => {
    const s0 = atFirstTurn(true);
    const [m1] = mineIds(s0);
    keepMines(s0, m1!);
    getShip(s0, "ship-2").position = { x: 90, y: 30 };
    getShip(s0, "ship-3").position = { x: 95, y: 30 };
    mine(s0, m1!).position = { x: 90, y: 25 };
    getShip(s0, "ship-5").position = { x: 100, y: 15 };
    expect(reason(s0, { type: "detonate", player: "p1", shipId: "ship-1" })).toBe("NOT_A_FIRE_SHIP");
    expect(reason(s0, { type: "detonate", player: "p2", shipId: "ship-4" })).toBe("NOT_YOUR_TURN");
    // 3D6 = 17 cm: Torch 2 (5 cm) is lost, the mine (5 cm) goes, Unclean (15 cm) takes D3 fires; Despair (18 cm) is out of reach.
    const s = playDice(s0, { type: "detonate", player: "p1", shipId: "ship-2" }, [6, 6, 5, 5]);
    expect(getShip(s, "ship-2")).toMatchObject({ status: "destroyed", position: null });
    expect(getShip(s, "ship-3").status).toBe("destroyed");
    expect(getShip(s, "ship-4").criticals.map((c) => c.kind)).toEqual(["fire", "fire", "fire"]);
    expect(getShip(s, "ship-5").criticals).toEqual([]);
    expect(logOf(s, "detonation").at(-1)?.data).toMatchObject({
      shipId: "ship-2",
      radiusRolls: [6, 6, 5],
      radius: 17,
      ships: [{ shipId: "ship-3", lost: true }, { shipId: "ship-4", rolls: [5], fires: 3 }],
      ordnanceIds: [m1!],
    });
    expect(s.blastMarkers.map((bm) => [bm.cause, bm.position])).toEqual([
      ["fire_ship", { x: 90, y: 30 }],
      ["escort_lost", { x: 95, y: 30 }],
    ]);
  });
});

describe("full games with mines, minefields and fire ships", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(MINED), seed, minefields: 2 });
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
  test.each([1, 2, 3, 4])("seed %i plays to a result", (seed) => {
    const s = playOut(seed);
    expect(s.result).not.toBeNull();
    expect(logOf(s, "defence_placed")).toHaveLength(5);
  }, 120_000);
});
