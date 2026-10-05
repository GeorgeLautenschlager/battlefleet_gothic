import { describe, expect, test } from "vitest";
import { activePlayer, validate, type AttackCraftWave, type GameState, type Transform } from "@bfg/engine";
import { apply, current, start, type History } from "../src/game/history";
import { cruiserClash } from "../src/game/config";
import { capChoices, defaultCounts, launchTransform, movableWaves, moveTransform, nextWaypoint, pathLength } from "../src/craft/craft";
import { describe as prose } from "../src/log/format";

const play = (h: History, t: Transform): History => {
  const r = apply(h, t);
  if (!r.ok) throw new Error(r.reason.message);
  return r.history;
};

/** A Dictator against a Devastation, deployed facing each other, the first player at their launch step. */
function launchStep(): History {
  let h = start(
    cruiserClash(
      {
        p1: { name: "Ann", fleet: "imperial_navy", ships: ["Fortitude"], carrier: true },
        p2: { name: "Bo", fleet: "chaos", ships: ["Deathbane"], carrier: true },
        ramming: true,
        boarding: false,
        carriers: true,
        seed: 11,
      },
      new Date("2026-10-05T12:00:00Z"),
    ),
  );
  for (const step of ["roll_leadership", "roll_zones", "roll_deploy_order"] as const) {
    while (current(h).clock.setupStep === step) h = play(h, { type: step, player: "p1" });
  }
  while (current(h).clock.setupStep === "deploy") {
    const s = current(h);
    const t = s.ships
      .map((x): Transform => ({ type: "deploy_ship", player: x.owner, shipId: x.id, position: { x: 90, y: s.setup.zones?.[x.owner] === "A" ? 100 : 20 } }))
      .find((x) => apply(h, x).ok);
    if (t === undefined) throw new Error("nobody can deploy");
    h = play(h, t);
  }
  while (current(h).clock.setupStep === "roll_first_turn") h = play(h, { type: "roll_first_turn", player: "p1" });
  const chooser = current(h).setup.firstTurnChooser!;
  h = play(h, { type: "choose_first_turn", player: chooser, goFirst: true });
  const me = activePlayer(current(h));
  const ship = current(h).ships.find((x) => x.owner === me)!;
  h = play(h, { type: "move", player: me, shipId: ship.id, path: [{ kind: "advance", distance: 10 }], disengage: false });
  return play(h, { type: "end_step", player: me });
}

const waves = (s: GameState) => s.ordnance.filter((o): o is AttackCraftWave => o.kind === "attack_craft");

describe("launching", () => {
  test("one strike wave plus CAP fighters, from the counts", () => {
    const h = launchStep();
    const s = current(h);
    expect(s.clock.step).toBe("launch_ordnance");
    const ship = s.ships.find((x) => x.owner === activePlayer(s))!;
    expect(defaultCounts(ship, 4)).toMatchObject({ fighter: 2, bomber: 2 });
    const t = launchTransform(ship, { fighter: 1, bomber: 2, assault_boat: 0 }, 1, []);
    expect(t.waves).toEqual([{ roles: ["fighter", "bomber", "bomber"], cap: false }, { roles: ["fighter"], cap: true }]);
    expect(validate(s, t).ok).toBe(true);
    const after = current(play(h, t));
    expect(waves(after).map((w) => [w.squadrons.length, w.cap])).toEqual([[3, null], [1, ship.id]]);
  });
});

describe("flying", () => {
  /** After the launch, at the first player's active_ordnance step with a 3-squadron wave and a CAP fighter. */
  function flying(): History {
    let h = launchStep();
    const s = current(h);
    const ship = s.ships.find((x) => x.owner === activePlayer(s))!;
    h = play(h, launchTransform(ship, { fighter: 1, bomber: 2, assault_boat: 0 }, 1, []));
    // The Dictator still has torpedoes: done launching.
    if (current(h).clock.step === "launch_ordnance") h = play(h, { type: "end_step", player: activePlayer(current(h)) });
    return h;
  }

  test("CAP stays out of the list in your own Ordnance Phase; waypoints stop at the wave's speed", () => {
    const h = flying();
    const s = current(h);
    expect(s.clock.step).toBe("active_ordnance");
    const [wave] = movableWaves(s);
    expect(movableWaves(s)).toHaveLength(1);
    expect(wave!.cap).toBeNull();
    const far = nextWaypoint(s, wave!, [], { x: wave!.position.x, y: wave!.position.y + 100 });
    expect(pathLength(wave!.position, [far])).toBeLessThanOrEqual(20); // bombers fly 20 cm
    expect(pathLength(wave!.position, [far])).toBeGreaterThan(19.8);
    expect(validate(s, moveTransform(s, wave!, [far])).ok).toBe(true);
    expect(capChoices(s, wave!, [])).toEqual([]); // it has bombers
    const next = current(play(h, moveTransform(s, wave!, [far])));
    expect(next.log.some((e) => e.kind === "craft_move")).toBe(true);
  });
});

describe("log prose", () => {
  test("attack craft entries read as sentences", () => {
    const s = current(launchStep());
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 1, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    const target = s.ships[1]!;
    expect(prose(s, entry("craft_attack", { targetId: target.id, bombers: 2, escorts: 1, own: 3, bomberRolls: [6, 4], attacks: 5, need: 5, attackRolls: [5, 6, 1, 2, 3], hits: 2, boats: 0 }))).toBe(
      `Attack craft strike ${target.name}: 2 bombers [6 4] − 3 turrets, +1 escorts: 5 attacks [5 6 1 2 3] need 5+, 2 hits`,
    );
    expect(prose(s, entry("dogfight", { ordnanceIds: [["ord-1"], ["ord-2"]], lost: [["Fury"], ["Swiftdeath", "Doomfire"]] }))).toBe("Dogfight: Fury lost against Swiftdeath, Doomfire");
    expect(prose(s, entry("turrets", { shipId: target.id, against: "attack_craft", own: 3, massed: ["ship-9"], rolls: [4, 1, 5, 2], stopped: 2 }))).toBe(
      `${target.name} turrets (+1 massed) [4 1 5 2]: 2 squadrons stopped`,
    );
    expect(prose(s, entry("hit_and_run", { targetId: target.id, rolls: [5], result: "critical" }))).toBe(`Assault boats hit ${target.name} [5]: critical hit`);
  });
});
