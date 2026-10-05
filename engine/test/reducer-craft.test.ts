/**
 * Attack craft (reducer spec §9.1, §9.3–9.7, §7.5, §8.2), with scripted dice so
 * each test pins the draw order.
 *
 * battle(): Agrippa (ship-1, p1, Lunar: 2 turrets, armour 6/5/5/5) at (85, 15) h0;
 * Unclean (ship-2, p2, Murder: 2 turrets, armour 5) at (100, 105) h180.
 * Player turn 1 is p2's, 2 is p1's. Small bases: radius 1.6.
 */
import { describe, expect, test } from "vitest";
import { CATALOGUE } from "../src/state/catalogue";
import { cloneJson } from "../src/state/json";
import { checkInvariants } from "../src/state/invariants";
import { turretDice } from "../src/reducer/turrets";
import type { AttackCraftWave, GameState } from "../src/state/types";
import { addBm, addSalvo, addShip, agrippa, battle, unclean } from "./validator-fixtures";
import { logOf, play, playDice } from "./reducer-helpers";
import { addCap, addWave, carriers, DOOMFIRE, DREADCLAW, FURY, STARHAWK, SWIFTDEATH } from "./craft-fixtures";

const waves = (s: GameState): AttackCraftWave[] => s.ordnance.filter((o): o is AttackCraftWave => o.kind === "attack_craft");
const names = (w: AttackCraftWave | undefined) => w?.squadrons.map((q) => q.name);
const removed = (s: GameState) => logOf(s, "ordnance_removed").map((e) => e.data["reason"]);
const fly = (ordnanceId: string, path: { x: number; y: number }[], player: "p1" | "p2" = "p1", cap?: string) =>
  ({ type: "move_ordnance", player, ordnanceId, path, ...(cap === undefined ? {} : { cap }) }) as const;
const decline = (s: GameState) => ({ type: "answer_brace", player: s.pending[0]!.player, pendingId: s.pending[0]!.id, attempt: false }) as const;

/** Agrippa as a Dictator; Unclean stays a Murder. */
function dictator(s: GameState): GameState {
  agrippa(s).profile = cloneJson(CATALOGUE["dictator"]!.profile);
  agrippa(s).loaded = { torpedoes: true, launchBays: true };
  return s;
}

describe("launching (§9.1)", () => {
  test("waves at the launcher's stem, CAP split into single fighters; the bays are spent, the torpedoes aren't", () => {
    const s = play(dictator(battle("shooting", "launch_ordnance", 2)), {
      type: "launch_attack_craft", player: "p1", shipId: "ship-1",
      waves: [{ roles: ["fighter", "bomber"], cap: false }, { roles: ["fighter", "fighter"], cap: true }], recall: [],
    });
    expect(waves(s)).toMatchObject([
      { owner: "p1", launchedBy: "ship-1", launched: 2, position: { x: 85, y: 15 }, squadrons: [FURY, STARHAWK], cap: null },
      { position: { x: 85, y: 15 }, squadrons: [FURY], cap: "ship-1" },
      { position: { x: 85, y: 15 }, squadrons: [FURY], cap: "ship-1" },
    ]);
    expect(agrippa(s).loaded).toEqual({ torpedoes: true, launchBays: false });
    expect(s.turnState.ships["ship-1"]!.weaponsFired).toEqual(["port_launch_bays", "starboard_launch_bays"]);
    expect(s.clock.step).toBe("launch_ordnance"); // the torpedoes can still go
    expect(logOf(s, "craft_launch")[0]?.data).toMatchObject({ shipId: "ship-1", recalled: [] });

    // Torpedoes too: then on to the Ordnance Phase, where CAP doesn't need to move.
    const t = play(s, { type: "launch_torpedoes", player: "p1", shipId: "ship-1", weaponId: "prow_torpedoes", bearing: 0 });
    expect(t.clock.step).toBe("active_ordnance");
    const wave = waves(t)[0]!;
    const salvo = t.ordnance.find((o) => o.kind === "torpedo_salvo")!;
    const u = play(play(t, fly(wave.id, [{ x: 85, y: 30 }])), { type: "move_ordnance", player: "p1", ordnanceId: salvo.id });
    expect(u.clock.playerTurn).toBe(3); // nothing else to move: the turn ran on
  });

  test("recalled waves are removed first", () => {
    const s0 = dictator(battle("shooting", "launch_ordnance", 2));
    const old = addWave(s0, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...FURY }, { ...STARHAWK }, { ...STARHAWK }] });
    const s = play(s0, { type: "launch_attack_craft", player: "p1", shipId: "ship-1", waves: [{ roles: ["bomber"], cap: false }], recall: [old.id] });
    expect(waves(s).map(names)).toEqual([["Starhawk"]]);
    expect(removed(s)).toEqual(["recalled"]);
  });
});

describe("flying a wave (§9.4)", () => {
  const ordnancePhase = (): GameState => dictator(battle("ordnance", "active_ordnance", 2));

  test("along its waypoints", () => {
    const s0 = ordnancePhase();
    const wave = addWave(s0, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...STARHAWK }] });
    const s = play(s0, fly(wave.id, [{ x: 60, y: 50 }, { x: 60, y: 60 }]));
    expect(waves(s)[0]!.position).toEqual({ x: 60, y: 60 });
    expect(logOf(s, "craft_move")[0]?.data).toMatchObject({ ordnanceId: wave.id, to: { x: 60, y: 60 }, stoppedBy: null });
  });

  test("a Blast Marker on the way: a 6 removes the whole wave (p. 75, p. 85)", () => {
    const s0 = ordnancePhase();
    const wave = addWave(s0, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...STARHAWK }] });
    addBm(s0, 50, 60);
    expect(removed(playDice(s0, fly(wave.id, [{ x: 50, y: 70 }]), [6]))).toEqual(["blast_marker"]);
    const s = playDice(s0, fly(wave.id, [{ x: 50, y: 70 }]), [5]);
    expect(waves(s)[0]!.position).toEqual({ x: 50, y: 70 }); // one roll a move
  });

  test("a fighter meeting torpedoes: one fighter and the whole salvo go (T22)", () => {
    const s0 = ordnancePhase();
    const wave = addWave(s0, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...STARHAWK }] });
    const salvo = addSalvo(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 60 }, heading: 90 });
    const s = play(s0, fly(wave.id, [{ x: 50, y: 70 }]));
    expect(s.ordnance.some((o) => o.id === salvo.id)).toBe(false);
    expect(names(waves(s)[0])).toEqual(["Starhawk"]);
    expect(waves(s)[0]!.position).toEqual({ x: 50, y: 70 }); // flies on
    expect(logOf(s, "intercept")[0]?.data).toMatchObject({ ordnanceId: wave.id, salvoId: salvo.id, lost: ["Fury"] });
  });

  test("a dogfight: fighters first, then fighters against bombers, marker for marker (p. 85)", () => {
    const s0 = ordnancePhase();
    const mine = addWave(s0, { position: { x: 50, y: 50 }, squadrons: [{ ...FURY }, { ...FURY }, { ...STARHAWK }] });
    const theirs = addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 62 }, squadrons: [{ ...SWIFTDEATH }, { ...DOOMFIRE }, { ...DOOMFIRE }] });
    const s = play(s0, fly(mine.id, [{ x: 50, y: 70 }]));
    expect(names(s.ordnance.find((o) => o.id === mine.id) as AttackCraftWave)).toEqual(["Starhawk"]);
    expect(names(s.ordnance.find((o) => o.id === theirs.id) as AttackCraftWave)).toEqual(["Doomfire"]);
    expect(logOf(s, "dogfight")[0]?.data).toMatchObject({ lost: [["Fury", "Fury"], ["Swiftdeath", "Doomfire"]] });
    // Neither has fighters left, so the bombers pass each other.
    expect(s.ordnance.find((o) => o.id === mine.id)!.position).toEqual({ x: 50, y: 70 });
  });

  test("an enemy ship stops it; fighters alone do nothing and stay (p. 82); next move it can leave (R16)", () => {
    const s0 = ordnancePhase();
    const wave = addWave(s0, { position: { x: 100, y: 85 } });
    const s = play(s0, fly(wave.id, [{ x: 100, y: 104 }]));
    const stopped = waves(s)[0]!;
    expect(stopped.position.y).toBeCloseTo(105 - 2.6, 9);
    expect(logOf(s, "craft_meets_ship")[0]?.data).toMatchObject({ result: "no_effect" });

    const again = ordnancePhase();
    const parked = addWave(again, { position: { x: 100, y: 105 - 2.6 } });
    const t = play(again, fly(parked.id, [{ x: 100, y: 80 }]));
    expect(waves(t)[0]!.position).toEqual({ x: 100, y: 80 });
  });

  test("going on CAP: one fighter per squadron, at the ship's stem", () => {
    const s0 = ordnancePhase();
    const wave = addWave(s0, { position: { x: 85, y: 35 }, squadrons: [{ ...FURY }, { ...FURY }] });
    const s = play(s0, fly(wave.id, [{ x: 85, y: 18 }], "p1", "ship-1"));
    expect(waves(s)).toMatchObject([
      { id: wave.id, cap: "ship-1", position: { x: 85, y: 15 }, squadrons: [FURY] },
      { cap: "ship-1", position: { x: 85, y: 15 }, squadrons: [FURY] },
    ]);
    expect(logOf(s, "cap_formed")[0]?.data["ordnanceIds"]).toHaveLength(2);
  });

  test("CAP fighters leave CAP by moving in the opponent's Ordnance Phase", () => {
    const s0 = dictator(battle("ordnance", "inactive_ordnance", 1));
    const cap = addCap(s0, "ship-1");
    const s = play(s0, fly(cap.id, [{ x: 85, y: 40 }]));
    expect(waves(s)[0]).toMatchObject({ cap: null, position: { x: 85, y: 40 } });
    expect(logOf(s, "cap_released")[0]?.data).toMatchObject({ shipId: "ship-1", reason: "moved" });
  });
});

describe("torpedoes against attack craft and CAP", () => {
  const theirTurn = (): GameState => battle("ordnance", "active_ordnance", 1); // p2 moves first

  test("a salvo meeting an enemy wave with fighters is intercepted; a bombers-only wave doesn't stop it", () => {
    const s0 = battle("ordnance", "active_ordnance", 2);
    const salvo = addSalvo(s0, { position: { x: 50, y: 40 }, heading: 0 });
    addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 55 }, squadrons: [{ ...SWIFTDEATH }, { ...DOOMFIRE }] });
    const s = play(s0, { type: "move_ordnance", player: "p1", ordnanceId: salvo.id });
    expect(s.ordnance.some((o) => o.id === salvo.id)).toBe(false);
    expect(names(waves(s)[0])).toEqual(["Doomfire"]);

    const b0 = battle("ordnance", "active_ordnance", 2);
    const through = addSalvo(b0, { position: { x: 50, y: 40 }, heading: 0 });
    addWave(b0, { owner: "p2", launchedBy: "ship-2", position: { x: 50, y: 55 }, squadrons: [{ ...DOOMFIRE }] });
    const b = play(b0, { type: "move_ordnance", player: "p1", ordnanceId: through.id });
    expect(b.ordnance.find((o) => o.id === through.id)?.position.y).toBeCloseTo(70, 9);
  });

  test("CAP screens: one CAP fighter and the salvo go, before turrets (§9.3)", () => {
    const s0 = theirTurn();
    addCap(s0, "ship-1");
    const salvo = addSalvo(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 85, y: 40 }, heading: 180 });
    const s = playDice(s0, { type: "move_ordnance", player: "p2", ordnanceId: salvo.id }, []);
    expect(s.ordnance).toEqual([]);
    expect(logOf(s, "cap_screen")).toHaveLength(1);
    expect(removed(s)).toEqual(["intercepted", "cap"]);
  });

  test("massed turrets: +1 per friendly ship in base contact, not crippled (p. 80)", () => {
    const s0 = theirTurn();
    addShip(s0, agrippa(s0), { id: "ship-3", name: "Hammer of Terra", position: { x: 88.2, y: 15 } });
    const salvo = addSalvo(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 85, y: 40 }, heading: 180, strength: 2 });
    addSalvo(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 20, y: 60 }, heading: 90 }); // unmoved: keeps the step open
    const braced = playDice(s0, { type: "move_ordnance", player: "p2", ordnanceId: salvo.id }, []);
    const s = playDice(braced, decline(braced), [4, 4, 1]); // 2 own + 1 massed: two stopped, the salvo's gone
    expect(logOf(s, "turrets")[0]?.data).toMatchObject({ shipId: "ship-1", against: "torpedoes", own: 2, massed: ["ship-3"], stopped: 2 });
    expect(removed(s)).toEqual(["turrets"]);
    expect(s.turnState.ships["ship-3"]!.turrets).toEqual({ phase: "ordnance", against: "torpedoes" });
  });

  test("turret dice: no massing in the Movement Phase; a ship whose turrets fired at torpedoes can't help against craft (T23–T24)", () => {
    const s = battle("ordnance", "active_ordnance", 1);
    addShip(s, agrippa(s), { id: "ship-3", position: { x: 88.2, y: 15 } });
    addShip(s, agrippa(s), { id: "ship-4", position: { x: 81.8, y: 15 } });
    addShip(s, agrippa(s), { id: "ship-5", position: { x: 85, y: 18.2 } });
    addShip(s, agrippa(s), { id: "ship-6", position: { x: 85, y: 11.8 } });
    expect(turretDice(cloneJson(s), agrippa(s), "attack_craft")).toEqual({ own: 2, massed: ["ship-3", "ship-4", "ship-5"], dice: 5 }); // up to +3

    const used = cloneJson(s);
    used.turnState.ships["ship-3"]!.turrets = { phase: "ordnance", against: "torpedoes" };
    used.turnState.ships["ship-1"]!.turrets = { phase: "ordnance", against: "torpedoes" };
    expect(turretDice(used, agrippa(used), "attack_craft")).toEqual({ own: 0, massed: ["ship-4", "ship-5", "ship-6"], dice: 3 });

    const crippled = cloneJson(s);
    crippled.ships.find((x) => x.id === "ship-3")!.damage = 4;
    expect(turretDice(crippled, agrippa(crippled), "torpedoes").massed).toEqual(["ship-4", "ship-5", "ship-6"]);

    const moving = cloneJson(s);
    moving.clock = { ...moving.clock, phase: "movement", step: "move_ships" };
    expect(turretDice(moving, agrippa(moving), "attack_craft")).toEqual({ own: 2, massed: [], dice: 2 });
  });
});

describe("attack craft meeting a ship (§9.6–9.7)", () => {
  test("bombers: D6 − turrets attacks each, +1 per escort, against the lowest armour; brace offered first", () => {
    const s0 = dictator(battle("ordnance", "active_ordnance", 2));
    const wave = addWave(s0, { position: { x: 100, y: 85 }, squadrons: [{ ...FURY }, { ...STARHAWK }, { ...STARHAWK }] });
    const offered = playDice(s0, fly(wave.id, [{ x: 100, y: 104 }]), []);
    expect(offered.pending[0]).toMatchObject({ player: "p2", shipId: "ship-2", source: { kind: "ordnance", id: wave.id } });
    // Turrets [4, 1]: the Fury goes. Bombers [6, 3] − 2 turrets: 4 + 1, +1 escort = 6 attacks.
    // Attacks [5, 5, 1, 1, 6, 2] at 5+: 3 hits. Critical checks [1, 1, 1].
    const s = playDice(offered, decline(offered), [4, 1, 6, 3, 5, 5, 1, 1, 6, 2, 1, 1, 1]);
    expect(logOf(s, "craft_attack")[0]?.data).toMatchObject({
      bombers: 2, escorts: 1, own: 2, bomberRolls: [6, 3], attacks: 6, need: 5, hits: 3, boats: 0,
    });
    expect(unclean(s).damage).toBe(3);
    expect(waves(s)).toEqual([]);
    expect(removed(s)).toEqual(["spent"]);
  });

  test("assault boats: a Hit-and-Run each (§9.7)", () => {
    const s0 = carriers(battle("ordnance", "active_ordnance", 1));
    agrippa(s0).profile = cloneJson(CATALOGUE["lunar"]!.profile); // prow torpedoes: a 5 is Prow Armament Damaged
    const wave = addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 85, y: 35 }, squadrons: [{ ...DREADCLAW }] });
    const offered = playDice(s0, fly(wave.id, [{ x: 85, y: 16 }], "p2"), []);
    const s = playDice(offered, decline(offered), [1, 1, 5]); // turrets miss; Hit-and-Run 5
    expect(logOf(s, "hit_and_run")[0]?.data).toMatchObject({ targetId: "ship-1", rolls: [5], result: "critical" });
    expect(agrippa(s).criticals.map((c) => c.kind)).toEqual(["prow_armament"]);
  });

  test("CAP dogfights an incoming wave first: here it wipes it out", () => {
    const s0 = battle("ordnance", "active_ordnance", 1);
    addCap(s0, "ship-1");
    addCap(s0, "ship-1");
    const wave = addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 85, y: 35 }, squadrons: [{ ...SWIFTDEATH }, { ...DOOMFIRE }] });
    const s = playDice(s0, fly(wave.id, [{ x: 85, y: 17 }], "p2"), []);
    expect(s.ordnance).toEqual([]);
    expect(logOf(s, "dogfight")[0]?.data).toMatchObject({ lost: [["Fury", "Fury"], ["Swiftdeath", "Doomfire"]] });
  });

  test("a ship moving into bombers is attacked mid-move, with unmassed turrets (§8.2)", () => {
    const s0 = battle("movement", "move_ships", 2);
    addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 85, y: 25 }, squadrons: [{ ...DOOMFIRE }] });
    const offered = playDice(s0, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 20 }], disengage: false }, []);
    expect(agrippa(offered).position!.y).toBeCloseTo(25 - 2.6, 9);
    // Turrets [1, 1]; one bomber [6] − 2 = 4 attacks [6, 6, 6, 1] at 5+: 3 hits; criticals [1, 1, 1].
    const s = playDice(offered, decline(offered), [1, 1, 6, 6, 6, 6, 1, 1, 1, 1]);
    expect(agrippa(s).damage).toBe(3);
    expect(agrippa(s).position!.y).toBeCloseTo(35, 9); // the move carried on
  });
});

describe("CAP and its ship (§7.5, §8.2)", () => {
  test("CAP rides along when its ship moves", () => {
    const s0 = battle("movement", "move_ships", 2);
    addCap(s0, "ship-1");
    const s = play(s0, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 10 }], disengage: false });
    expect(waves(s)[0]!.position).toEqual(agrippa(s).position);
  });

  test("released at the start of the Movement Phase", () => {
    const s0 = battle("movement", "move_ships", 2);
    const cap = addCap(s0, "ship-1");
    const s = play(s0, { type: "release_cap", player: "p1", ordnanceId: cap.id });
    expect(waves(s)[0]!.cap).toBeNull();
    expect(logOf(s, "cap_released")[0]?.data).toMatchObject({ reason: "order" });
  });

  test("a ship leaving the table leaves its CAP where it was (T30)", () => {
    const s0 = battle("movement", "move_ships", 2);
    agrippa(s0).position = { x: 85, y: 5 };
    agrippa(s0).heading = 180;
    addCap(s0, "ship-1");
    const s = play(s0, { type: "move", player: "p1", shipId: "ship-1", path: [{ kind: "advance", distance: 10 }], disengage: false });
    expect(agrippa(s).status).toBe("disengaged");
    expect(waves(s)[0]).toMatchObject({ cap: null });
    expect(waves(s)[0]!.position.y).toBeCloseTo(0, 9);
    expect(logOf(s, "cap_released")[0]?.data).toMatchObject({ reason: "ship_lost" });
  });

  test("CAP can't be shot at, and a free wave dies whole when hit (p. 85)", () => {
    const s0 = dictator(battle("shooting", "direct_fire", 2));
    agrippa(s0).position = { x: 100, y: 80 };
    agrippa(s0).heading = 90;
    const wave = addWave(s0, { owner: "p2", launchedBy: "ship-2", position: { x: 100, y: 95 }, squadrons: [{ ...SWIFTDEATH }, { ...DOOMFIRE }, { ...DOOMFIRE }] });
    const s = playDice(s0, { type: "fire", player: "p1", shipId: "ship-1", weaponId: "port_battery", target: { kind: "ordnance", id: wave.id } }, [6, 1]);
    expect(waves(s)).toEqual([]);
    expect(removed(s)).toEqual(["shot"]);
  });
});

describe("invariant 13", () => {
  test("CAP is a single fighter at an active friendly ship's stem", () => {
    const s = battle();
    const cap = addCap(s, "ship-1");
    expect(checkInvariants(s)).toEqual([]);
    cap.position = { x: 0, y: 0 };
    cap.squadrons.push({ ...STARHAWK });
    expect(checkInvariants(s).map((v) => v.rule)).toEqual(["I13", "I13"]);
  });
});
