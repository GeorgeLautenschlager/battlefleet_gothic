/**
 * Fleet lists, fleet commanders, re-rolls and the Marks of Chaos (state v0.13
 * §7.4, §11, N20–N27; transforms v0.11 §2.7, §5, T56–T65; validator v0.9
 * V14; reducer v0.10 §2.2, R30–R32).
 */
import { describe, expect, test } from "vitest";
import { cloneJson } from "../src/state/json";
import { newGame, type GameConfig } from "../src/state/newGame";
import { checkInvariants } from "../src/state/invariants";
import { boardingValue, canBeBoarded, leadership, rerollFor, shipVP } from "../src/state/derived";
import { Ctx } from "../src/reducer/context";
import { applyCritical } from "../src/reducer/damage";
import { boardingCritical } from "../src/reducer/boarding";
import type { CommanderConfig } from "../src/rules/fleetLists";
import type { Commander, GameState } from "../src/state/types";
import { LUNAR_VS_MURDER } from "./helpers";
import { agrippa, battle, broadside, expectOk, expectReject, unclean } from "./validator-fixtures";
import { logOf, playDice } from "./reducer-helpers";

type Entry = { classId: string; options?: string[]; commander?: CommanderConfig };
const listed = (p1: Entry[], p2: Entry[], limit = 1000): GameConfig => ({
  ...cloneJson(LUNAR_VS_MURDER),
  options: { fleetLists: true },
  forces: { kind: "points", limit },
  scoring: "victory_points",
  ships: [...p1.map((s, i) => ({ owner: "p1" as const, name: `I${i}`, ...s })), ...p2.map((s, i) => ({ owner: "p2" as const, name: `C${i}`, ...s }))],
});
const warmaster: CommanderConfig = { kind: "warmaster", leadership: 8, marks: [] };
const admiral: CommanderConfig = { kind: "admiral", leadership: 9, extraRerolls: 0 };

describe("fleet lists (T58–T60, T65)", () => {
  test("Gothic Sector: one battlecruiser per two cruisers; an Admiral over 750 points", () => {
    expect(() => newGame(listed([{ classId: "mars" }, { classId: "lunar" }], [{ classId: "murder", commander: warmaster }]))).toThrow(/one battlecruiser per two cruisers/);
    const four = [{ classId: "mars" }, { classId: "lunar" }, { classId: "gothic" }, { classId: "tyrant" }];
    expect(() => newGame(listed(four, [{ classId: "murder", commander: warmaster }]))).toThrow(/over 750 points \(815\) must have an Admiral/);
    expect(() => newGame(listed([{ classId: "mars" }, { classId: "lunar" }, { classId: "lunar" }], [{ classId: "murder", commander: warmaster }]))).not.toThrow(); // 630
    const s = newGame(listed([{ ...four[0]!, commander: admiral }, ...four.slice(1)], [{ classId: "murder", commander: warmaster }]));
    expect(checkInvariants(s)).toEqual([]);
    expect(s.meta.options.fleetLists).toBe(true);
    expect(() => newGame(listed([{ classId: "lunar_nova" }], [{ classId: "murder", commander: warmaster }]))).toThrow(/isn't on the Gothic Sector fleet list/);
  });

  test("Chaos Incursion: a Warmaster always, on the most expensive ship; up to three Lords", () => {
    expect(() => newGame(listed([{ classId: "lunar" }], [{ classId: "murder" }]))).toThrow(/must have a Warmaster/);
    expect(() => newGame(listed([{ classId: "lunar" }], [{ classId: "murder", commander: warmaster }, { classId: "carnage" }]))).toThrow(/most expensive ship/);
    const lord: CommanderConfig = { kind: "lord", mark: null };
    const four = [{ classId: "carnage", commander: warmaster }, ...["murder", "murder", "murder", "murder"].map((classId) => ({ classId, commander: lord }))];
    expect(() => newGame(listed([{ classId: "lunar" }], four, 2000))).toThrow(/at most three Chaos Lords/);
    expect(() => newGame(listed([{ classId: "lunar", commander: { kind: "lord", mark: null } }], [{ classId: "murder", commander: warmaster }]))).toThrow(/Admirals/);
  });

  test("commanders cost points; without fleet lists there are none", () => {
    // 170 + Warmaster 100 + Khorne 20 + Nurgle 35 = 325 > 300
    const marked: CommanderConfig = { kind: "warmaster", leadership: 9, marks: ["khorne", "nurgle"] };
    expect(() => newGame(listed([{ classId: "lunar" }], [{ classId: "murder", commander: marked }], 300))).toThrow(/325 pts, over the 300/);
    expect(() => newGame({ ...listed([{ classId: "lunar" }], [{ classId: "murder", commander: warmaster }]), options: {} })).toThrow(/commanders come with the fleet lists/);
    expect(() => newGame({ ...listed([{ classId: "lunar" }], [{ classId: "murder", commander: warmaster }]), forces: { kind: "cruiser_clash" } })).toThrow(/need a points battle/);
  });
});

describe("commanders on their ships (state §7.4)", () => {
  test("Leadership, points, Marks and re-rolls; Nurgle adds a hit", () => {
    const tzeentchLord: CommanderConfig = { kind: "lord", mark: "tzeentch" };
    const s = newGame(
      listed(
        [{ classId: "lunar", commander: { kind: "admiral", leadership: 10, extraRerolls: 2 } }],
        [{ classId: "carnage", commander: { kind: "warmaster", leadership: 9, marks: ["nurgle", "slaanesh"] } }, { classId: "murder", commander: tzeentchLord }],
        1000,
      ),
    );
    expect(s.ships.map((x) => x.commander)).toEqual([
      { kind: "admiral", leadership: 10, points: 225, marks: [], rerolls: 3 },
      { kind: "warmaster", leadership: 9, points: 160, marks: ["nurgle", "slaanesh"], rerolls: 1 },
      { kind: "lord", leadership: 8, points: 80, marks: ["tzeentch"], rerolls: 1 },
    ]);
    expect(s.ships[1]!.profile.hits).toBe(9);
    expect(canBeBoarded(s.ships[1]!)).toBe(false);
  });
});

const lunarAdmiral = (rerolls = 1): Commander => ({ kind: "admiral", leadership: 9, points: 100, marks: [], rerolls });
const chaos = (marks: Commander["marks"], kind: Commander["kind"] = "warmaster", rerolls = 1): Commander => ({ kind, leadership: 8, points: 50, marks, rerolls });

describe("Leadership with commanders and Slaanesh (N22, N26)", () => {
  test("the commander's replaces the rolled value; −2 within 15 cm of an enemy Mark of Slaanesh", () => {
    const s = broadside(); // Agrippa (Ld 8) 24.3 cm from Unclean
    agrippa(s).commander = { ...lunarAdmiral(), leadership: 6 };
    expect(leadership(s, agrippa(s))).toBe(6); // even when lower
    unclean(s).commander = chaos(["slaanesh"]);
    expect(leadership(s, agrippa(s))).toBe(6); // 24 cm away
    agrippa(s).position = { x: 90, y: 50 };
    expect(leadership(s, agrippa(s))).toBe(4);
    expect(leadership(s, unclean(s))).toBe(8); // its own Mark doesn't touch it
  });

  test("ship value includes the commander for victory points (N25); Khorne doubles boarding value", () => {
    const s = battle();
    unclean(s).commander = chaos(["khorne"]);
    unclean(s).damage = 8;
    unclean(s).status = "drifting_hulk";
    expect(shipVP(unclean(s))?.vp).toBe(220);
    const t = battle();
    unclean(t).commander = chaos(["khorne"]);
    expect(boardingValue(unclean(t))).toBe(16);
  });
});

describe("re-rolls (transform §2.7, R30–R32)", () => {
  const order = (reroll: boolean) => ({ type: "declare_order", player: "p2", shipId: "ship-2", order: "lock_on", reroll }) as const;

  test("a failed Command check is re-rolled once, spending one; a pass spends nothing", () => {
    const s = battle();
    unclean(s).commander = chaos([]);
    // Ld 8 (commander): 6 + 5 fails; re-roll 2 + 3 passes
    const next = playDice(s, order(true), [6, 5, 2, 3]);
    expect(next.activation?.order).toBe("lock_on");
    expect(unclean(next).commander?.rerolls).toBe(0);
    expect(logOf(next, "reroll")[0]?.data).toEqual({ shipId: "ship-2", commanderShipId: "ship-2", test: "command_check", rolls: [2, 3], passed: true });
    expect(logOf(next, "command_check")[0]?.data).toMatchObject({ rolls: [6, 5], passed: false });
    const passed = playDice(s, order(true), [1, 1]);
    expect(unclean(passed).commander?.rerolls).toBe(1);
    const declined = playDice(s, order(false), [6, 6]);
    expect(declined.turnState.commandCheckFailed).toBe(true);
  });

  test("no re-roll to use is refused; the fleet commander's serve the fleet, a Lord's only his ship (N23–N24)", () => {
    const s = battle();
    expectReject(s, order(true), "NO_REROLL");
    const extra = cloneJson(s);
    extra.ships.push({ ...cloneJson(unclean(s)), id: "ship-9", name: "Flagship", commander: chaos([]), position: { x: 10, y: 110 } });
    extra.turnState.ships["ship-9"] = cloneJson(extra.turnState.ships["ship-2"]!);
    expect(rerollFor(extra, unclean(extra))?.id).toBe("ship-9");
    expectOk(extra, order(true));
    const lordOnly = cloneJson(s);
    lordOnly.ships.push({ ...cloneJson(unclean(s)), id: "ship-9", name: "Lord", commander: chaos(["tzeentch"], "lord"), position: { x: 10, y: 110 } });
    lordOnly.turnState.ships["ship-9"] = cloneJson(lordOnly.turnState.ships["ship-2"]!);
    expect(rerollFor(lordOnly, unclean(lordOnly))).toBeUndefined();
    expectReject(lordOnly, order(true), "NO_REROLL");
  });

  test("brace and priority tests take the flag too; a declined brace has nothing to re-roll", () => {
    const s = broadside();
    unclean(s).commander = chaos([]);
    expectOk(s, { type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target: { kind: "ship", id: "ship-1" }, reroll: true });
    // The brace: Agrippa's own re-roll (an Admiral aboard), only when attempting it.
    const offered = playDice(s, { type: "fire", player: "p2", shipId: "ship-2", weaponId: "starboard_battery", target: { kind: "ship", id: "ship-1" } }, []);
    const pendingId = offered.pending[0]!.id;
    expectReject(offered, { type: "answer_brace", player: "p1", pendingId, attempt: true, reroll: true }, "NO_REROLL");
    agrippa(offered).commander = lunarAdmiral();
    expectReject(offered, { type: "answer_brace", player: "p1", pendingId, attempt: false, reroll: true }, "NO_REROLL");
    // Ld 9: 6 + 5 fails; re-roll 1 + 2 passes; then the battery's 4 dice (no hits get through: 1s)
    const braced = playDice(offered, { type: "answer_brace", player: "p1", pendingId, attempt: true, reroll: true }, [6, 5, 1, 2, 1, 1, 1, 1]);
    expect(agrippa(braced).specialOrder?.kind).toBe("brace_for_impact");
    expect(logOf(braced, "reroll")[0]?.data).toMatchObject({ shipId: "ship-1", test: "command_check", passed: true });
  });

  test("Bridge Smashed on the commander's ship loses its re-rolls (R30)", () => {
    const s: GameState = battle();
    unclean(s).commander = chaos([], "warmaster", 2);
    const ctx = new Ctx(s);
    applyCritical(ctx, unclean(s), 9, [4, 5]);
    expect(unclean(s).commander?.rerolls).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ kind: "rerolls_lost", data: { shipId: "ship-2", reason: "bridge_smashed" } });
  });
});

describe("Marks in play", () => {
  test("Nurgle: the ship can't be boarded (T62)", () => {
    const s = battle();
    agrippa(s).commander = { ...lunarAdmiral(), marks: ["nurgle"] };
    expect(canBeBoarded(agrippa(s))).toBe(false);
  });

  test("the Warmaster's Khorne adds +1 to the boarding criticals his fight inflicts (R31)", () => {
    const s = battle();
    const ctx = new Ctx(s, [4, 1, 1]); // a 4 needs 5: +1 makes it; then the critical's 2D6
    boardingCritical(ctx, "ship-1", 5, 1);
    expect(logOf(s, "boarding_critical")[0]?.data).toMatchObject({ rolls: [4], critical: true, bonus: 1 });
  });
});
