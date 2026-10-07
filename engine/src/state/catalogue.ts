/**
 * Ship catalogue: profiles snapshotted into new games (state spec §7.1).
 *
 * Hand-entered from rules/fleets/imperial-navy/vessels.md (Mars p. 61, Overlord p. 66,
 * Dictator p. 67, Dauntless p. 77, Emperor p. 53, Retribution p. 54, the escorts (Firestorm p. 79, Sword p. 82, Cobra p. 84), Dominator p. 68, Tyrant p. 69, Gothic p. 70, Lunar p. 71), and the
 * Chaos escorts (Idolator p. 281, Infidel p. 282, Iconoclast p. 283), battleships (battle barge p. 255, Despoiler p. 266, Desolator p. 267), Repulsive grand cruiser (p. 269) and heavy cruisers (Styx p. 272, Hecate p. 273, Hades p. 274, Acheron p. 275) and rules/fleets/chaos/vessels.md (Devastation p. 276,
 * Carnage p. 277, Inferno p. 278, Murder p. 279, Slaughter p. 280). Launch bays
 * carry their fleet's default attack craft (imperial-navy/rules.md, chaos/rules.md).
 * Later phases will generate this from rules/fleets/.
 */
import type { BaseSize, CraftOption, FactionId, ShipProfile, ShipTraits, Weapon } from "./types";

const IMPERIAL_CRAFT: CraftOption[] = [
  { role: "fighter", name: "Fury", speed: 30 },
  { role: "bomber", name: "Starhawk", speed: 20 },
];

const CHAOS_CRAFT: CraftOption[] = [
  { role: "fighter", name: "Swiftdeath", speed: 30 },
  { role: "bomber", name: "Doomfire", speed: 20 },
  { role: "assault_boat", name: "Dreadclaw", speed: 30 },
];

/** A fleet's own attack craft, for a planetary defence's launch bays (transform T131). */
export const fleetCraft = (faction: FactionId): CraftOption[] => (faction === "chaos" ? CHAOS_CRAFT : IMPERIAL_CRAFT).map((c) => ({ ...c }));

/** Shark assault boats, for the Imperial ships that may carry them (transform T74). */
const SHARKS: CraftOption = { role: "assault_boat", name: "Shark", speed: 30 };

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

export type CatalogueEntry = {
  /** `any`: planetary defences, open to either fleet (transform T131). */
  faction: FactionId | "any";
  profile: ShipProfile;
  /** A ship option with its own profile is its own class (transform D13): the class it varies. */
  variantOf?: string;
  /** A rarity limit, per side: at most `max` per `perPoints` points of that side's fleet, or part (T35). */
  limit?: { max: number; perPoints: number };
  /** The class's options (transform §5, T57), applied in this order. */
  options?: ShipOption[];
  /** A v0.9 option class, kept so old saves replay (state N21); not offered for new fleets. */
  legacy?: true;
};

/** A ship option (transform §5): replaced weapons, extra turrets or shields, a bigger base, a trait, and its points. */
export type ShipOption = {
  id: string;
  name: string;
  points: number;
  weapons?: Readonly<Record<string, Weapon>>;
  turrets?: number;
  shields?: number;
  baseSize?: BaseSize;
  traits?: ShipTraits;
  /** Options sharing a group replace the same weapons: a ship takes at most one (state N33). */
  group?: string;
};

/** A prow nova cannon: 30–150 cm to the template's near edge (state N13), one shot. */
const NOVA_CANNON: Weapon = {
  id: "prow_nova_cannon",
  name: "Prow nova cannon",
  kind: "nova_cannon",
  location: "prow",
  arcs: ["front"],
  range: 150,
  minRange: 30,
  speed: null,
  strength: 1,
};

/** The Tyrant's 30 cm batteries upgraded to 45 cm (+10 pts, p. 69). */
const TYRANT_LONG: Record<string, Weapon> = {
  port_long_battery: { id: "port_long_battery", name: "Port weapons battery (FP 4)", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 4 },
  starboard_long_battery: { id: "starboard_long_battery", name: "Starboard weapons battery (FP 4)", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 4 },
  port_battery: { id: "port_battery", name: "Port weapons battery (FP 6)", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 6 },
  starboard_battery: { id: "starboard_battery", name: "Starboard weapons battery (FP 6)", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 6 },
};
const NOVA_FOR_TORPEDOES = { prow_torpedoes: NOVA_CANNON };
/** The Dominator's original batteries (p. 68). */
const DOMINATOR_LONG: Record<string, Weapon> = {
  port_battery: { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 6 },
  starboard_battery: { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 6 },
};

/** The battlecruisers' options (pp. 61, 66): a targeting matrix (+15) and a third turret (+10). */
const BATTLECRUISER_OPTIONS: ShipOption[] = [
  { id: "targeting_matrix", name: "Targeting matrix (batteries shift one column left)", points: 15, traits: { targetingMatrix: true } },
  { id: "third_turret", name: "Third turret", points: 10, turrets: 1 },
];

const dorsalLances = (range: number, strength = 2): Weapon => ({
  id: "dorsal_lances", name: "Dorsal lance battery", kind: "lance", location: "dorsal", arcs: ["left", "front", "right"], range, speed: null, strength,
});
const prowTorpedoes = (strength: number): Weapon => ({
  id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength,
});
const prowBattery = (range: number, strength: number): Weapon => ({
  id: "prow_battery", name: "Prow weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range, speed: null, strength,
});
const broadside = (kind: "battery" | "lance", range: number, strength: number): Weapon[] =>
  (["port", "starboard"] as const).map((side) => ({
    id: `${side}_${kind === "battery" ? "battery" : "lances"}`,
    name: `${side === "port" ? "Port" : "Starboard"} ${kind === "battery" ? "weapons battery" : "lance battery"}`,
    kind,
    location: side,
    arcs: [side === "port" ? "left" : "right"],
    range,
    speed: null,
    strength,
  }));

/** Battleships (state N30): Battleship/12, 45° turns, 4 shields, a large base, no Come to New Heading. */
function battleship(
  faction: FactionId,
  classId: string,
  className: string,
  page: number,
  points: number,
  stats: { speed: number; front?: number; turrets: number; traits?: ShipTraits },
  weapons: Weapon[],
  options?: ShipOption[],
): CatalogueEntry {
  const front = stats.front ?? 5;
  return {
    faction,
    ...(options !== undefined ? { options } : {}),
    profile: {
      classId, className, source: { book: "fleets", page }, points, type: "battleship", category: "battleship",
      hits: 12, speed: stats.speed, turns: 45, shields: 4, armour: { front, left: 5, rear: 5, right: 5 }, turrets: stats.turrets, baseSize: "large",
      weapons, traits: { noComeToNewHeading: true, ...stats.traits },
    },
  };
}
const dorsalBattery = (range: number, strength: number): Weapon => ({
  id: "dorsal_battery", name: "Dorsal weapons battery", kind: "battery", location: "dorsal", arcs: ["left", "front", "right"], range, speed: null, strength,
});
const prowLances = (range: number, strength: number): Weapon => ({
  id: "prow_lances", name: "Prow lance battery", kind: "lance", location: "prow", arcs: ["front"], range, speed: null, strength,
});
const prowBays = (squadrons: number, craft: CraftOption[]): Weapon => ({
  id: "prow_launch_bays", name: "Prow launch bays", kind: "launch_bay", location: "prow", arcs: [], range: null, speed: null, strength: squadrons, craft: craft.map((c) => ({ ...c })),
});
const byId = (bays: Weapon[]): Record<string, Weapon> => Object.fromEntries(bays.map((w) => [w.id, w]));
const TORPEDOES_FOR_PROW_LANCES: ShipOption = { id: "prow_torpedoes", name: "Prow torpedoes (Str 8) for the prow lances", points: 10, weapons: { prow_lances: prowTorpedoes(8) } };

/** Escorts (state N34): Escort/1, 90° turns, shields 1, a small base. Their weapons sit in the prow. */
function escort(
  faction: FactionId,
  classId: string,
  className: string,
  page: number,
  points: number,
  stats: { speed: number; armour: number; turrets: number; traits?: ShipTraits },
  weapons: Weapon[],
): CatalogueEntry {
  const a = stats.armour;
  return {
    faction,
    profile: {
      classId, className, source: { book: "fleets", page }, points, type: "escort", category: "escort",
      hits: 1, speed: stats.speed, turns: 90, shields: 1, armour: { front: a, left: a, rear: a, right: a }, turrets: stats.turrets, baseSize: "small",
      weapons, ...(stats.traits !== undefined ? { traits: stats.traits } : {}),
    },
  };
}
/**
 * A stationary planetary defence (fleets book pp. 506–511, state §7.6): speed 0, armour all round,
 * weapons firing all round. Launch bays get the owner's attack craft in newGame (transform T131).
 */
function defence(
  classId: string,
  className: string,
  page: number,
  points: number,
  stats: { hits: number; shields: number; armour: number; turrets: number; baseSize: BaseSize },
  weapons: Weapon[],
): CatalogueEntry {
  const a = stats.armour;
  return {
    faction: "any",
    profile: {
      classId, className, source: { book: "fleets", page }, points, type: "defence", category: "defence",
      hits: stats.hits, speed: 0, turns: 45, shields: stats.shields, armour: { front: a, left: a, rear: a, right: a }, turrets: stats.turrets,
      baseSize: stats.baseSize, weapons,
    },
  };
}
const ALL_ROUND: Weapon["arcs"] = ["front", "right", "rear", "left"];
const defenceWeapon = (id: string, name: string, kind: "battery" | "lance", range: number, strength: number): Weapon => ({
  id, name, kind, location: "dorsal", arcs: [...ALL_ROUND], range, speed: null, strength,
});
const defenceTorpedoes = (strength: number): Weapon => ({
  id: "torpedoes", name: "Torpedoes", kind: "torpedoes", location: "dorsal", arcs: [...ALL_ROUND], range: null, speed: 30, strength,
});
const defenceBays = (squadrons: number): Weapon => ({
  id: "launch_bays", name: "Launch bays", kind: "launch_bay", location: "dorsal", arcs: [], range: null, speed: null, strength: squadrons, craft: [],
});
/** A system defence ship (fleets book pp. 514–515): an escort with the planetaryDefence trait, 45° turns. */
function systemDefenceShip(classId: string, className: string, page: number, points: number, stats: { speed: number; shields: number; armour: number; turrets: number }, weapons: Weapon[]): CatalogueEntry {
  const a = stats.armour;
  return {
    faction: "any",
    profile: {
      classId, className, source: { book: "fleets", page }, points, type: "escort", category: "escort",
      hits: 1, speed: stats.speed, turns: 45, shields: stats.shields, armour: { front: a, left: a, rear: a, right: a }, turrets: stats.turrets, baseSize: "small",
      weapons, traits: { planetaryDefence: true },
    },
  };
}

function fireShip(): CatalogueEntry {
  const entry = systemDefenceShip("fire_ship", "Fire ship", 516, 10, { speed: 15, shields: 1, armour: 5, turrets: 1 }, []);
  entry.profile.traits = { planetaryDefence: true, fireShip: true };
  return entry;
}

const escortBattery = (range: number, strength: number): Weapon => ({
  id: "battery", name: "Weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range, speed: null, strength,
});
const escortLance = (strength: number): Weapon => ({
  id: "prow_lance", name: "Prow lance", kind: "lance", location: "prow", arcs: ["front"], range: 30, speed: null, strength,
});

/** Chaos heavy cruisers (pp. 272–275): Cruiser/8, 25 cm, 45°, shields 2, armour 5+. */
function chaosHeavy(classId: string, name: string, page: number, points: number, turrets: number, weapons: Weapon[]): CatalogueEntry {
  return {
    faction: "chaos",
    profile: {
      classId, className: `${name} class heavy cruiser`, source: { book: "fleets", page }, points, type: "cruiser", category: "heavy_cruiser",
      hits: 8, speed: 25, turns: 45, shields: 2, armour: { front: 5, left: 5, rear: 5, right: 5 }, turrets, baseSize: "small", weapons,
    },
  };
}

/** Imperial battlecruisers (pp. 61, 66): Cruiser/8, 20 cm, 45°, shields 2, armour 6+ front / 5+, turrets 2. */
function imperialBattlecruiser(classId: string, name: string, page: number, points: number, weapons: Weapon[]): CatalogueEntry {
  return {
    faction: "imperial_navy",
    options: BATTLECRUISER_OPTIONS,
    profile: {
      classId, className: `${name} class battlecruiser`, source: { book: "fleets", page }, points, type: "cruiser", category: "battlecruiser",
      hits: 8, speed: 20, turns: 45, shields: 2, armour: { front: 6, left: 5, rear: 5, right: 5 }, turrets: 2, baseSize: "small", weapons,
    },
  };
}

const CLASSES: Readonly<Record<string, CatalogueEntry>> = {
  lunar: {
    faction: "imperial_navy",
    options: [{ id: "nova_cannon", name: "Nova cannon (replaces the prow torpedoes)", points: 20, weapons: { prow_torpedoes: NOVA_CANNON } }],
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
  gothic: {
    faction: "imperial_navy",
    profile: {
      classId: "gothic",
      className: "Gothic class cruiser",
      source: { book: "fleets", page: 70 },
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
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 30, speed: null, strength: 4 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 4 },
        { id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength: 6 },
      ],
    },
  },
  tyrant: {
    faction: "imperial_navy",
    options: [
      { id: "long_batteries", name: "45 cm weapons batteries", points: 10, weapons: TYRANT_LONG },
      { id: "nova_cannon", name: "Nova cannon (replaces the prow torpedoes)", points: 20, weapons: { prow_torpedoes: NOVA_CANNON } },
    ],
    profile: {
      classId: "tyrant",
      className: "Tyrant class cruiser",
      source: { book: "fleets", page: 69 },
      points: 185,
      type: "cruiser",
      hits: 8,
      speed: 20,
      turns: 45,
      shields: 2,
      armour: { front: 6, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_long_battery", name: "Port weapons battery (45 cm)", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 4 },
        { id: "starboard_long_battery", name: "Starboard weapons battery (45 cm)", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 4 },
        { id: "port_battery", name: "Port weapons battery (30 cm)", kind: "battery", location: "port", arcs: ["left"], range: 30, speed: null, strength: 6 },
        { id: "starboard_battery", name: "Starboard weapons battery (30 cm)", kind: "battery", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 6 },
        { id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength: 6 },
      ],
    },
  },
  murder_lances: {
    faction: "chaos",
    variantOf: "murder",
    limit: { max: 2, perPoints: 750 }, // no more than two per 750 points, or part (p. 279)
    profile: {
      classId: "murder_lances",
      className: "Murder class cruiser (lance variant)",
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
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 4 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 4 },
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 45, speed: null, strength: 2 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 2 },
        { id: "prow_lances", name: "Prow lance battery", kind: "lance", location: "prow", arcs: ["front"], range: 60, speed: null, strength: 2 },
      ],
    },
  },
  carnage: {
    faction: "chaos",
    profile: {
      classId: "carnage",
      className: "Carnage class cruiser",
      source: { book: "fleets", page: 277 },
      points: 180,
      type: "cruiser",
      hits: 8,
      speed: 25,
      turns: 45,
      shields: 2,
      armour: { front: 5, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_battery", name: "Port weapons battery (45 cm)", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 6 },
        { id: "starboard_battery", name: "Starboard weapons battery (45 cm)", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 6 },
        { id: "port_long_battery", name: "Port weapons battery (60 cm)", kind: "battery", location: "port", arcs: ["left"], range: 60, speed: null, strength: 4 },
        { id: "starboard_long_battery", name: "Starboard weapons battery (60 cm)", kind: "battery", location: "starboard", arcs: ["right"], range: 60, speed: null, strength: 4 },
        { id: "prow_battery", name: "Prow weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range: 60, speed: null, strength: 6 },
      ],
    },
  },
  inferno: {
    faction: "chaos",
    profile: {
      classId: "inferno",
      className: "Inferno class cruiser",
      source: { book: "fleets", page: 278 },
      points: 180,
      type: "cruiser",
      hits: 8,
      speed: 25,
      turns: 45,
      shields: 2,
      armour: { front: 5, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 45, speed: null, strength: 2 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 2 },
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 45, speed: null, strength: 4 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 45, speed: null, strength: 4 },
        { id: "prow_battery", name: "Prow weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range: 60, speed: null, strength: 6 },
      ],
    },
  },
  slaughter: {
    faction: "chaos",
    profile: {
      classId: "slaughter",
      className: "Slaughter class cruiser",
      source: { book: "fleets", page: 280 },
      points: 165,
      type: "cruiser",
      hits: 8,
      speed: 30,
      turns: 45,
      shields: 2,
      armour: { front: 5, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_lances", name: "Port lance battery", kind: "lance", location: "port", arcs: ["left"], range: 30, speed: null, strength: 2 },
        { id: "starboard_lances", name: "Starboard lance battery", kind: "lance", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 2 },
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 30, speed: null, strength: 8 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 8 },
        { id: "prow_battery", name: "Prow weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range: 30, speed: null, strength: 6 },
      ],
      traits: { allAheadFullDice: 5 }, // improved thrusters, +5D6 on All Ahead Full (state N10)
    },
  },
  dominator: {
    faction: "imperial_navy",
    // The original FP 6, 45 cm batteries (−5 pts, like the Hammer of Justice, p. 68).
    options: [{ id: "long_batteries", name: "Original 45 cm weapons batteries (FP 6)", points: -5, weapons: DOMINATOR_LONG }],
    profile: {
      classId: "dominator",
      className: "Dominator class cruiser",
      source: { book: "fleets", page: 68 },
      points: 190,
      type: "cruiser",
      hits: 8,
      speed: 20,
      turns: 45,
      shields: 2,
      armour: { front: 6, left: 5, rear: 5, right: 5 },
      turrets: 2,
      baseSize: "small",
      weapons: [
        { id: "port_battery", name: "Port weapons battery", kind: "battery", location: "port", arcs: ["left"], range: 30, speed: null, strength: 12 },
        { id: "starboard_battery", name: "Starboard weapons battery", kind: "battery", location: "starboard", arcs: ["right"], range: 30, speed: null, strength: 12 },
        NOVA_CANNON,
      ],
    },
  },
};

/**
 * A v0.9 option class (transform T48), kept so old saves replay (state N21):
 * the base class's profile with some weapons replaced and the points adjusted.
 */
function variant(
  baseId: string,
  classId: string,
  className: string,
  points: number,
  replace: Readonly<Record<string, Weapon>>,
): CatalogueEntry {
  const base = CLASSES[baseId];
  if (base === undefined) throw new Error(`no ${baseId} to vary`);
  return {
    faction: base.faction,
    variantOf: baseId,
    legacy: true,
    profile: {
      ...base.profile,
      classId,
      className,
      points,
      weapons: base.profile.weapons.map((w) => ({ ...(replace[w.id] ?? w) })),
    },
  };
}


export const CATALOGUE: Readonly<Record<string, CatalogueEntry>> = {
  ...CLASSES,
  lunar_nova: variant("lunar", "lunar_nova", "Lunar class cruiser (nova cannon)", 200, NOVA_FOR_TORPEDOES),
  tyrant_long: variant("tyrant", "tyrant_long", "Tyrant class cruiser (45 cm batteries)", 195, TYRANT_LONG),
  tyrant_nova: variant("tyrant", "tyrant_nova", "Tyrant class cruiser (nova cannon)", 205, NOVA_FOR_TORPEDOES),
  tyrant_long_nova: variant("tyrant", "tyrant_long_nova", "Tyrant class cruiser (45 cm batteries, nova cannon)", 215, { ...TYRANT_LONG, ...NOVA_FOR_TORPEDOES }),
  // The Dominator's original 45 cm batteries, FP 6 (−5 pts, like the Hammer of Justice, p. 68).
  dominator_long: variant("dominator", "dominator_long", "Dominator class cruiser (45 cm batteries)", 185, DOMINATOR_LONG),
  mars: imperialBattlecruiser("mars", "Mars", 61, 270, [
    ...launchBays(2, IMPERIAL_CRAFT),
    ...broadside("battery", 45, 6),
    dorsalLances(60),
    NOVA_CANNON,
  ]),
  overlord: imperialBattlecruiser("overlord", "Overlord", 66, 220, [
    ...broadside("battery", 60, 8),
    dorsalLances(60),
    prowTorpedoes(6),
  ]),
  // Light cruiser (p. 77): Cruiser/6, 25 cm, 90°, improved thrusters (state N10).
  dauntless: {
    faction: "imperial_navy",
    options: [{ id: "prow_torpedoes", name: "Prow torpedoes (Str 6) for the prow lances", points: 0, weapons: { prow_lances: prowTorpedoes(6) } }],
    profile: {
      classId: "dauntless", className: "Dauntless class light cruiser", source: { book: "fleets", page: 77 }, points: 110, type: "cruiser", category: "light_cruiser",
      hits: 6, speed: 25, turns: 90, shields: 1, armour: { front: 5, left: 5, rear: 5, right: 5 }, turrets: 1, baseSize: "small",
      weapons: [
        ...broadside("battery", 30, 4),
        { id: "prow_lances", name: "Prow lance battery", kind: "lance", location: "prow", arcs: ["front"], range: 30, speed: null, strength: 3 },
      ],
      traits: { allAheadFullDice: 5 },
    },
  },
  // Grand cruiser (p. 269): Cruiser/10, 20 cm, 45°.
  repulsive: {
    faction: "chaos",
    options: [
      { id: "long_dorsal_lances", name: "Ancient targeting systems (45 cm dorsal lances)", points: 10, weapons: { dorsal_lances: dorsalLances(45, 3) } },
      { id: "third_shield", name: "Third shield, on a large base", points: 15, shields: 1, baseSize: "large" },
    ],
    profile: {
      classId: "repulsive", className: "Repulsive class grand cruiser", source: { book: "fleets", page: 269 }, points: 230, type: "cruiser", category: "grand_cruiser",
      hits: 10, speed: 20, turns: 45, shields: 2, armour: { front: 5, left: 5, rear: 5, right: 5 }, turrets: 3, baseSize: "small",
      weapons: [...broadside("battery", 45, 14), dorsalLances(30, 3), prowTorpedoes(6)],
    },
  },
  emperor: battleship(
    "imperial_navy", "emperor", "Emperor class battleship", 53, 365,
    { speed: 15, turrets: 5, traits: { leadershipBonus: 1 } },
    [...broadside("battery", 60, 6), ...launchBays(4, IMPERIAL_CRAFT), dorsalBattery(60, 5), prowBattery(60, 5)],
    [{ id: "sharks", name: "Shark assault boats in its launch bays", points: 5, weapons: byId(launchBays(4, [...IMPERIAL_CRAFT, SHARKS])) }],
  ),
  retribution: battleship(
    "imperial_navy", "retribution", "Retribution class battleship", 54, 345,
    { speed: 20, front: 6, turrets: 4 },
    [...broadside("battery", 60, 12), dorsalLances(60, 3), prowTorpedoes(9)],
  ),
  chaos_battle_barge: battleship(
    "chaos", "chaos_battle_barge", "Chaos battle barge", 255, 410,
    { speed: 20, turrets: 4 },
    [...broadside("battery", 60, 6), dorsalLances(60, 3), ...launchBays(3, CHAOS_CRAFT), prowBays(2, CHAOS_CRAFT), prowLances(30, 4)],
    [
      { id: "batteries_45", name: "45 cm, FP 8 port and starboard batteries", points: 0, group: "batteries", weapons: byId(broadside("battery", 45, 8)) },
      { id: "batteries_30", name: "30 cm, FP 10 port and starboard batteries", points: 0, group: "batteries", weapons: byId(broadside("battery", 30, 10)) },
      TORPEDOES_FOR_PROW_LANCES,
      { id: "dorsal_lances_45", name: "45 cm, Str 4 dorsal lances", points: 10, weapons: { dorsal_lances: dorsalLances(45, 4) } },
    ],
  ),
  despoiler: battleship(
    "chaos", "despoiler", "Despoiler class battleship", 266, 400,
    { speed: 20, turrets: 4 },
    [...launchBays(4, CHAOS_CRAFT), ...broadside("battery", 60, 6), dorsalLances(60, 3), prowLances(30, 4)],
    [TORPEDOES_FOR_PROW_LANCES],
  ),
  desolator: battleship(
    "chaos", "desolator", "Desolator class battleship", 267, 300,
    { speed: 25, turrets: 4 },
    [...broadside("lance", 60, 4), dorsalBattery(60, 6), prowTorpedoes(9)],
  ),
  firestorm: escort("imperial_navy", "firestorm", "Firestorm class frigate", 79, 40, { speed: 25, armour: 5, turrets: 2 }, [escortLance(1), escortBattery(30, 2)]),
  sword: escort("imperial_navy", "sword", "Sword class frigate", 82, 35, { speed: 25, armour: 5, turrets: 2 }, [escortBattery(30, 4)]),
  cobra: escort("imperial_navy", "cobra", "Cobra class destroyer", 84, 30, { speed: 30, armour: 4, turrets: 1 }, [prowTorpedoes(2), escortBattery(30, 1)]),
  idolator: escort("chaos", "idolator", "Idolator class raider", 281, 45, { speed: 30, armour: 5, turrets: 2, traits: { noLongRangeShift: true } }, [escortBattery(45, 2), escortLance(1)]),
  infidel: escort("chaos", "infidel", "Infidel class raider", 282, 40, { speed: 30, armour: 5, turrets: 1 }, [escortBattery(30, 2), prowTorpedoes(2)]),
  iconoclast: escort("chaos", "iconoclast", "Iconoclast class destroyer", 283, 30, { speed: 30, armour: 4, turrets: 1 }, [escortBattery(30, 3)]),
  // Planetary defences, high orbit (fleets book pp. 506–515; transform T131)
  laser_platform: defence("laser_platform", "Orbital defence laser platform", 509, 30, { hits: 1, shields: 1, armour: 6, turrets: 2, baseSize: "small" }, [defenceWeapon("lances", "Lance battery", "lance", 30, 2)]),
  torpedo_platform: defence("torpedo_platform", "Orbital torpedo launcher", 510, 30, { hits: 1, shields: 1, armour: 6, turrets: 2, baseSize: "small" }, [defenceTorpedoes(6)]),
  weapons_platform: defence("weapons_platform", "Orbital weapons platform", 511, 30, { hits: 1, shields: 1, armour: 6, turrets: 2, baseSize: "small" }, [defenceWeapon("battery", "Weapons battery", "battery", 60, 6)]),
  orbital_dock: defence("orbital_dock", "Orbital dock", 508, 90, { hits: 6, shields: 2, armour: 5, turrets: 3, baseSize: "large" }, [defenceWeapon("battery", "Weapons battery", "battery", 30, 4), defenceBays(4)]),
  space_station: defence("space_station", "Space station", 507, 150, { hits: 8, shields: 2, armour: 5, turrets: 4, baseSize: "large" }, [
    defenceWeapon("battery", "Weapons battery", "battery", 60, 12),
    defenceWeapon("lances", "Lance battery", "lance", 30, 3),
    defenceBays(4),
  ]),
  blackstone_fortress: defence("blackstone_fortress", "Blackstone Fortress", 506, 400, { hits: 16, shields: 6, armour: 5, turrets: 6, baseSize: "large" }, [
    defenceWeapon("battery", "Weapons battery", "battery", 60, 20),
    defenceWeapon("lances", "Lance battery", "lance", 60, 4),
    defenceBays(8),
  ]),
  defence_monitor: systemDefenceShip("defence_monitor", "Defence monitor", 514, 60, { speed: 10, shields: 2, armour: 6, turrets: 2 }, [
    { id: "battery", name: "Weapons battery", kind: "battery", location: "prow", arcs: ["left", "front", "right"], range: 30, speed: null, strength: 8 },
    { id: "prow_lance", name: "Prow lance", kind: "lance", location: "prow", arcs: ["front"], range: 30, speed: null, strength: 1 },
  ]),
  system_ship: systemDefenceShip("system_ship", "System ship", 515, 20, { speed: 15, shields: 1, armour: 5, turrets: 1 }, [escortBattery(30, 3)]),
  // A fire ship (fleets book p. 516, state N121): a system ship with no guns that can detonate.
  fire_ship: fireShip(),
  styx: chaosHeavy("styx", "Styx", 272, 260, 3, [...launchBays(3, CHAOS_CRAFT), dorsalLances(60), prowBattery(60, 6)]),
  hecate: chaosHeavy("hecate", "Hecate", 273, 230, 3, [...launchBays(2, CHAOS_CRAFT), ...broadside("battery", 45, 4), dorsalLances(60), prowBattery(45, 6)]),
  hades: chaosHeavy("hades", "Hades", 274, 200, 2, [
    ...broadside("battery", 45, 10),
    dorsalLances(60),
    { id: "prow_lances", name: "Prow lance battery", kind: "lance", location: "prow", arcs: ["front"], range: 60, speed: null, strength: 2 },
  ]),
  acheron: chaosHeavy("acheron", "Acheron", 275, 190, 3, [...broadside("lance", 60, 2), dorsalLances(45), prowBattery(45, 6)]),
};

/**
 * A class's profile with options applied (transform §5, T57), in the
 * catalogue's order: replaced weapons, extra turrets and shields, a bigger base, traits and points.
 * Throws on an unknown or repeated option.
 */
export function profileWithOptions(classId: string, optionIds: readonly string[] = []): ShipProfile {
  const entry = CATALOGUE[classId];
  if (entry === undefined) throw new Error(`unknown class ${classId}`);
  const available = entry.options ?? [];
  if (new Set(optionIds).size !== optionIds.length) throw new Error(`${classId}: an option is named twice`);
  for (const id of optionIds) {
    if (!available.some((o) => o.id === id)) throw new Error(`${classId} has no option "${id}"`);
  }
  const chosen = available.filter((o) => optionIds.includes(o.id));
  for (const o of chosen) {
    const rival = chosen.find((p) => p !== o && p.group !== undefined && p.group === o.group);
    if (rival !== undefined) throw new Error(`${classId}: "${o.id}" and "${rival.id}" can't both be taken`);
  }
  const base = entry.profile;
  let weapons = base.weapons.map((w) => ({ ...w, arcs: [...w.arcs], ...(w.craft ? { craft: w.craft.map((c) => ({ ...c })) } : {}) }));
  let turrets = base.turrets;
  let shields = base.shields;
  let baseSize = base.baseSize;
  let points = base.points;
  let traits: ShipTraits | undefined = base.traits ? { ...base.traits } : undefined;
  for (const o of chosen) {
    const replace = o.weapons ?? {};
    weapons = weapons.map((w) => {
      const r = replace[w.id];
      return r === undefined ? w : { ...r, arcs: [...r.arcs] };
    });
    turrets += o.turrets ?? 0;
    shields += o.shields ?? 0;
    baseSize = o.baseSize ?? baseSize;
    points += o.points;
    if (o.traits) traits = { ...(traits ?? {}), ...o.traits };
  }
  return {
    ...base,
    points,
    turrets,
    shields,
    baseSize,
    weapons,
    ...(traits !== undefined ? { traits } : {}),
    ...(chosen.length > 0 ? { options: chosen.map((o) => o.id) } : {}),
  };
}

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
