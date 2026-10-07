import { describe, expect, test } from "vitest";
import { newGame, reduce, validate, type GameState, type Transform } from "@bfg/engine";
import { cruiserClash, roleOf, sideProblem, type NewGameOptions } from "../src/game/config";
import { deployAt, deployHeading, DEFAULT_AIM } from "../src/game/deploy";
import { describe as prose } from "../src/log/format";

/** Ann defends with a Lunar and a Gothic; Bo attacks with a Murder. */
const options: NewGameOptions = {
  p1: { name: "Ann", fleet: "imperial_navy", ships: ["Agrippa", "Invincible"], classes: ["lunar", "gothic"] },
  p2: { name: "Bo", fleet: "chaos", ships: ["Unclean"] },
  ramming: true,
  boarding: true,
  scenario: "surprise_attack",
  forces: { kind: "points", limit: 750 },
  scoring: "victory_points",
  attacker: "p2",
  planet: "large",
  seed: 7,
};

const play = (s: GameState, t: Transform): GameState => {
  const v = validate(s, t);
  if (!v.ok) throw new Error(v.reason.message);
  return reduce(s, t);
};

describe("Surprise Attack from the form", () => {
  test("the config names the attackers, who start in reserve; the planet comes from the points, not the form", () => {
    const config = cruiserClash(options, new Date(0));
    expect(config.attacker).toBe("p2");
    expect(config.planet).toBeUndefined();
    const s = newGame(config);
    expect(s.ships.map((x) => x.status)).toEqual(["undeployed", "undeployed", "reserve"]);
    expect(s.table.features?.[0]).toMatchObject({ size: "medium" });
  });

  test("each side is checked in its own role, both at the full points", () => {
    expect(roleOf("surprise_attack", "p2", "p1")).toEqual({ scenario: "surprise_attack", defender: true });
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "surprise_attack", defender: true })).toBeNull();
    expect(sideProblem(options.p1, false, options.forces, false, { scenario: "surprise_attack", defender: false })).toBeNull();
  });

  test("a ship on standby is deployed broadside to the planet, either side; one on alert faces the chosen way", () => {
    // A seed whose alert D3 is 1, so Invincible goes on standby.
    const rolled = (seed: number) => play(newGame(cruiserClash({ ...options, seed }, new Date(0))), { type: "roll_leadership", player: "p1" });
    const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((n) => rolled(n).setup.surpriseAttack?.alertUnits === 1) ?? 0;
    let s = play(rolled(seed), { type: "choose_alert", player: "p1", units: ["ship-1"] });
    const [agrippa, invincible] = [s.ships[0]!, s.ships[1]!];
    expect(deployHeading(s, "p1", agrippa, { x: 50, y: 50 }, { facing: 135, planetTo: "port" })).toBe(135);
    // Invincible on standby, 20 cm south of the planet's centre (90, 60): planet to starboard faces east, to port west.
    expect(invincible.standby).toBe(true);
    expect(deployHeading(s, "p1", invincible, { x: 90, y: 40 }, DEFAULT_AIM)).toBeCloseTo(270);
    expect(deployHeading(s, "p1", invincible, { x: 90, y: 40 }, { facing: 0, planetTo: "port" })).toBeCloseTo(90);
    s = play(s, deployAt(s, "p1", agrippa, { x: 50, y: 50 }, DEFAULT_AIM));
    expect(validate(s, deployAt(s, "p1", invincible, { x: 90, y: 40 }, DEFAULT_AIM)).ok).toBe(true);
  });

  test("the alert roll, choice and tests read as sentences", () => {
    const s = newGame(cruiserClash(options, new Date(0)));
    const entry = (kind: string, data: Record<string, unknown>) => ({ id: "log-1", playerTurn: 0, phase: null, kind, actor: null, data }) as Parameters<typeof prose>[1];
    expect(prose(s, entry("alert_roll", { rolls: [3], units: 2 }))).toBe("The defender's fleet is caught at anchor [3]: 2 ships or squadrons on full alert");
    expect(prose(s, entry("alert_choice", { player: "p1", units: ["ship-1"], standby: ["ship-2"] }))).toBe("Ann puts Agrippa on full alert; 1 ship is on standby");
    expect(prose(s, entry("alert_test", { shipIds: ["ship-2"], rolls: [5, 4], leadership: 8, passed: false }))).toBe("Invincible tests to go on alert [5 4] against Ld 8: still on standby");
  });
});
