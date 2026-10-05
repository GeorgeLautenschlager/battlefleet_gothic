/**
 * Ship catalogue: profiles snapshotted into new games (state spec §7.1).
 *
 * Hand-entered from rules/fleets/imperial-navy/vessels.md (Lunar p. 71, Dictator p. 67)
 * and rules/fleets/chaos/vessels.md (Murder p. 279, Devastation p. 276). Launch bays
 * carry their fleet's default attack craft (imperial-navy/rules.md, chaos/rules.md).
 * Later phases will generate this from rules/fleets/.
 */
import type { CraftOption, FactionId, ShipProfile, Weapon } from "./types";

const IMPERIAL_CRAFT: CraftOption[] = [
  { role: "fighter", name: "Fury", speed: 30 },
  { role: "bomber", name: "Starhawk", speed: 20 },
];

const CHAOS_CRAFT: CraftOption[] = [
  { role: "fighter", name: "Swiftdeath", speed: 30 },
  { role: "bomber", name: "Doomfire", speed: 20 },
  { role: "assault_boat", name: "Dreadclaw", speed: 30 },
];

/** A pair of launch bays, port and starboard, `squadrons` each. */
function launchBays(squadrons: number, craft: CraftOption[]): Weapon[] {
  return (["port", "starboard"] as const).map((side) => ({
    id: `${side}_launch_bays`,
    name: `${side === "port" ? "Port" : "Starboard"} launch bays`,
    kind: "launch_bay" as const,
    location: side,
    arcs: [],
    range: null,
    speed: null,
    strength: squadrons,
    craft: craft.map((c) => ({ ...c })),
  }));
}

export type CatalogueEntry = { faction: FactionId; profile: ShipProfile };

export const CATALOGUE: Readonly<Record<string, CatalogueEntry>> = {
  lunar: {
    faction: "imperial_navy",
    profile: {
      classId: "lunar",
      className: "Lunar class cruiser",
      source: { book: "fleets", page: 71 },
      points: 180,
      type: "cruiser",
      hits: 8,
      speed: 20,
      turns: 45,
      shields: 2,
      armour: { front: 6, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 30, speed: null, strength: 2 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 2 },
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 30, speed: null, strength: 6 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 6 },
        { id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength: 6 },
      ],
    },
  },
  murder: {
    faction: "chaos",
    profile: {
      classId: "murder",
      className: "Murder class cruiser",
      source: { book: "fleets", page: 279 },
      points: 170,
      type: "cruiser",
      hits: 8,
      speed: 25,
      turns: 45,
      shields: 2,
      armour: { front: 5, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 10 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 10 },
        { id: "prow_lances", name: "Prow lance battery", kind: "lance", location: "prow", arcs: ["front"], range: 60, speed: null, strength: 2 },
      ],
    },
  },
  dictator: {
    faction: "imperial_navy",
    profile: {
      classId: "dictator",
      className: "Dictator class cruiser",
      source: { book: "fleets", page: 67 },
      points: 220,
      type: "cruiser",
      hits: 8,
      speed: 20,
      turns: 45,
      shields: 2,
      armour: { front: 6, left: 5, rear: 5, right: 5 },
      turrets: 3,
      baseSize: "small",
      weapons: [
        ...launchBays(2, IMPERIAL_CRAFT),
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 30, speed: null, strength: 6 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 6 },
        { id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength: 6 },
      ],
    },
  },
  devastation: {
    faction: "chaos",
    profile: {
      classId: "devastation",
      className: "Devastation class cruiser",
      source: { book: "fleets", page: 276 },
      points: 190,
      type: "cruiser",
      hits: 8,
      speed: 25,
      turns: 45,
      shields: 2,
      armour: { front: 5, left: 5, rear: 5, right: 5 },
      turrets: 3,
      baseSize: "small",
      weapons: [
        ...launchBays(2, CHAOS_CRAFT),
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 60, speed: null, strength: 2 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 60, speed: null, strength: 2 },
        { id: "prow_battery", name: "Prow weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range: 30, speed: null, strength: 6 },
      ],
    },
  },
};

/** Boarding modifier by faction (p. 90): Orks and Chaos +1, Space Marines +2. */
export function boardingModifier(faction: FactionId): number {
  switch (faction) {
    case "chaos":
    case "orks":
      return 1;
    case "space_marines":
      return 2;
    default:
      return 0;
  }
}
