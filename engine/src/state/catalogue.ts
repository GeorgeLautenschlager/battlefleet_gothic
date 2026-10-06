/**
 * Ship catalogue: profiles snapshotted into new games (state spec §7.1).
 *
 * Hand-entered from rules/fleets/imperial-navy/vessels.md (Mars p. 61, Overlord p. 66,
 * Dictator p. 67, Dominator p. 68, Tyrant p. 69, Gothic p. 70, Lunar p. 71), and the
 * Chaos heavy cruisers (Styx p. 272, Hecate p. 273, Hades p. 274, Acheron p. 275) and rules/fleets/chaos/vessels.md (Devastation p. 276,
 * Carnage p. 277, Inferno p. 278, Murder p. 279, Slaughter p. 280). Launch bays
 * carry their fleet's default attack craft (imperial-navy/rules.md, chaos/rules.md).
 * Later phases will generate this from rules/fleets/.
 */
import type { CraftOption, FactionId, ShipProfile, ShipTraits, Weapon } from "./types";

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

export type CatalogueEntry = {
  faction: FactionId;
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

/** A ship option (transform §5): replaced weapons, extra turrets, a trait, and its points. */
export type ShipOption = {
  id: string;
  name: string;
  points: number;
  weapons?: Readonly<Record<string, Weapon>>;
  turrets?: number;
  traits?: ShipTraits;
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

const dorsalLances = (range: number): Weapon => ({
  id: "dorsal_lances", name: "Dorsal lance battery", kind: "lance", location: "dorsal", arcs: ["left", "front", "right"], range, speed: null, strength: 2,
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
    { id: "prow_torpedoes", name: "Prow torpedoes", kind: "torpedoes", location: "prow", arcs: ["front"], range: null, speed: 30, strength: 6 },
  ]),
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
 * catalogue's order: replaced weapons, extra turrets, traits and points.
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
  const base = entry.profile;
  let weapons = base.weapons.map((w) => ({ ...w, arcs: [...w.arcs], ...(w.craft ? { craft: w.craft.map((c) => ({ ...c })) } : {}) }));
  let turrets = base.turrets;
  let points = base.points;
  let traits: ShipTraits | undefined = base.traits ? { ...base.traits } : undefined;
  for (const o of chosen) {
    const replace = o.weapons ?? {};
    weapons = weapons.map((w) => {
      const r = replace[w.id];
      return r === undefined ? w : { ...r, arcs: [...r.arcs] };
    });
    turrets += o.turrets ?? 0;
    points += o.points;
    if (o.traits) traits = { ...(traits ?? {}), ...o.traits };
  }
  return {
    ...base,
    points,
    turrets,
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
