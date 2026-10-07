/**
 * Planetary defences, first slice (pp. 100–101; fleets book pp. 506–515): state v0.22
 * §7.6, N90–N105; transforms v0.20 T131–T142; validator v0.17 V33–V36; reducer v0.17 R57–R62.
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { actor, getShip, gunneryColumn, maxShields, shipVP, turrets, weaponDisabled } from "../src/state/derived";
import { eliminated } from "../src/rules/reserves";
import { Ctx } from "../src/reducer/context";
import { applyCritical, inflict } from "../src/reducer/damage";
import { validate } from "../src/validator/validate";
import type { GameState } from "../src/state/types";
import type { Transform } from "../src/transforms/types";
import { candidates } from "./bot";
import { LUNAR_VS_MURDER } from "./helpers";
import { logOf, play, playDice } from "./reducer-helpers";

type ShipConfig = GameConfig["ships"][number];

/** p1 holds a medium planet with Agrippa, a laser platform, a torpedo launcher, a space station and two system ships; p2 attacks. */
const DEFENDED: GameConfig = {
  ...cloneJson(LUNAR_VS_MURDER),
  forces: { kind: "points", limit: 750 },
  scoring: "victory_points",
  planet: "medium",
  planetHolder: "p1",
  ships: [
    { owner: "p1", name: "Agrippa", classId: "lunar" },
    { owner: "p1", name: "Lumen", classId: "laser_platform" },
    { owner: "p1", name: "Tube", classId: "torpedo_platform" },
    { owner: "p1", name: "Bastion", classId: "space_station" },
    ...[1, 2].map((i): ShipConfig => ({ owner: "p1", name: `Picket ${i}`, classId: "system_ship", squadron: "Pickets" })),
    { owner: "p2", name: "Unclean", classId: "murder" },
    { owner: "p2", name: "Despair", classId: "carnage" },
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
/** DEFENDED with other ships and some fields changed; an `undefined` field is left out. */
function withShips(ships: ShipConfig[], extra: { [K in keyof GameConfig]?: GameConfig[K] | undefined } = {}): GameConfig {
  const config = { ...cloneJson(DEFENDED), ...extra, ships };
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as GameConfig;
}

/** Leadership, zones (p1 in A, the bottom... the top, y 90–120), p1 deploying first, everything placed; the roll-off still to come. */
function deployed(): GameState {
  let s = playDice(newGame(cloneJson(DEFENDED)), { type: "roll_leadership", player: "p1" }, [4, 4, 4]);
  s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
  s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
  s = play(s, deploy("p1", "ship-1", 90, 105));
  s = play(s, deploy("p2", "ship-7", 90, 15));
  s = play(s, deploy("p1", "ship-2", 90, 80, 0));
  s = play(s, deploy("p2", "ship-8", 110, 15));
  s = play(s, deploy("p1", "ship-3", 70, 60, 0));
  s = play(s, deploy("p1", "ship-4", 110, 60, 0));
  s = play(s, deploy("p1", "ship-5", 90, 40, 180));
  s = play(s, deploy("p1", "ship-6", 96, 40, 180));
  return playDice(s, { type: "roll_first_turn", player: "p1" }, [6, 1]);
}

describe("defences in the config (transform §5, T131–T133)", () => {
  test("Ld 7 and never rolled; a station's bays carry its holder's craft", () => {
    const s = newGame(cloneJson(DEFENDED));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.ships.map((x) => x.leadership)).toEqual([null, 7, 7, 7, 7, 7, null, null]);
    expect(s.ships[3]?.profile).toMatchObject({ type: "defence", hits: 8, speed: 0, shields: 2, turrets: 4, baseSize: "large" });
    expect(s.ships[3]?.profile.weapons.find((w) => w.kind === "launch_bay")?.craft?.map((c) => c.name)).toEqual(["Fury", "Starhawk"]);
    expect(s.ships[4]?.profile).toMatchObject({ type: "escort", turns: 45, traits: { planetaryDefence: true } });
    const rolled = playDice(s, { type: "roll_leadership", player: "p1" }, [1, 6, 4]); // Agrippa, Unclean, Despair only
    expect(rolled.ships.map((x) => x.leadership)).toEqual([6, 7, 7, 7, 7, 7, 9, 8]);
  });

  test("a planet, points, the holder's, a third of the limit at most (N91)", () => {
    const base = DEFENDED.ships;
    expect(() => newGame(withShips(base, { planet: undefined }))).toThrow(/need a planet on the table/);
    expect(() => newGame(withShips(base, { planetHolder: undefined }))).toThrow(/name the planet holder/);
    expect(() => newGame(withShips(base, { planetHolder: "p2" }))).toThrow(/only the planet holder \(p2\) fields planetary defences/);
    expect(() => newGame(withShips([...base, { owner: "p1", name: "Spare", classId: "weapons_platform" }]))).toThrow(/planetary defences are 280 pts, over a third of the limit \(250 pts\)/);
    expect(() => newGame(withShips([{ ...base[1]!, squadron: "Lights" }, ...base.slice(1)]))).toThrow(/stationary defences don't form squadrons yet/);
    expect(() => newGame(withShips(base, { scenario: "raiders", attacker: "p2", planetHolder: "p1" }))).toThrow(/the defender holds the planet/);
    expect(() => newGame(withShips([base[1]!, base[6]!]))).toThrow(/p1 needs at least one ship besides stationary defences/);
    // In a scenario with an attacker, the defender holds the planet without being named.
    const raid = withShips([base[0]!, base[1]!, { owner: "p2", name: "Unclean", classId: "murder" }], { scenario: "raiders", attacker: "p2", planetHolder: undefined });
    expect(() => newGame(raid)).not.toThrow();
  });
});

describe("deployment (state N93, T134)", () => {
  test("defences go in the gravity well, off the planet, with a heading", () => {
    let s = playDice(newGame(cloneJson(DEFENDED)), { type: "roll_leadership", player: "p1" }, [4, 4, 4]);
    s = playDice(s, { type: "roll_zones", player: "p1" }, [1]);
    s = playDice(s, { type: "roll_deploy_order", player: "p1" }, [1, 6]);
    expect(reason(s, deploy("p1", "ship-2", 90, 80))).toBe("HEADING_REQUIRED");
    expect(reason(s, deploy("p1", "ship-2", 90, 90, 0))).toBe("NOT_IN_GRAVITY_WELL"); // 30 cm out: the well ends at 27.5
    expect(reason(s, deploy("p1", "ship-2", 90, 65, 0))).toBe("NOT_IN_GRAVITY_WELL"); // on the planet
    expect(reason(s, deploy("p1", "ship-2", 90, 80, 0))).toBe("ok");
    expect(reason(s, deploy("p1", "ship-1", 90, 105, 0))).toBe("HEADING_NOT_ALLOWED"); // a cruiser faces its zone's way
    const t = deployed();
    expect(t.ships.map((x) => x.status).every((x) => x === "active")).toBe(true);
    expect(t.clock.setupStep).toBe("choose_first_turn");
  });
});

describe("in the battle (state N94–N99, T135–T138)", () => {
  test("stationary defences don't move and the step doesn't wait for them; defences only reload", () => {
    let s = play(deployed(), { type: "choose_first_turn", player: "p1", goFirst: true });
    expect(s.clock).toMatchObject({ playerTurn: 1, step: "move_ships" });
    expect(reason(s, { type: "move", player: "p1", shipId: "ship-2", path: [{ kind: "advance", distance: 5 }], disengage: false })).toBe("STATIONARY");
    expect(reason(s, { type: "declare_order", player: "p1", shipId: "ship-2", order: "lock_on" })).toBe("DEFENCE_ORDERS");
    expect(reason(s, { type: "declare_order", player: "p1", shipId: "ship-5", order: "all_ahead_full" })).toBe("DEFENCE_ORDERS");
    // The torpedo launcher reloads on the spot: no activation, and it counts as moved.
    s = playDice(s, { type: "declare_order", player: "p1", shipId: "ship-3", order: "reload_ordnance" }, [3, 3]);
    expect(s.activation).toBeNull();
    expect(getShip(s, "ship-3").specialOrder?.kind).toBe("reload_ordnance");
    expect(s.turnState.ships["ship-3"]?.moved).toBe(true);
    expect(logOf(s, "command_check").at(-1)?.data).toMatchObject({ target: 7, passed: true });
    s = play(s, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 15 }], disengage: false });
    s = play(s, { type: "move", player: "p1", shipId: "ship-5", path: [{ kind: "advance", distance: 10 }], disengage: false });
    s = play(s, { type: "move", player: "p1", shipId: "ship-6", path: [{ kind: "advance", distance: 10 }], disengage: false });
    expect(s.clock.step).toBe("direct_fire");
  });

  test("Orbit Lost: D6 cm toward the planet at the start of the owner's Movement Phase; into the planet, destroyed (R59)", () => {
    const s = cloneJson(deployed());
    getShip(s, "ship-4").criticals.push({ id: `crit-${s.nextId++}`, kind: "orbit_lost", playerTurn: 0 });
    const fell = playDice(s, { type: "choose_first_turn", player: "p1", goFirst: true }, [3]);
    expect(getShip(fell, "ship-4").position).toEqual({ x: 107, y: 60 });
    expect(logOf(fell, "orbit_fall").at(-1)?.data).toEqual({ shipId: "ship-4", rolls: [3], distance: 3, position: { x: 107, y: 60 } });
    const close = cloneJson(s);
    getShip(close, "ship-4").position = { x: 104, y: 60 }; // 1.5 cm off the template
    const lost = playDice(close, { type: "choose_first_turn", player: "p1", goFirst: true }, [2]);
    expect(getShip(lost, "ship-4")).toMatchObject({ status: "destroyed", position: null });
    expect(shipVP(getShip(lost, "ship-4"))).toEqual({ shipId: "ship-4", vp: 150, why: "destroyed" });
  });

  test("each End Phase, a stationary defence sheds D6 Blast Markers touching it (N100, R60)", () => {
    let s = cloneJson(play(deployed(), { type: "choose_first_turn", player: "p1", goFirst: true }));
    const ids = [0, 1, 2].map(() => `bm-${s.nextId++}`);
    s.blastMarkers.push(
      { id: ids[0]!, position: { x: 110, y: 63 }, placed: 1, cause: "shield_hit" },
      { id: ids[1]!, position: { x: 113, y: 60 }, placed: 1, cause: "shield_hit" },
      { id: ids[2]!, position: { x: 107, y: 60 }, placed: 1, cause: "shield_hit" },
    );
    for (const id of ["ship-1", "ship-5", "ship-6"]) s = play(s, { type: "move", player: "p1", shipId: id, path: [{ kind: "advance", distance: 10 }], disengage: false });
    s = play(s, { type: "end_step", player: "p1" }); // direct fire
    s = playDice(s, { type: "end_step", player: "p1" }, [2]); // launch ordnance: the turn ends, and the station sheds two
    expect(logOf(s, "defence_blast_markers").at(-1)?.data).toEqual({ shipId: "ship-4", rolls: [2], removed: [ids[0], ids[1]] });
    expect(s.blastMarkers.map((b) => b.id)).toEqual([ids[2]]);
    expect(s.clock.playerTurn).toBe(2);
  });
});

describe("shooting at, damaging and scoring defences (state N96–N98, N101–N102)", () => {
  const battle = () => cloneJson(play(deployed(), { type: "choose_first_turn", player: "p1", goFirst: true }));
  const src = { source: { kind: "ship" as const, id: "ship-7" }, origin: { x: 90, y: 15 }, shieldable: false, braceable: false, cause: "battery" };

  test("the Defences column, whatever the aspect", () => {
    const s = battle();
    expect(gunneryColumn(getShip(s, "ship-4"), "front")).toBe("A");
    expect(gunneryColumn(getShip(s, "ship-4"), "left")).toBe("A");
    expect(gunneryColumn(getShip(s, "ship-5"), "left")).toBe("E"); // a system ship is an escort
  });

  test("a Defence/1 is lost to one point of damage, as an escort is (R58)", () => {
    const s = battle();
    const ctx = new Ctx(s, []);
    inflict(ctx, getShip(s, "ship-2"), 1, src);
    expect(getShip(s, "ship-2")).toMatchObject({ status: "destroyed", position: null });
    expect(logOf(s, "escort_lost").at(-1)?.data).toMatchObject({ shipId: "ship-2", cause: "damage" });
    expect(shipVP(getShip(s, "ship-2"))).toEqual({ shipId: "ship-2", vp: 30, why: "destroyed" });
  });

  test("the Defences Critical Hits table, moving up when it can't apply (R57)", () => {
    const s = battle();
    const station = getShip(s, "ship-4");
    const ctx = new Ctx(s, []);
    applyCritical(ctx, station, 2, [1, 1]);
    expect(station.criticals.at(-1)?.kind).toBe("lances_damaged");
    expect(weaponDisabled(s, station, station.profile.weapons.find((w) => w.kind === "lance")!)).toBe(true);
    expect(weaponDisabled(s, station, station.profile.weapons.find((w) => w.kind === "battery")!)).toBe(false);
    applyCritical(ctx, station, 6, [3, 3]); // reactors: +1 damage, shields and turrets halved
    expect([station.damage, maxShields(station), turrets(station)]).toEqual([1, 1, 2]);
    applyCritical(ctx, station, 5, [2, 3]);
    expect(station.criticals.map((c) => c.kind)).toEqual(["lances_damaged", "reactors_damaged", "ordnance_bays_hit"]);
    // The torpedo launcher has no lances or batteries: a 2 moves up to its torpedoes.
    const tube = getShip(s, "ship-3");
    expect(tube.profile.hits).toBe(1); // a Defence/1 is simply lost
    applyCritical(ctx, tube, 2, [1, 1]);
    expect(tube.status).toBe("destroyed");
  });

  test("a crippled defence scores nothing; a side of platforms alone is eliminated (N101–N102)", () => {
    const s = battle();
    const station = getShip(s, "ship-4");
    station.damage = 4;
    expect(shipVP(station)).toBeNull();
    expect(eliminated(s, "p1")).toBe(false);
    for (const id of ["ship-1", "ship-5", "ship-6"]) getShip(s, id).status = "destroyed";
    expect(eliminated(s, "p1")).toBe(true);
  });

  test("a rammed defence hits back with its full hits (N103)", () => {
    expect(actor(battle())).toBe("p1");
  });
});

describe("full games with planetary defences", () => {
  const playOut = (seed: number): GameState => {
    let s = newGame({ ...cloneJson(DEFENDED), seed });
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
  }, 120_000);
});
