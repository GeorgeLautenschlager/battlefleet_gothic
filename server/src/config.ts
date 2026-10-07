/** Online Cruiser Clash (p. 128): each seat brings its own fleet; the room builds the config when both have. */
import { newGame, type FactionId, type Forces, type GameConfig, type PlayerId, type ScenarioId } from "@bfg/engine";
import { MAX_NAME_LENGTH, MAX_POINTS_SHIPS, MAX_SHIPS, shipEntry, type RoomOptions, type ShipEntry } from "./protocol";

export type SeatFleet = { name: string; faction: FactionId; ships: ShipEntry[] };

/** The scenarios with an attacker and a defender, whose roles the host names (T93, T100, T114). */
export const hasAttacker = (scenario: ScenarioId | undefined): boolean => scenario === "the_bait" || scenario === "raiders" || scenario === "surprise_attack";

export function cruiserClash(
  seats: Record<PlayerId, SeatFleet>,
  seed: number,
  createdAt: string,
  options: RoomOptions,
): GameConfig {
  const ships = (owner: PlayerId) => seats[owner].ships.map((s) => ({ owner, ...shipEntry(s) }));
  return {
    seed,
    createdAt,
    options: { ramming: options.ramming, boarding: options.boarding, carriers: options.carriers, ...(options.fleetLists ? { fleetLists: true } : {}) },
    scenario: options.scenario,
    forces: options.forces,
    scoring: options.scoring,
    ...(hasAttacker(options.scenario) && options.attacker !== undefined ? { attacker: options.attacker } : {}),
    // Surprise Attack sets its own planet by points (T114).
    ...(options.planet !== undefined && options.scenario !== "surprise_attack" ? { planet: options.planet } : {}),
    players: {
      p1: { name: seats.p1.name, faction: seats.p1.faction },
      p2: { name: seats.p2.name, faction: seats.p2.faction },
    },
    ships: [...ships("p1"), ...ships("p2")],
  };
}

/** A stand-in opponent for checking one side of The Bait or The Raiders: its faction's cruiser, with Chaos's ever-present Warmaster under the lists. */
function loneCruiser(faction: string, fleetLists: boolean): ShipEntry {
  if (faction !== "chaos") return { name: "(stand-in)", classId: "lunar" };
  return { name: "(stand-in)", classId: "murder", ...(fleetLists ? { commander: { kind: "warmaster", leadership: 8, marks: [] } } : {}) };
}

/** Trimmed, or null if empty or too long. */
export const cleanName = (s: string): string | null => {
  const t = s.trim();
  return t.length > 0 && t.length <= MAX_NAME_LENGTH ? t : null;
};

/**
 * Why one seat's fleet can't play, or null if it can. Checked when it's
 * offered, so starting the game never fails. The force rules themselves
 * (classes, faction, cruisers only, points) are the engine's: the fleet is
 * tried against a mirror of itself.
 */
export function fleetProblem(
  faction: string,
  ships: ShipEntry[],
  count: number,
  carriers = false,
  forces: Forces = { kind: "cruiser_clash" },
  scenario: ScenarioId = "cruiser_clash",
  fleetLists = false,
  /** The Bait and The Raiders: whether this seat defends (The Bait's pursued player) rather than attacks (T93, T100). */
  defender = false,
): string | null {
  if (forces.kind === "points") {
    // A points battle: each side brings its own number of ships, within the limit (T36).
    if (ships.length < 1 || ships.length > MAX_POINTS_SHIPS) return `A fleet has 1–${MAX_POINTS_SHIPS} ships`;
  } else {
    if (!Number.isInteger(count) || count < 1 || count > MAX_SHIPS) return `A fleet has 1–${MAX_SHIPS} cruisers`;
    if (ships.length !== count) return `This game is ${count} cruiser${count === 1 ? "" : "s"} a side`;
  }
  if (ships.some((s) => cleanName(s.name) === null)) return `Ship names need 1–${MAX_NAME_LENGTH} characters`;
  const names = ships.map((s) => s.name.trim());
  if (new Set(names).size !== names.length) return "Every ship needs its own name";
  const side = (owner: PlayerId) => ships.map((s) => ({ owner, ...shipEntry(s) }));
  // The Bait's and The Raiders' sides differ, so the fleet plays its own role against a lone cruiser of its faction (T93, T100).
  const roles = hasAttacker(scenario);
  const opponent = roles ? [{ owner: "p2" as const, ...loneCruiser(faction, fleetLists) }] : side("p2");
  try {
    newGame({
      seed: 1,
      createdAt: "1970-01-01T00:00:00Z",
      options: { carriers, ...(fleetLists ? { fleetLists: true } : {}) },
      scenario,
      forces,
      ...(roles ? { attacker: defender ? ("p2" as const) : ("p1" as const) } : {}),
      players: { p1: { name: "a", faction: faction as FactionId }, p2: { name: "b", faction: faction as FactionId } },
      ships: [...side("p1"), ...opponent],
    });
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}
