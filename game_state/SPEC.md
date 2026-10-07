# Game State Specification

**Status:** draft v0.21, for discussion. **Scope:** Cruiser Clash (1–4 cruisers a side, hot-seat or online), with room to grow. v0.7 added boarding actions, grapples and teleport attacks (pp. 89–92). v0.8 adds attack craft, launch bays, Combat Air Patrol and massed turrets (pp. 73–87): §4, §7, §8, §10.2, §11, §13. v0.9 adds class traits from the fleet book (§7.1, N10). v0.10 adds points battles and standard victory points (§4, §11, §13, N11–N12). v0.11 adds the nova cannon (pp. 63–64): §7.1, §10.1, §11, N13–N14. v0.12 adds the Fleet Engagement scenario (pp. 142–143): formations, set-up maps and divisions, and no round limit (§4, §5, §6, §11, N15–N19). v0.13 adds battlecruisers and heavy cruisers, per-ship options, the Gothic War fleet lists, fleet commanders with their re-rolls, and the Marks of Chaos (§4, §7, §7.1, §7.4, §11, N20–N27). v0.14 adds grand and light cruisers, and options that add a shield or a large base (§7.1, N27–N29). v0.15 adds battleships: the `battleship` category, the traits that bar Come to New Heading and raise Leadership, and options that exclude each other (§7.1, §11, N30–N33). v0.16 adds escorts and squadrons, escort and capital: §3, §7.5, §8, §9.1, §11, §13, N34–N45. v0.17 adds the second scenario, The Bait (p. 130), and with it reserves: ships that start off the table and arrive along an entry edge during the battle (§4, §5, §6, §7, §11, §13, N47–N55). v0.18 adds the third scenario, The Raiders (p. 131): the defender's facing and spacing, raiders arriving from any edge in their first turn, and the defenders' surprise (§4, §5, §11, §13, N56–N63). v0.19 adds the first celestial phenomenon, a planet in the table centre (pp. 112–113): its template, line of sight, torpedoes and drifting hulks, and its gravity well's free turns and high orbit (§4, §9.1, §11, §13, N64–N71). v0.20 adds the fourth scenario, Surprise Attack (p. 132): units on full alert and on standby, going on alert, the planet by points, and attackers who all move on from one edge (§4, §5, §7, §8, §11, §13, N72–N80). v0.21 adds the fifth scenario, Blockade Run (p. 133): the blockaders in their rolled thirds, the runners along their edge, the edge a ship leaves by, and the runners' victory points for getting through (§4, §5, §7, §11, §13, N81–N89).

This document defines the **game state**: a self-contained, machine-readable snapshot of a game of *Battlefleet Gothic Remastered* (rulebook v1.10). It's the first of four rules-engine pieces:

| Piece | Signature | Spec |
|---|---|---|
| **Game state** | plain data | this document |
| **Transform** | plain data: one proposed change, e.g. "Agrippa moves along this path" | [transforms/SPEC.md](../transforms/SPEC.md) |
| **Validator** | `validate(state, transform) → { ok: true } \| { ok: false, reason }` | [validator/SPEC.md](../validator/SPEC.md) |
| **Reducer** | `reduce(state, transform) → state` (transform already validated) | [reducer/SPEC.md](../reducer/SPEC.md) |

Rule references like `(p. 66)` are rulebook pages; `rules/05-damage.md` etc. are the markdown extraction. "Interpretation #N" refers to the numbered list in [`rules/README.md`](../rules/README.md#interpretations--known-issues).

---

## 1. Design principles

1. **Plain JSON.** The state is a JSON value: objects, arrays, strings, finite numbers, booleans, `null`. No `undefined`, `NaN`, `Infinity`, dates, classes, maps or functions. `JSON.parse(JSON.stringify(s))` deep-equals `s`.
2. **Self-contained.** Validator and reducer need nothing but the state and the transform. Ship profiles are **snapshotted** into the state at creation, so a later change to the fleets data can't change a game in progress. The random number generator's state lives in the game state too (§10).
3. **Store facts, derive the rest.** The state records what happened (damage taken, criticals suffered, where Blast Markers sit) and never what can be computed from it (crippled, current speed, effective shields, score). Derived values are defined once, in §11, so the validator, reducer and UI can't drift apart. The exceptions are things that depend on history that's otherwise gone, e.g. how far a ship moved in its last Movement Phase.
4. **Deterministic.** `reduce(s, t)` is a pure function. Same state + same transform → byte-identical result, on every platform. All dice come from the in-state PRNG, and all trig from the engine's deterministic maths module ([validator §2.8](../validator/SPEC.md#28-deterministic-maths)).
5. **At rest between transforms.** After every reduce, the state sits at a decision point, and exactly one player is being asked for input (§12). There's no hidden "the reducer is halfway through something" outside of the explicit `activation` and `pending` fields.
6. **One transform per decision.** A ship's whole move is one transform carrying the complete path. Breaking it into drag-and-rotate steps is the interface layer's job. The only split is where the rules force one: a special order is declared (and its dice rolled) *before* the move is plotted, because the player needs to know whether the Command check passed and how far All Ahead Full goes (§9.1).
7. **Count-only choices are made up front.** When a player's choice depends only on *how many* successes a roll produces (which criticals to repair, which Blast Markers to remove), the transform carries an ordered preference list and the reducer applies the first N. That avoids an extra round-trip and gives the same outcome as choosing afterwards. Choices that must come *before* an opponent's roll (Brace For Impact!) go through `pending` (§9).

Types below use TypeScript-ish notation as documentation, not as an implementation commitment.

---

## 2. Conventions

### Units
- **Distance:** centimetres, as JSON numbers (doubles). No rounding on storage.
- **Angles:** degrees.
- **Tolerance:** geometric comparisons (contact, "on the line between arcs", "moved at least 10 cm") use `EPS = 0.001` cm (0.01 mm). `a ≥ b` means `a > b − EPS`.

### Coordinate system
- Origin `(0, 0)` is the **bottom-left** corner of the table. `+x` runs along the bottom long edge to the right, `+y` up toward the top long edge.
- **All angles are aviation-style: degrees clockwise, normalised to `[0, 360)`.**
- **Relative bearings** are measured from the ship's bow: **0° dead ahead, 90° starboard, 180° aft, 270° port**. Arcs, aspect, armour facing and torpedo launch directions are all relative bearings.
- **Heading** (the one table-frame angle) uses the same clockwise convention, measured from the table's "up" (`+y`, toward the top long edge): 0 = facing the top edge, 90 = facing right (`+x`), 180 = facing the bottom edge, 270 = facing left. The direction vector is `(sin h, cos h)`.
- **Relative ↔ absolute:** a point at relative bearing `b` from a ship lies on table bearing `(heading + b) mod 360`. Conversely, `b = (atan2deg(dx, dy) − heading) mod 360`. Note the argument order: `atan2(dx, dy)`, not `(dy, dx)`.
- **Turns** are signed relative bearings: **positive = to starboard (clockwise)**, negative = to port. A 45° turn to port is `-45`.
- A ship's position is its **stem** (centre of its base). All range and movement is measured stem to stem (p. 39).

### Arcs and facings
A ship's surroundings divide into four 90° quadrants centred on its heading (p. 40):

| Quadrant | Relative bearing |
|---|---|
| `front` | 315° … 45° (through 0°) |
| `right` (starboard) | 45° … 135° |
| `rear` | 135° … 225° |
| `left` (port) | 225° … 315° |

Quadrant names follow the rulebook's fire arcs (Front / Left / Right / Rear).

The same quadrants give **fire arcs** (compass on the firer) and **target aspect / armour facing** (compass on the target). When a bearing lies on a boundary (within `EPS`), the *shooter* picks which side; the transform must say so (p. 59, p. 201).

Physical **weapon locations** (used by criticals) are separate from arcs: `prow | port | starboard | dorsal | keel | aft`. A Lunar's port lances are location `port`, arc `left`.

### Identifiers
- Every entity has a string `id`, unique across the whole state. Format `<kind>-<n>`: `ship-1`, `bm-14`, `ord-3`, `crit-7`, `log-120`.
- New ids come from the `nextId` counter (§3), so ids are deterministic and never reused.
- Player ids are `"p1"` and `"p2"`. Which player goes first, or deploys in which zone, is decided in setup and stored, not implied by the id.

### Player turns
A **player turn** is one player's Movement → Shooting → Ordnance → End sequence. A **round** (the rulebook's "game turn") is both players' turns. Cruiser Clash runs 8 rounds = 16 player turns.

Time is tracked as a single integer, **`playerTurn`**: 0 during setup, then 1, 2, 3 … The first player owns odd player turns, the second player owns even ones. So:

```
round(pt)        = ceil(pt / 2)
activePlayer(pt) = pt is odd ? setup.firstPlayer : the other player
```

Anything that needs a timestamp (when an order was issued, when it expires) stores a `playerTurn` number. That makes "before/after" a plain integer comparison.

### Rounding
Halving always **rounds up** (interpretation #5). Halvings stack: each applies to the already-halved value (p. 65: crippled + braced = halved twice).

---

## 3. Top level

```ts
type GameState = {
  meta: Meta
  scenario: Scenario
  table: Table
  players: { p1: Player, p2: Player }
  setup: SetupState
  clock: Clock
  ships: Ship[]
  squadrons: Squadron[]       // escort squadrons, and capital ships squadroned before the game (§7.5); absent in older saves: []
  blastMarkers: BlastMarker[]
  ordnance: Ordnance[]
  turnState: TurnState        // scratch data for the current player turn
  activation: Activation | null  // a ship that has declared an order, or is part-way through its path
  pending: PendingDecision[]  // interrupt stack; top = last element
  queue: WorkItem[]           // outstanding resolution work, front first (§9.3)
  rng: RngState
  nextId: number
  log: LogEntry[]
  result: GameResult | null   // set when clock.stage = "ended"
}
```

Arrays of entities (`ships`, `blastMarkers`, `ordnance`) are kept in **creation order** so iteration is deterministic. Look-ups are by `id`.

---

## 4. Meta, scenario, table, players

```ts
type Meta = {
  schemaVersion: 1
  ruleset: "bfg-remastered-1.10"
  createdAt: string            // ISO-8601, informational only; never read by rules
  options: {
    ramming: boolean           // default true
    boarding: boolean          // boarding actions and teleport attacks (pp. 89–92). Default false when
                               // a config doesn't say, so older saves replay unchanged; the app turns it on
    carriers: boolean          // "one carrier each" (p. 129): each side may field one ship with launch bays
                               // above the 185-point cap. Default false (transform §5)
    fleetLists: boolean        // fleets follow their fleet list: ratios, commanders (fleets book, pp. 11–14, 232).
                               // Points battles only. Default false when a config doesn't say (older saves); the app turns it on
  }
}

type Scenario = {
  id: "cruiser_clash"          // p. 128
     | "the_bait"              // p. 130
     | "raiders"               // p. 131
     | "surprise_attack"       // p. 132
     | "blockade_run"          // p. 133
     | "fleet_engagement"      // pp. 142–143
  maxRounds: number | null     // Cruiser Clash and The Raiders 8; Blockade Run 6 (N89); The Bait, Surprise Attack and Fleet Engagement null: until a fleet is destroyed or gone (N17, N53, N79)
  forces: Forces               // absent in older saves: { kind: "cruiser_clash" }
  scoring: "cruiser_clash"     // 1/damage, +1 crippled or +3 destroyed (p. 128)
         | "victory_points"    // standard victory points (pp. 122–123, §11)
  deploymentZones?: { A: Rect, B: Rect }  // Cruiser Clash only
  deploymentFacing?: { A: 180, B: 0 }     // Cruiser Clash only: "towards the opposite long table edge"
  attacker?: PlayerId          // scenarios with an attacker and a defender. The Bait: the pursuers (N47); The Raiders: the raiders (N56); Surprise Attack: the attackers (N72); Blockade Run: the blockade runners (N81); absent elsewhere
}

// How the fleets were chosen (transform §5). Kept for the record: the rules never read it after newGame.
type Forces =
  | { kind: "cruiser_clash" }                 // 1–4 cruisers a side, equal numbers, ≤ 185 pts each (p. 128)
  | { kind: "points", limit: number }         // each side up to `limit` points, any number of ships (p. 129)

type Rect = { x: number, y: number, width: number, height: number }  // x,y = bottom-left

type Table = {
  width: number, height: number                  // 180 × 120
  features?: Feature[]                           // celestial phenomena (pp. 102–116); absent: an empty table
}

type Feature = Planet                            // more kinds (gas clouds, asteroid fields, moons…) to come

type Planet = {
  kind: "planet"
  id: string
  position: Point                                // the template's centre
  size: "small" | "medium" | "large"
  diameter: number                               // cm: small 15, medium 25, large 35 (N64)
  well: number                                   // gravity well, cm beyond the template's edge: small 10, medium 15, large 30 (p. 112)
}

type Player = {
  id: "p1" | "p2"
  name: string
  faction: FactionId           // "imperial_navy" | "chaos" | …
  factionTraits: {
    boardingModifier: number   // Chaos/Orks +1, Space Marines +2, else 0 (p. 90)
  }
}
```

**Cruiser Clash geometry (interpretation #6):** 180 × 120 cm table. Zone **A** is `{x: 45, y: 90, width: 90, height: 30}` along the top edge; zone **B** is `{x: 45, y: 0, width: 90, height: 30}` along the bottom edge. That's 90 cm wide, centred, 30 cm deep, with the required 60 cm gap. A deployed ship's **stem** must be inside its zone.

**Fleet Engagement set-up maps (p. 143, N15).** Four maps, each with a **white** and a **dark grey** zone, white along the top edge. A zone is one or more **divisions**: a rectangle (`Rect`, bottom-left corner) and the heading its ships face (the map's arrows). They're engine constants, not stored: the state records which map and which colour each player has (§5).

| Map | Colour | Divisions: `x, y, width, height` → heading |
|---|---|---|
| A | white | `60, 90, 60, 30` → 180 |
| A | dark | `0, 0, 30, 120` → 45; `30, 0, 120, 30` → 0; `150, 0, 30, 120` → 315 |
| B | white | `0, 90, 67.5, 30` → 90; `67.5, 90, 45, 30` → 90; `112.5, 90, 67.5, 30` → 90 |
| B | dark | `0, 0, 67.5, 30` → 270; `67.5, 0, 45, 30` → 270; `112.5, 0, 67.5, 30` → 270 |
| C | white | `60, 75, 60, 45` → 180 |
| C | dark | `0, 0, 30, 120` → 0; `150, 0, 30, 120` → 0 |
| D | white | `45, 90, 90, 30` → 180 |
| D | dark | `0, 0, 60, 30` → 0; `60, 0, 60, 30` → 0; `120, 0, 60, 30` → 0 |

A deployed ship's stem must be inside one of its zone's divisions, and it faces that division's heading. Every division gets a ship before any gets a second (p. 142, N18).

**The Bait (p. 130, N47–N52).** The **pursued** player (the defender) fields the bait, one ship or one squadron, and reinforcements, which start in **reserve** (§7). The **pursuers** (`scenario.attacker`) field the rest. Each side has one division, an engine constant like Fleet Engagement's:

| Side | Division: `x, y, width, height` → heading |
|---|---|
| Pursued (the bait) | `75, 45, 30, 30` → 90: within 15 cm of the table centre, facing the east short edge (N49) |
| Pursuers | `0, 0, 30, 120` → 90: at least 60 cm behind the centre, chasing the bait (N50) |

Reinforcements arrive along the pursued player's **entry edges** (`entryEdges`, §11): the east short edge from the first round; from round *r* ≥ 2, also the last 30 × (*r* − 1) cm of each long edge next to it (N51).

**The Raiders (p. 131, N56–N63).** The defender deploys everything in one division, `30, 30, 120, 60`: every stem at least 30 cm from every table edge, all facing the table edge the defender chose (`raid.facing`, §5). Ships of different units (a ship in no squadron, or a squadron) stand at least 20 cm apart, stem to stem (N59). The raiders (`scenario.attacker`) start in **reserve** and all arrive in their first Movement Phase, each unit from any table edge (N60): `entryEdges` is all four edges in player turn 1, and none after.

**Surprise Attack (p. 132, N72–N80).** The defender deploys everything; the attackers (`scenario.attacker`) start in **reserve**. Both fleets are up to the points limit, and the table has a planet in its centre whose size the limit sets (N73). The defender's units are on **full alert** or on **standby** (`choose_alert`, §5; `standby`, §7). A ship on alert deploys in one division, `30, 30, 120, 60` (every stem at least 30 cm from every edge), at any heading the defender gives it. A ship on standby deploys anywhere on the table, at a heading that has the planet's centre in its port or starboard arc ("abeam of the planet's surface", N74); the defender's first ship on standby goes with its stem within 15 cm of the template's edge (N75). The attackers all arrive in their first Movement Phase, from one table edge (N76): `entryEdges` is all four edges until the first unit arrives, then only the edge it came in on (`surpriseAttack.entryEdge`), and none after player turn 1.

**Blockade Run (p. 133, N81–N89).** The runners (`scenario.attacker`) run from the bottom long edge (y = 0, their edge) to the top one (y = 120, the blockader's edge) (N83). The table's length is cut into thirds, `x` 0–60, 60–120 and 120–180 (N82). Each of the blockader's units (a ship in no squadron, or a squadron) deploys in the third it rolled (`blockade.thirds`, §5), with its stem at least 60 cm from the runners' edge: the division `60k, 60, 60, 60` for third *k*, at any heading the blockader gives it. The runners deploy in one division, `0, 0, 180, 15`, facing the blockader's edge (heading 0) (N84). The blockader deploys everything first, then the runners (N85).

**Planets (pp. 112–113, N64–N71).** A game can have one planet, its template centred on the table. Its **template** is the circle of radius `diameter / 2` around `position`; its **gravity well** reaches `well` cm beyond that edge. A stem *on the planet* is inside the template, edge included; a stem *in the gravity well* is within `diameter / 2 + well` of the centre, template included (N67).

---

## 5. Setup

Cruiser Clash's pre-battle sequence (p. 128) is part of the game, played out by transforms, so a game can be created from an empty roster and replayed exactly.

```ts
type SetupState = {
  leadershipRolled: boolean
  zoneRoll: number | null                 // p1 rolls D6: 1–3 → p1 deploys in A, 4–6 → B
  zones: { p1: "A" | "B", p2: "A" | "B" } | null
  deployOrderRolls: DiceRoll[]            // both roll D6, lowest deploys first; ties re-roll
  firstDeployer: PlayerId | null
  firstTurnRolls: DiceRoll[]              // both roll D6, highest chooses; ties re-roll
  firstTurnChooser: PlayerId | null
  firstPlayer: PlayerId | null            // who takes player turn 1
}

type DiceRoll = { p1: number, p2: number }   // one entry per attempt, ties included

// Fleet Engagement only (pp. 142–143); absent in Cruiser Clash
type Engagement = {
  formations: { p1: Formation | null, p2: Formation | null }   // p1 picks first, then p2 (N16)
  setupRolls: { rolls: DiceRoll, bonus: DiceRoll }[]           // the set-up roll-off: D6 + bonus each; ties re-roll
  setupChooser: PlayerId | null                                 // the roll-off's winner, who picks the set-up
  map: SetupMap | null
  colours: { p1: Colour, p2: Colour } | null
}

type Formation = "sphere" | "wedge" | "cross"
type SetupMap = "A" | "B" | "C" | "D"
type Colour = "white" | "dark"
```

`SetupState` gains `engagement?: Engagement`, present exactly when `scenario.id = "fleet_engagement"`.

**The formation table** (p. 142). Your formation's row, the opponent's column: the set-ups on offer, each a map and **your** colour.

| You ↓ / them → | Sphere | Wedge | Cross |
|---|---|---|---|
| **Sphere** | B | A dark / C dark | A dark / D dark |
| **Wedge** | A white / C white | D dark / D white | B |
| **Cross** | A white / D white | B | B |

A result naming two set-ups is a **split**. A plain **B** leaves the colours open, so it's offered as two set-ups too, B with each colour (N19). Either way the roll-off's winner picks one of the two.

`SetupState.firstDeployer` and `firstPlayer` start filled in for The Bait: the pursued player places the bait first and takes the first turn (p. 130, N55). There's no zone, deploy-order or first-turn roll.

The Raiders fill them in too: the defender deploys (everything; the raiders have nothing to deploy) and the raiders take the first turn (p. 131). `SetupState` gains `raid?: { facing: 0 | 90 | 180 | 270 | null, surpriseTurns: number | null }`, present exactly in The Raiders: the heading the defender chose for their fleet, and the D6 rolled with Leadership for how many rounds the defenders suffer −1 Leadership (N61).

Surprise Attack fills them in the same way: the defender deploys, the attackers take the first turn (p. 132). `SetupState` gains `surpriseAttack?: { alertUnits: number | null, alertChosen: boolean, entryEdge: 0 | 90 | 180 | 270 | null }`, present exactly in Surprise Attack: the D3 rolled with Leadership for how many of the defender's units start on full alert (N77), whether the defender has picked them (`choose_alert`), and the inward heading of the edge the attackers chose, set by their first arrival (N76).

Blockade Run has the blockader deploy first, all of their fleet, then the runners (N85); `firstDeployer` is the blockader and `firstPlayer` comes from the usual roll-off. `SetupState` gains `blockade?: { thirds: Record<string, 0 | 1 | 2> | null }`, present exactly in Blockade Run: for each of the blockader's units, by unit id (a squadron's id, or a ship's in none), the third it deploys in, rolled with Leadership (N86).

Who deploys next during `deploy` is derived: start with `firstDeployer`, then alternate, skipping a player who has no undeployed ships left. A squadron is one placement: while a player has a squadron partly deployed, they deploy next (transform T80).

---

## 6. Clock

```ts
type Clock = {
  stage: "setup" | "battle" | "ended"
  setupStep: SetupStep | null        // only when stage = "setup"
  playerTurn: number                 // 0 during setup, then 1, 2, …: at most 2 × maxRounds when it's set
  phase: Phase | null                // null during setup / ended
  step: Step | null
}

type SetupStep =
  | "roll_leadership" | "roll_zones" | "roll_deploy_order"
  | "choose_formation" | "roll_setup" | "choose_setup"          // Fleet Engagement, in place of roll_zones
  | "choose_facing"                                             // The Raiders: the defender's facing, before deploying
  | "choose_alert"                                              // Surprise Attack: the defender's units on full alert
  | "deploy" | "roll_first_turn" | "choose_first_turn"

type Phase = "movement" | "shooting" | "ordnance" | "end"

type Step =
  // movement
  | "hulks_drift"        // owner's hulks drift 4D6 cm (blazing ones re-roll catastrophic damage)
  | "move_ships"         // ships activate one at a time
  // shooting
  | "direct_fire"        // fire batteries / lances, ship by ship, weapon by weapon
  | "launch_ordnance"    // torpedoes are launched at the end of the phase (p. 73)
  // ordnance (both players, active player first; p. 74, p. 201)
  | "active_ordnance" | "inactive_ordnance"
  // end (p. 88: in this order)
  | "boarding"           // grapples fight, boarding actions, teleport attacks; skipped unless meta.options.boarding
  | "damage_control"     // both players repair; then the active player's fires burn
  | "blast_marker_removal"
```

Steps advance automatically once they're complete; steps with optional actions end with an `end_step` transform. The full table is in the [transform spec §2.3](../transforms/SPEC.md#23-automatic-advancement). Bookkeeping that the rules attach to a boundary is done by the reducer when it crosses that boundary:

| Boundary | Reducer housekeeping |
|---|---|
| Start of a player turn | `turnState` reset (§8). |
| Start of the owner's Movement Phase | Remove that player's special orders whose `expires.at = "movement_start"` and `expires.playerTurn ≤ now` (p. 51). |
| Entering `move_ships` | Each of the active player's **grappled** ships stays put: `moved = true`, `lastMove = { playerTurn, distance: 0 }` (drawn combats, pp. 90–91). |
| Entering `boarding` | Every grapple fights again (transform §4.6). |
| Entering `blast_marker_removal` | Each of the **active player's** ships takes 1 damage per `fire` critical still burning. Fires burn once per round, in their owner's End Phase, after both players have had their repair rolls. |
| End of a player turn | Remove orders whose `expires.at = "turn_end"` for this player turn (Brace For Impact!). |
| Entering `direct_fire` | If the active player has no `active` ship but has ships in `reserve`, those reserves disengage: they never arrived (N52). |
| End of round `maxRounds` (when it's set), or a fleet has no `active` ships and none in `reserve` left (D6, N52) | `stage = "ended"`, `result` filled in. |

---

## 7. Ships

```ts
type Ship = {
  id: string
  owner: PlayerId
  name: string                       // "Agrippa"
  profile: ShipProfile               // snapshot, never mutated
  leadership: number | null          // base Ld as rolled (6–9); null until rolled
  status: ShipStatus
  position: Point | null             // null unless on the table
  heading: number | null
  damage: number                     // hull damage taken, 0..profile.hits
  criticals: Critical[]              // currently in effect
  specialOrder: SpecialOrder | null
  loaded: { torpedoes?: boolean, launchBays?: boolean }   // one key per launcher kind the ship has; true at game start (p. 74)
  lastMove: { playerTurn: number, distance: number } | null
  grapple: Grapple | null            // locked in a drawn boarding action (pp. 90–91)
  commander: Commander | null        // an Admiral, Warmaster or Chaos Lord aboard (§7.4); absent in older saves
  standby?: true                     // Surprise Attack: on standby until it passes a Leadership test (N78); absent otherwise
  exitEdge?: 0 | 90 | 180 | 270      // moved off the table: the inward heading of the edge it left by (N87); absent otherwise
}

type Grapple = {
  defenderId: string
  attackerIds: string[]              // also the order in which the attackers take boarding damage
}

type ShipStatus =
  | "undeployed"
  | "reserve"                        // off the table, waiting to arrive along an entry edge (N51); The Bait's reinforcements
  | "active"
  | "drifting_hulk" | "blazing_hulk"  // 0 hits, still on the table
  | "destroyed"                      // removed: plasma/warp explosion, or a hulk that left the table
  | "disengaged"                     // left the table, or passed a disengage test

type Point = { x: number, y: number }
```

Notes:
- `damage` is capped at `profile.hits`. Hits beyond that (on a hulk, say) are logged but don't increase `damage`. Cruiser Clash scoring reads `damage`, so overkill doesn't score (D7).
- `lastMove` is written when the ship ends a move. A ship that didn't move at all (e.g. Burn Retros to zero) still gets `distance: 0`. It drives the **Defences** gunnery column (§11).
- `leadership` is the rolled value only. Bridge Smashed and any other modifiers are derived.
- `grapple`: a boarding action that ended in a draw locks its ships together. They fight again in **every** End Phase, both players', until the defender or every attacker is no longer `active` (drawn combats, pp. 90–91). Every ship in a grapple carries an **identical** `grapple` object. A ship leaves its grapple the moment it stops being `active` (it becomes a hulk, explodes, or leaves the table), and a grapple with no defender or no attackers left dissolves: every member's `grapple` becomes `null`. Grappled ships can't move, take orders, fire or launch ordnance, and other ships can't board them (transform T9).

### 7.1 Profile snapshot

Copied from [`rules/fleets/`](../rules/fleets/README.md) when the game is created, with the chosen options already applied (e.g. a nova-cannon Lunar has its torpedo entry replaced).

```ts
type ShipProfile = {
  classId: string                    // "lunar"
  className: string                  // "Lunar class cruiser"
  source: { book: "fleets", page: number }
  points: number                     // 180
  type: "battleship" | "cruiser" | "escort"
  category: ShipCategory             // the fleet lists' kind of hull, for their ratios (N20); absent in older saves: "cruiser"
  options: string[]                  // the option ids chosen for this ship, already applied below (N21); absent in older saves: []
  hits: number                       // starting damage capacity
  speed: number                      // cm
  turns: 45 | 90
  shields: number
  armour: { front: number, left: number, rear: number, right: number }  // "6+" → 6
  turrets: number
  baseSize: "small" | "large"
  weapons: Weapon[]
  traits?: ShipTraits                // the class's special rules (fleet book); absent = none
}

type ShipTraits = {
  allAheadFullDice?: number          // D6 rolled for All Ahead Full; default 4. Improved thrusters: 5 (N10)
  targetingMatrix?: boolean          // its weapons batteries take one column shift left (Mars, Overlord options)
  noComeToNewHeading?: boolean       // may not use Come to New Heading (the battleships, N31)
  leadershipBonus?: number           // added to its Leadership, max 10 (the Emperor's +1, N32)
  noLongRangeShift?: boolean         // its batteries take no column shift for firing over 30 cm (the Idolator, p. 281)
}

type ShipCategory = "cruiser" | "light_cruiser" | "heavy_cruiser" | "battlecruiser" | "grand_cruiser" | "battleship" | "escort"   // escorts count in no ratio (transform T77)

type Weapon = {
  id: string                         // unique within the profile: "port_lances"
  name: string                       // "Port lance battery"
  kind: "battery" | "lance" | "torpedoes" | "launch_bay" | "nova_cannon"
  location: "prow" | "port" | "starboard" | "dorsal" | "keel" | "aft"
  arcs: Quadrant[]                   // ["left"]; dorsal mounts e.g. ["left","front","right"]
  range: number | null               // direct fire: max range in cm; ordnance: null
  minRange?: number                  // nova cannon only: 30 cm. Its range is to the template's near edge (N13)
  speed: number | null               // ordnance: marker speed in cm; direct fire: null
  strength: number                   // firepower (batteries), strength (lances, torpedoes), squadrons (launch bays); 1 for a nova cannon
  craft?: CraftOption[]              // launch bays only: the attack craft they carry (fleet rules)
}

type CraftRole = "fighter" | "bomber" | "assault_boat"
type CraftOption = { role: CraftRole, name: string, speed: number }   // { "fighter", "Fury", 30 }

type Quadrant = "front" | "left" | "rear" | "right"
```

### 7.2 Criticals

```ts
type Critical = {
  id: string
  kind: CriticalKind
  playerTurn: number                 // when inflicted
}

type CriticalKind =
  | "dorsal_armament"     // 2
  | "starboard_armament"  // 3
  | "port_armament"       // 4
  | "prow_armament"       // 5
  | "engine_room"         // 6: no turns
  | "fire"                // 7: 1 damage in its owner's End Phase until repaired
  | "thrusters"           // 8: −10 cm speed
  | "bridge_smashed"      // 9: −3 Ld, unrepairable
  | "shields_collapse"    // 10: shields 0, unrepairable
```

- **Hull Breach (11)** and **Bulkhead Collapse (12)** only cause extra damage, so they never appear here; they show up in the log and in `damage`.
- Repairable criticals **stack**: three `fire` entries are three fires, and two `thrusters` entries both need repairing (speed only drops by 10 once) (p. 66).
- "Can't apply → next highest" (p. 67) is resolved by the reducer before anything is stored. For example, a Murder rolling "dorsal" (it has none) gets `starboard_armament`. A second Bridge Smashed or Shields Collapse can't apply either, so it moves up the table too.
- Hit-and-Run results are the same critical kinds.

### 7.3 Special orders

```ts
type SpecialOrder = {
  kind: OrderKind
  issued: number                     // playerTurn
  expires: { playerTurn: number, at: "movement_start" | "turn_end" }
  replaced: OrderKind | null         // Brace only: the order it superseded, whose effects persist (p. 66)
}

type OrderKind =
  | "all_ahead_full" | "come_to_new_heading" | "burn_retros"
  | "lock_on" | "reload_ordnance" | "brace_for_impact"
```

Expiry is computed once, when the order is issued:

| Order | Issued during | Expires |
|---|---|---|
| Anything but Brace | owner's turn `n` | `{ playerTurn: n + 2, at: "movement_start" }`, i.e. removed when the owner's next turn begins (p. 51) |
| Brace For Impact! | owner's own turn `n` | `{ playerTurn: n + 2, at: "turn_end" }` |
| Brace For Impact! | opponent's turn `n` | `{ playerTurn: n + 1, at: "turn_end" }` |

"Until the end of its next turn" plus "only one order at a time" also covers "no special orders in its next turn" (p. 66): while the brace order is live, nothing else can be issued.

The enemy's orders stay on their ships through *your* turn, which is exactly when the +1 **Enemy Contacts** Command-check modifier needs to see them.

### 7.4 Fleet commanders

```ts
type Commander = {
  kind: "admiral" | "warmaster" | "lord"   // admiral, warmaster: the fleet commander; lord: a Chaos Lord
  leadership: number                 // replaces the ship's rolled Leadership, even if lower (fleets book, p. 11)
  points: number                     // the commander, extra re-rolls and Marks: added to the ship's value (N25)
  marks: Mark[]                      // Marks of Chaos (Chaos Incursion, p. 232); [] for an Admiral
  rerolls: number                    // re-rolls left this game (N23)
}

type Mark = "slaanesh" | "khorne" | "tzeentch" | "nurgle"
```

- At most one fleet commander a side (an Admiral, or the Chaos Warmaster), and on Chaos's side up to three Lords, each on a different ship from the Warmaster and each other (transform §5).
- **Fleet commander re-rolls** (fleets book, p. 11) let the player re-roll a failed Command check or Leadership test, once per re-roll. A fleet commander's re-rolls serve any of their side's ships; a Chaos Lord's (Mark of Tzeentch) only his own (N24). Re-rolls go when the commander's ship suffers Bridge Smashed (p. 11), or stops being `active` (N23).
- **Marks of Chaos** (p. 232): Slaanesh, −2 Leadership to enemy ships within 15 cm of the ship (an area effect, line of sight ignored); Khorne, the ship's boarding value doubles, and a Warmaster's adds +1 to his rolls for boarding criticals; Tzeentch, +1 re-roll; Nurgle, +1 hit (already in `profile.hits`) and the ship can't be boarded. A Warmaster may have up to four Marks, each once; a Lord one.

### 7.5 Squadrons

```ts
type Squadron = {
  id: string                         // "sq-6": numbered after the ships (transform §5)
  owner: PlayerId
  name: string                       // "Blue Squadron"
  type: "escort" | "capital"         // escorts, or capital ships squadroned before the game (p. 95)
  shipIds: string[]                  // its members, in config order
  disengaging: boolean               // escort squadrons: one escort has left or disengaged, so every move
                                     // from now on attempts to disengage (p. 56, N41)
}
```

- **Composition** (p. 95): every escort is in exactly one squadron, of escorts only, up to six. A capital squadron has two or more capital ships of the same `type` (all cruisers, or all battleships), declared before the game; a capital ship is in at most one. Members are never added. A capital ship that fails a disengage test leaves its squadron for good (p. 56): its id is removed from `shipIds`.
- **Leadership** (p. 45): an escort squadron rolls once and every member's `leadership` holds that value. Capital ships roll individually, as before.
- **Formation** (p. 96): a squadron's members in formation are its largest chain of `active` members whose stems are linked, each within `FORMATION_RANGE` = 15 cm of another (N35). Others are **strays**: they act as single ships, with their own orders and targets, until they're back in formation (N36). Formation is derived from positions, never stored.
- A squadron with one member left in formation is still a squadron for its orders, its Leadership and victory points; it just has no one to combine with.

---

## 8. Turn state (scratch for the current player turn)

Facts that only matter within one player turn. Reset at the start of every player turn.

```ts
type TurnState = {
  playerTurn: number
  commandCheckFailed: boolean        // active player's fleet failed a Command check (p. 48)
  ships: { [shipId: string]: ShipTurnState }   // entries for every ship, both sides
  ordnanceMoved: string[]            // ordnance ids moved in the current Ordnance step
  braceFailures: { shipId: string, source: AttackSource }[]   // can't re-try vs this source (p. 66)
  hulkRolls: { hulkId: string, source: AttackSource }[]       // catastrophic re-rolls already made (reducer R3)
  blastMarkersRemoved: boolean
  squadronMove: SquadronMove | null  // a squadron part-way through its Movement Phase (N37); absent in older saves: null
}

type SquadronMove = {
  squadronId: string
  order: OrderKind | null            // the order its members took together, or null (none, or the check failed)
  aafExtra: number | null            // the one All Ahead Full roll for the whole squadron (p. 95)
  members: string[]                  // the ships in formation when it began: these move, one at a time, before anything else does
  disengage: boolean | null          // escort squadrons: the disengage flag its first mover chose, which the rest must match (N41)
}

type ShipTurnState = {
  moved: boolean                     // finished its activation this Movement Phase
  drifted: boolean                   // hulks only: has drifted this Movement Phase
  priorityTest: "passed" | "failed" | null   // Ld test to ignore the nearest target (p. 60)
  weaponsFired: string[]             // weapon ids fired/launched this turn
  disengage: "passed" | "failed" | null      // failed → may not fire, launch or take orders (except Brace)
  boardingDeclared: string | null    // target ship id: declared with the move that made contact (p. 89)
  boarded: boolean                   // its boarding action has been fought this End Phase
  teleported: boolean                // made its teleport attack this End Phase (pp. 91–92)
  turrets: { phase: Phase, against: "torpedoes" | "attack_craft" } | null
                                     // what its turrets (own, or massed for a friend) fired at this phase:
                                     // torpedoes or attack craft, never both in one phase (p. 80)
  repaired: boolean                  // damage control rolled this End Phase
  alerted?: true                     // Surprise Attack: went on alert this player turn: no special orders (N78); absent otherwise
}

type AttackSource =
  | { kind: "ship", id: string }       // all of one ship's attacks in this phase
  | { kind: "ordnance", id: string }
  | { kind: "explosion", id: string }  // a catastrophic-damage event; id of the exploding ship
```

---

## 9. Activation and pending decisions

### 9.1 Activation: a ship's move

A ship moves with two transforms at most:

1. **Declare order** (optional): pick a special order. The reducer rolls the Command check and, for All Ahead Full, the ram target's Leadership test and the 4D6 extra distance. It opens an `activation` holding the results. A failed check still opens one, with `order: null`.
2. **Move**: the whole path in one go. With no order declared, this opens and closes the activation in one transform.

```ts
type Activation = {
  kind: "move"
  shipId: string
  stage: "ordered" | "moving"        // ordered: order rolled, path not yet submitted
                                     // moving: path submitted and being executed (at rest only while `pending` waits)
  order: OrderKind | null            // order taken for this move (null if none, or the check failed)
  aafExtra: number | null            // 4D6 cm rolled for All Ahead Full
  ram: { targetId: string, testPassed: boolean, resolved: boolean } | null
  maxDistance: number                // speed (+ aafExtra) after crippled/thrusters; −5 once if slowed by BMs
  minDistance: number                // ½ speed, 0 for Burn Retros, = maxDistance for AAF
  start: { position: Point, heading: number }
  distanceMoved: number              // forward distance executed so far
  distanceSinceTurn: number          // forward distance since the start or the last turn
  turnsMade: number
  truncated: boolean                 // the move was cut short mid-path (see below)
  remainingPath: PathStep[]          // empty while stage = "ordered"
  slowedByBlastMarkers: boolean      // the −5 cm has been applied (once per move)
  zeroShieldBMTestDone: boolean      // 0-shield ship already rolled for moving through BMs
  disengage: boolean                 // the move asked for a disengage test at its end
  boardTargetId: string | null       // the move declares a boarding action against this ship (transform §4.2)
  squadronId: string | null          // the ship moves as part of this squadron's move (turnState.squadronMove); absent in older saves: null
}

type PathStep =
  | { kind: "advance", distance: number }   // straight ahead, cm
  | { kind: "turn", degrees: number }       // signed, + = starboard
  | { kind: "gravity_turn", degrees: number }  // a gravity well's free turn toward the planet, first and/or last step only (N68)
```

The validator checks the whole path against everything it can know in advance: speed limits, the minimum move, distance before turning (10 cm for a cruiser; not reduced by BM slowing, p. 201), turn count and angle for the order, Engine Room damage, BMs the path crosses (−5 cm), an AAF ship having to stop on contact with a BM in its last 5 cm, and leaving the table.

The reducer then executes the path step by step. Most moves finish inside one reduce: the reducer writes the ship's new `position`/`heading` and `lastMove`, rolls the disengage test if one was requested, sets `turnState.ships[id].moved`, and clears `activation`.

A move pauses only when contact needs another player's answer: the ram target's base, or a torpedo salvo, with the ship allowed to brace. The reducer stops the ship at the contact point and keeps the rest of the path in `remainingPath`. It queues the contact's resolution followed by a "continue move" work item (§9.3), and the brace offer pushes the decision onto `pending`. Once it's answered, the reducer **carries on with the rest of the path automatically**, with no new transform from the moving player.

Dice can change things mid-path, e.g. an exploding ram target drops Blast Markers in the rammer's way, or a ram critical wrecks the engine room. The reducer runs the remaining steps for as long as they're still legal and **ends the move at the first one that isn't**. Truncating a move like this isn't penalised, even if the ship ends up short of its minimum distance.

### 9.2 Pending decisions

Some rules make the *non-acting* player decide before a roll is made. The canonical case is Brace For Impact!, which must be declared before the to-hit roll (p. 66), including before turrets against ordnance. When a brace is possible, the reducer pushes a decision onto `pending` and stops:

```ts
type PendingDecision = {
  id: string
  kind: "brace"                      // Phase 1 has only this kind
  player: PlayerId                   // who must answer
  shipId: string                     // ship that may brace
  source: AttackSource
}
```

Rules:
- While `pending` is non-empty, only the top entry's `player` may act, and only with a transform that answers it.
- The reducer only pushes a `brace` decision when bracing is actually possible: the ship is on the table, not a hulk, not already braced, and hasn't failed a brace against this `source` (`turnState.braceFailures`).
- Answering a brace either attempts the Command check (2D6 ≤ Ld with the usual modifiers) or declines. The reducer then pops the entry and carries on with the work queue.

### 9.3 Work queue

Everything the reducer still has to resolve lives in `queue`: an ordered list of plain-data **work items**, processed front first. The `WorkItem` union and what each item does are defined in the [reducer spec §11](../reducer/SPEC.md#11-work-items). Examples: "resolve this battery shot", "continue this ship's move", "this explosion hits that ship".

- Follow-up work is **inserted at the front**, so chains resolve depth-first and in order.
- **Offering a brace is a work item** placed right before the roll it protects. If the ship can brace, it pushes a `pending` decision, and the queue waits there.
- **At rest, `queue` is empty unless `pending` is non-empty.** A state saved mid-interrupt holds the decision *and* the work behind it, so it reloads exactly.

## 10. Blast markers, ordnance, RNG, log

### 10.1 Blast markers

```ts
type BlastMarker = {
  id: string
  position: Point                    // centre
  placed: number                     // playerTurn
  cause: "shield_hit" | "hulk" | "explosion" | "nova_miss" | "escort_lost"
}
```

- Blast Markers are circles of diameter **2.5 cm** (engine constant). The rulebook only says a BM is smaller than a small base (p. 71).
- A nova cannon shell that touches no ship and no ordnance leaves a single BM where its template landed, `cause: "nova_miss"` (p. 64).
- A lost escort leaves a single BM at its stem, `cause: "escort_lost"` (p. 68, N34).
- Placement (in the line of fire, fanned around the base without stacking, p. 68) is the reducer's job. The state only stores where they ended up. BMs never move once placed.

### 10.2 Ordnance: torpedo salvoes and attack craft

```ts
type Ordnance = TorpedoSalvo | AttackCraftWave

type TorpedoSalvo = {
  id: string
  kind: "torpedo_salvo"
  owner: PlayerId
  launchedBy: string                 // ship id
  launched: number                   // playerTurn
  position: Point                    // centre of the salvo's leading edge
  heading: number                    // fixed; standard torpedoes never turn
  strength: number                   // current; −1 per hit inflicted, −1 per turret success
  speed: number                      // cm per Ordnance Phase
  width: number                      // 2.5 cm (p. 76)
  attacks: { targetId: string, round: number }[]   // no attacking the same target twice in a round (p. 77)
}
```

- A salvo is modelled as a **line segment** `width` cm wide, centred on `position`, perpendicular to `heading`. Moving it sweeps a rectangle, and contact is "the swept rectangle intersects a base circle".
- On launch the marker sits at the launcher's stem facing the chosen heading. It moves its full speed in the same player turn's Ordnance Phase (interpretation #4) and in every later Ordnance Phase of both players.
- A salvo whose strength reaches 0, that detonates, or that leaves the table is **removed from the array**. The log keeps the history.

```ts
type AttackCraftWave = {
  id: string
  kind: "attack_craft"
  owner: PlayerId
  launchedBy: string                 // ship id
  launched: number                   // playerTurn
  position: Point                    // centre of the wave's footprint
  squadrons: Squadron[]              // one per marker, in launch order; never empty while in play
  cap: string | null                 // ship id it flies Combat Air Patrol for (then a single fighter)
}

type Squadron = { role: CraftRole, name: string, speed: number }
```

- A **wave** is one entity, however many markers it has. Its markers move together at the slowest one's speed, and a wave can't be re-formed once it splits (p. 85). A single squadron is a wave of one.
- **Footprint:** a circle of radius `CRAFT_RADIUS × √n` for `n` squadrons, centred on `position` (ruling N8). Contact is that circle touching a ship's base, a salvo's segment or another wave's circle.
- **CAP:** a fighter on Combat Air Patrol (pp. 81–82) has `cap` set to the ship it screens. Its `position` is that ship's stem, updated whenever the ship moves, and it doesn't move in the Ordnance Phase. CAP fighters are always single squadrons ("independent markers, not a wave", p. 82).
- **Marker to marker:** interactions remove squadrons one for one (p. 85), fighters first where the rules say so. When a wave's last squadron goes, the wave is removed from the array.

### 10.3 Random numbers

```ts
type RngState = {
  algorithm: "mulberry32"
  seed: number                       // uint32, recorded for reproducibility
  state: number                      // uint32, current internal state
  draws: number                      // number of uint32 values drawn so far (debugging)
}
```

- A D6 is drawn by **rejection sampling**: take a uint32 `u`; if `u ≥ 4294967292` (the largest multiple of 6 ≤ 2³²) draw again; otherwise the result is `u mod 6 + 1`. No modulo bias.
- D3 = `ceil(D6 / 2)`. nD6 = n separate draws, in order.
- The order in which the reducer draws dice is part of the reducer spec, so replays reproduce.
- Seeded and in-state, deliberately. Anyone holding the state could predict the next rolls. That's fine for hot-seat on the honour system, and we're not designing beyond it.

### 10.4 Log

```ts
type LogEntry = {
  id: string
  playerTurn: number
  phase: Phase | null
  kind: string                       // "command_check", "move", "attack", "damage", "critical", …
  actor: PlayerId | null
  data: object                       // kind-specific; always includes any dice as `rolls: number[]`
}
```

An append-only, human-auditable record of everything the reducer resolved, every die included. The rules never read it (rule 3 in §1), but it makes the state self-explanatory: a UI can show "Unclean fires port battery: 7D6 → 6, 6, 3, 2, 6, 1, 5 → 3 hits, 2 absorbed by shields". The full list of entry kinds belongs in the reducer spec.

---

## 11. Derived values (never stored)

Every one of these is a pure function of the state. They're defined here so the validator, reducer and UI all compute them the same way.

| Value | Definition |
|---|---|
| `remainingHits(s)` | `profile.hits − damage` |
| `isCrippled(s)` | `2 × damage ≥ profile.hits` (lost half its hits, p. 65) |
| `squadronOf(s)` | the squadron listing `s` in `shipIds`, or none |
| `formation(sq)` | its members in formation (§7.5, N35): the `active` members on the table, split into chains where each stem is within 15 cm of another in the chain; the largest chain, on a tie the one holding the earliest member in `shipIds` |
| `inFormation(s)` | `s` is in `formation(squadronOf(s))`. A ship in no squadron is never in formation |
| `squadronLd(sq)` | escorts: the shared `leadership` of any member; capital: the highest `leadership(s)` among `formation(sq)` (p. 95) |
| `escortSquadronCrippled(sq)` | an escort squadron that has lost at least half its members, **rounding up**: ⌈n/2⌉ of its n starting ships no longer `active`, `disengaged`, `undeployed` or in `reserve` (p. 123, N43) |
| `squadronVP(sq)` | escort squadrons only (p. 123, N42): every member `destroyed` → the sum of their values; otherwise, once no member is `active`, `undeployed` or in `reserve`: ⌈25%⌉ of the squadron's full value if `escortSquadronCrippled`, else ⌈10%⌉; otherwise 0 |
| `isHulk(s)` | `status ∈ {drifting_hulk, blazing_hulk}` |
| `onTable(s)` | `status ∈ {active, drifting_hulk, blazing_hulk}` |
| `entryEdges(player)` | the segments of the table edge where `player`'s reserves may arrive this turn, each `{ from: Point, to: Point, inward: heading }`. The Bait, the pursued player: the east edge, `(180, 0)`–`(180, 120)`, inward 270; from round *r* = ⌈`playerTurn`/2⌉ ≥ 2 also `(180 − 30(r − 1), 0)`–`(180, 0)` inward 0 and `(180 − 30(r − 1), 120)`–`(180, 120)` inward 180, clipped to the table (N51). The Raiders, the raiders, in player turn 1 only: all four edges, inward 180 (top), 270 (east), 0 (bottom) and 90 (west) (N60). Surprise Attack, the attackers, in player turn 1 only: the four edges while `surpriseAttack.entryEdge` is null, then only the one whose inward heading it is (N76). Otherwise none |
| `arrivalEdge(p)` | for an arriving placement `{ position, heading }`: the inward heading of the table edge its stem is on; at a corner, the edge whose inward heading is nearer `heading`, on a tie the first of west (90), east (270), bottom (0), top (180) (N76) |
| `canArrive(player)` | `stage = "battle"`, `step = "move_ships"`, `player` is active, has a ship in `reserve`, and `entryEdges(player)` isn't empty |
| `onPlanet(p)` | the planet whose template holds point `p` (`distance(p, position) ≤ diameter/2`, within `EPS`), or none |
| `gravityWellAt(p)` | the planet whose gravity well holds `p` (`distance(p, position) ≤ diameter/2 + well`, within `EPS`), or none (N67) |
| `planetBlocks(from, to)` | some planet's template lies across the line from `from` to `to` (it passes closer than `diameter/2 − EPS` to the centre), and neither end is on that planet (N65) |
| `eliminated(player)` | no ship of `player`'s is `active` or in `reserve` (D6, N52) |
| `reservesMayWait(player)` | `player`'s reserves may stay off the table at the end of their Movement Phase: The Bait, yes; The Raiders and Surprise Attack, no, they all arrive in their first turn (N60, N76) |
| `onStandby(s)` | Surprise Attack: `s` is `active` and has `standby` (N78) |
| `wentOnAlert(s)` | `turnState.ships[s.id].alerted`: it went on alert this player turn (N78) |
| `surprised(s)` | The Raiders: `s` is the defender's and the round ⌈`playerTurn`/2⌉ is at most `raid.surpriseTurns` (N61) |
| `has(s, k)` | `s.criticals` contains an entry of kind `k` |
| `leadership(s)` | `min(10, base + (profile.traits.leadershipBonus ?? 0)) − (has(bridge_smashed) ? 3 : 0) − (slaaneshNear(s) ? 2 : 0) − (surprised(s) ? 1 : 0)`, where `base` is `s.commander.leadership` if it has a commander, else the rolled `s.leadership` (N22, N32) |
| `slaaneshNear(s)` | an enemy ship with the Mark of Slaanesh, `active`, has its stem within 15 cm of `s`'s stem (§7.4) |
| `shipValue(s)` | `profile.points + (commander?.points ?? 0)`: the ship, its options and anyone aboard (N25) |
| `rerollFor(s)` | the commander whose re-roll `s` would use, or none: its own commander if they have re-rolls left, else its side's fleet commander if theirs is `active` with re-rolls left (N23–N24) |
| `canBeBoarded(s)` | not on the Mark of Nurgle (§7.4) |
| `speed(s)` | `max(0, profile.speed − (crippled ? 5 : 0) − (has(thrusters) ? 10 : 0))` |
| `maxShields(s)` | `has(shields_collapse) ? 0 : crippled ? ⌈shields/2⌉ : shields`; hulks 0 |
| `bmsInContact(s)` | Blast Markers whose circle touches or overlaps the ship's base circle |
| `shieldCapacity(s)` | `max(0, maxShields − |bmsInContact|)` (interpretation #11) |
| `turrets(s)` | hulks 0; crippled `⌈turrets/2⌉`; else `turrets`. Not affected by Brace. |
| `launchCapacity(s)` | Σ `strength` over the ship's `launch_bay` weapons not lost to their side's armament critical, then halved (rounding up) if crippled and again if braced (p. 73, ruling N9) |
| `craftInPlay(player)` | the number of squadrons in the player's attack craft waves, CAP included |
| `fleetBays(player)` | Σ `launchCapacity` over the player's `active` ships: the fleet's ordnance limit (p. 73) |
| `armourFacing(target, from)` | quadrant of `target` containing `from`; armour = `profile.armour[quadrant]`. Bombers use the minimum. |
| `canTurn(s)` | `!has(engine_room)` |
| `weaponDisabled(s, w)` | a matching `<location>_armament` critical exists, or the ship failed its disengage test this turn, is grappled, or declared a boarding action this turn (p. 89) |
| `isGrappled(s)` | `s.grapple ≠ null` |
| `boardingValue(s)` | `remainingHits(s)` (p. 89), doubled with the Mark of Khorne. Later fleets modify it too (Tau halve it). |
| `shieldsDown(s)` | `shieldCapacity(s) = 0`: the ship can be teleported onto (pp. 91–92) |
| `novaCannonBarred(s)` | why `s` can't fire a nova cannon, or `null`: `"crippled"`, or `"order"` when its `specialOrder` is All Ahead Full, Come To New Heading, Burn Retros or Brace For Impact! (p. 64, p. 65). Lock On and Reload Ordnance don't matter to it. |
| `effectiveStrength(s, w)` | `w.strength`, halved (round up) once for each that applies: crippled; braced; for direct fire only, on AAF / Come To New Heading / Burn Retros |
| `targetedAsDefences(s)` | `lastMove.distance < 5` (p. 53) |
| `commandCheckLd(s)` | `leadership(s) − (bmsInContact non-empty ? 1 : 0) + (any enemy ship has a live specialOrder ? 1 : 0)`, max 10; roll ≤ that, 11–12 always fail. For a squadron, `squadronLd(sq)` replaces `leadership(s)`, and the −1 applies if any member in formation has a Blast Marker in contact (p. 95) |
| `gunneryColumn(target, aspect)` | defences → A; capital closing → B; capital moving away → C; capital abeam → D; escort closing → C; escort moving away → D; escort abeam → E; ordnance → E |
| `score(player)` | `scenario.scoring = "cruiser_clash"`: Σ over enemy ships: `damage` + (destroyedForScoring ? 3 : crippled ? 1 : 0) (p. 128). `"victory_points"`: `victoryPoints(player)` |
| `victoryPoints(player)` | Σ over enemy ships of `shipVP(s)`, plus Σ over enemy squadrons of `squadronVP(sq)`, plus `holdingTheField(player)` (pp. 122–123, N11–N12), plus in Blockade Run for the runners Σ over their own ships of `runVP(s)` (N88) |
| `runVP(s)` | Blockade Run, a runner that moved off the blockader's edge (`exitEdge` 180): `shipValue(s)`, or ⌈25%⌉ of it if `crippled`, escorts included, each on its own (N88); otherwise 0 |
| `shipVP(s)` | escorts → 0 (they score by squadron, `squadronVP`); `destroyedForScoring(s)` → `points`; `disengaged` → ⌈25%⌉ if `crippled`, else ⌈10%⌉; `active` and `crippled` → ⌈25%⌉; otherwise 0. `points` is `shipValue(s)` (N25) |
| `holdingTheField(player)` | if no enemy ship is `active` and at least one of the player's is: Σ ⌈50% × shipValue⌉ over every **hulk** on the table, friend or foe (N11); otherwise 0 |
| `destroyedForScoring(s)` | `status ∈ {destroyed, drifting_hulk, blazing_hulk}` (D7) |
| `deploymentDivisions(player)` | Cruiser Clash: one division, the player's zone rectangle facing `deploymentFacing[zone]`. Fleet Engagement: the divisions of the player's colour on `engagement.map` (§4). The Bait: the pursued player's or the pursuers' division (§4). The Raiders: the defender's one division, facing `raid.facing`; none for the raiders (§4). Surprise Attack, the defender: for a ship on standby the whole table, otherwise (and with no ship named) `30, 30, 120, 60`, both with no heading of their own: the defender gives one (§4); none for the attackers. Blockade Run: the blockader's ship goes in its unit's third, `60k, 60, 60, 60`, with no heading of its own; with no ship named, every third one of their units rolled; the runners' one division, `0, 0, 180, 15`, facing 0 (§4). `deploymentDivisions(player, ship?)` takes the ship being placed for this |
| `setupOptions()` | Fleet Engagement, both formations chosen: the two set-ups `{ map, colours }` from p1's row of the formation table (§5), split or B with each colour |
| `isSplit()` | the formation table gave two different maps, or Wedge against Wedge (D with each colour): a split result, which takes the roll-off bonuses |
| `setupBonus(player)` | on a split only: +1 if the player's fastest ship (profile `speed`) is faster than any enemy ship; +1 if their fleet commander has the higher Leadership, or they have one and the enemy hasn't (N46); +1 if they have more escorts (p. 142) |
| `actor(state)` | who must submit the next transform (§12) |

---

## 12. Whose move is it?

`actor(state)` is derived, never stored:

1. If `pending` is non-empty → top entry's `player`.
2. If `stage = "setup"` → by `setupStep`: `roll_*` steps accept the transform from either player (it's one machine; the reducer rolls for both). `choose_formation` → p1 until p1 has picked, then p2 (N16). `choose_setup` → `engagement.setupChooser`. `choose_facing` and `choose_alert` → the defender (the player who isn't `scenario.attacker`). `deploy` → the next deployer (§5). `choose_first_turn` → `setup.firstTurnChooser`.
3. If `stage = "battle"`:
   - `step = "inactive_ordnance"` → the player who is **not** active.
   - `step = "damage_control"` → either player, for their own ships. Each ship needing repair repairs once (`turnState.ships[id].repaired`); the step closes by itself when all have.
   - otherwise → `activePlayer(clock.playerTurn)`. While an `activation` is at `stage: "ordered"`, that player's only legal move transform is for the activated ship.
4. If `stage = "ended"` → nobody.

Every transform will carry a `player` field, and the validator rejects it if that doesn't match `actor(state)`. That isn't security, it's the honour system made explicit: it catches UI bugs, not cheats.

---

## 13. Invariants

Properties every valid state satisfies. These are good property-test fodder.

1. All ids are unique. Every numeric suffix is `< nextId`.
2. `0 ≤ damage ≤ profile.hits`. `damage = profile.hits` ⇔ `status ∈ {drifting_hulk, blazing_hulk, destroyed}`.
3. `position` and `heading` are non-null ⇔ `onTable(ship)`. On-table stems lie within the table rectangle.
4. A ship has at most one `specialOrder`. Hulks, undeployed, reserve, destroyed and disengaged ships have none.
5. `activation` is non-null only in `movement / move_ships`, and its ship is the active player's, with `turnState.ships[id].moved = false`. At rest, `activation.stage = "moving"` ⇒ `pending` is non-empty and `queue` contains a `continue_move` item.
6. `queue` is non-empty ⇒ `pending` is non-empty.
7. `pending` is empty unless `stage = "battle"`.
8. No `bridge_smashed` or `shields_collapse` critical appears twice on the same ship.
9. Every `TorpedoSalvo.strength ≥ 1`.
10. `turnState.playerTurn = clock.playerTurn`.
11. `clock.stage = "ended"` ⇔ `result ≠ null`.
12. Grapples are consistent. A ship with `grapple ≠ null` is `active`. Every ship its grapple names is `active` and carries an identical `grapple`. `defenderId ∉ attackerIds`, `attackerIds` is non-empty, and the attackers are all the defender's enemies. No ship is in two grapples.
13. Attack craft are consistent: every wave has ≥ 1 squadron. A wave with `cap ≠ null` is a single fighter, its ship is the owner's and `active`, and its `position` is that ship's stem.
14. At most one feature, a planet, whose id is unique like any other. `setup.engagement` is present ⇔ `scenario.id = "fleet_engagement"`, and `scenario.deploymentZones` is present ⇔ `scenario.id = "cruiser_clash"`. `maxRounds` is 8 in Cruiser Clash and The Raiders, 6 in Blockade Run, and null in The Bait, Surprise Attack and Fleet Engagement; when it's set, `playerTurn ≤ 2 × maxRounds`. `scenario.attacker` is present ⇔ `scenario.id ∈ {the_bait, raiders, surprise_attack, blockade_run}`. `setup.blockade` is present ⇔ `scenario.id = "blockade_run"`, where `maxRounds` is 6. `setup.raid` is present ⇔ `scenario.id = "raiders"`, where `maxRounds` is 8. `setup.surpriseAttack` is present ⇔ `scenario.id = "surprise_attack"`, where `maxRounds` is null and the table has its planet (N73).
15. Squadrons are consistent: every escort is in exactly one squadron and every capital ship in at most one; a squadron's members share its `owner`, and its `type` (escort squadrons hold escorts; capital squadrons ships of one `profile.type`). Every member of an escort squadron has the same `leadership`.
16. `turnState.squadronMove` is non-null only in `movement / move_ships`. Its members are the squadron's, the active player's, and at least one hasn't `moved`. While it's set, `activation` is null or for one of its members.
17. Ships in `reserve` exist only in The Bait, where they're the pursued player's (not `scenario.attacker`), and The Raiders and Surprise Attack, where they're the attacker's (`scenario.attacker`). A squadron's members are all in `reserve` or none is.
18. `standby` is only on the Surprise Attack defender's ships, and a squadron's members all have it or none has. `turnState.ships[id].alerted` is only on the defender's ships, in their own player turns.

```ts
type GameResult = {
  reason: "rounds_complete" | "fleet_eliminated"
  scores: { p1: number, p2: number }
  winner: PlayerId | null            // null = draw
}
```

---

## 14. Example: start of round 1

Agrippa (p1, Imperial, zone B, Ld 8) vs Unclean (p2, Chaos, zone A, Ld 7). Unclean's player won the first-turn roll and chose to go first, so p2 owns odd player turns. Log trimmed.

```json
{
  "meta": {
    "schemaVersion": 1,
    "ruleset": "bfg-remastered-1.10",
    "createdAt": "2026-10-03T20:00:00Z",
    "options": { "ramming": true, "boarding": false, "carriers": false }
  },
  "scenario": {
    "id": "cruiser_clash",
    "maxRounds": 8,
    "forces": { "kind": "cruiser_clash" },
    "scoring": "cruiser_clash",
    "deploymentZones": {
      "A": { "x": 45, "y": 90, "width": 90, "height": 30 },
      "B": { "x": 45, "y": 0, "width": 90, "height": 30 }
    },
    "deploymentFacing": { "A": 180, "B": 0 }
  },
  "table": { "width": 180, "height": 120 },
  "players": {
    "p1": { "id": "p1", "name": "George", "faction": "imperial_navy", "factionTraits": { "boardingModifier": 0 } },
    "p2": { "id": "p2", "name": "Also George", "faction": "chaos", "factionTraits": { "boardingModifier": 1 } }
  },
  "setup": {
    "leadershipRolled": true,
    "zoneRoll": 5,
    "zones": { "p1": "B", "p2": "A" },
    "deployOrderRolls": [{ "p1": 2, "p2": 4 }],
    "firstDeployer": "p1",
    "firstTurnRolls": [{ "p1": 3, "p2": 3 }, { "p1": 1, "p2": 6 }],
    "firstTurnChooser": "p2",
    "firstPlayer": "p2"
  },
  "clock": { "stage": "battle", "setupStep": null, "playerTurn": 1, "phase": "movement", "step": "move_ships" },
  "ships": [
    {
      "id": "ship-1",
      "owner": "p1",
      "name": "Agrippa",
      "profile": {
        "classId": "lunar",
        "className": "Lunar class cruiser",
        "source": { "book": "fleets", "page": 71 },
        "points": 180,
        "type": "cruiser",
        "hits": 8, "speed": 20, "turns": 45, "shields": 2,
        "armour": { "front": 6, "left": 5, "rear": 5, "right": 5 },
        "turrets": 2,
        "baseSize": "small",
        "weapons": [
          { "id": "port_lances", "name": "Port lance battery", "kind": "lance", "location": "port", "arcs": ["left"], "range": 30, "speed": null, "strength": 2 },
          { "id": "starboard_lances", "name": "Starboard lance battery", "kind": "lance", "location": "starboard", "arcs": ["right"], "range": 30, "speed": null, "strength": 2 },
          { "id": "port_battery", "name": "Port weapons battery", "kind": "battery", "location": "port", "arcs": ["left"], "range": 30, "speed": null, "strength": 6 },
          { "id": "starboard_battery", "name": "Starboard weapons battery", "kind": "battery", "location": "starboard", "arcs": ["right"], "range": 30, "speed": null, "strength": 6 },
          { "id": "prow_torpedoes", "name": "Prow torpedoes", "kind": "torpedoes", "location": "prow", "arcs": ["front"], "range": null, "speed": 30, "strength": 6 }
        ]
      },
      "leadership": 8,
      "status": "active",
      "position": { "x": 85, "y": 15 },
      "heading": 0,
      "damage": 0,
      "criticals": [],
      "specialOrder": null,
      "loaded": { "torpedoes": true },
      "lastMove": null,
      "grapple": null
    },
    {
      "id": "ship-2",
      "owner": "p2",
      "name": "Unclean",
      "profile": {
        "classId": "murder",
        "className": "Murder class cruiser",
        "source": { "book": "fleets", "page": 279 },
        "points": 170,
        "type": "cruiser",
        "hits": 8, "speed": 25, "turns": 45, "shields": 2,
        "armour": { "front": 5, "left": 5, "rear": 5, "right": 5 },
        "turrets": 2,
        "baseSize": "small",
        "weapons": [
          { "id": "port_battery", "name": "Port weapons battery", "kind": "battery", "location": "port", "arcs": ["left"], "range": 45, "speed": null, "strength": 10 },
          { "id": "starboard_battery", "name": "Starboard weapons battery", "kind": "battery", "location": "starboard", "arcs": ["right"], "range": 45, "speed": null, "strength": 10 },
          { "id": "prow_lances", "name": "Prow lance battery", "kind": "lance", "location": "prow", "arcs": ["front"], "range": 60, "speed": null, "strength": 2 }
        ]
      },
      "leadership": 7,
      "status": "active",
      "position": { "x": 100, "y": 105 },
      "heading": 180,
      "damage": 0,
      "criticals": [],
      "specialOrder": null,
      "loaded": {},
      "lastMove": null,
      "grapple": null
    }
  ],
  "blastMarkers": [],
  "ordnance": [],
  "turnState": {
    "playerTurn": 1,
    "commandCheckFailed": false,
    "ships": {
      "ship-1": { "moved": false, "drifted": false, "priorityTest": null, "weaponsFired": [], "disengage": null, "boardingDeclared": null, "boarded": false, "teleported": false, "turrets": null, "repaired": false },
      "ship-2": { "moved": false, "drifted": false, "priorityTest": null, "weaponsFired": [], "disengage": null, "boardingDeclared": null, "boarded": false, "teleported": false, "turrets": null, "repaired": false }
    },
    "ordnanceMoved": [],
    "braceFailures": [],
    "hulkRolls": [],
    "blastMarkersRemoved": false
  },
  "activation": null,
  "pending": [],
  "queue": [],
  "rng": { "algorithm": "mulberry32", "seed": 1337, "state": 2918350131, "draws": 11 },
  "nextId": 14,
  "log": [
    { "id": "log-3", "playerTurn": 0, "phase": null, "kind": "leadership_roll", "actor": null, "data": { "shipId": "ship-1", "rolls": [4], "leadership": 8 } },
    { "id": "log-4", "playerTurn": 0, "phase": null, "kind": "leadership_roll", "actor": null, "data": { "shipId": "ship-2", "rolls": [2], "leadership": 7 } }
  ],
  "result": null
}
```

(`lastMove: null` before a ship's first move counts as "not halted", so it isn't targeted as Defences. See N7.)

### Mid-game fragment: a pending brace

Round 2, Agrippa's turn (`playerTurn: 4`), Shooting Phase. Agrippa has declared its starboard lances at the Unclean. Unclean took a Thrusters critical in Agrippa's previous turn and has one Blast Marker touching its base from earlier lance hits. Before Agrippa rolls, the reducer asks p2 whether the Unclean braces. The shot itself waits in the queue:

```json
{
  "clock": { "stage": "battle", "setupStep": null, "playerTurn": 4, "phase": "shooting", "step": "direct_fire" },
  "pending": [
    {
      "id": "pend-41",
      "kind": "brace",
      "player": "p2",
      "shipId": "ship-2",
      "source": { "kind": "ship", "id": "ship-1" }
    }
  ],
  "queue": [
    {
      "kind": "direct_fire",
      "shooterId": "ship-1",
      "weaponId": "starboard_lances",
      "target": { "kind": "ship", "id": "ship-2" },
      "arc": "right",
      "aspect": "left"
    }
  ]
}
```

and on the Unclean, `"damage": 3, "criticals": [{ "id": "crit-30", "kind": "thrusters", "playerTurn": 2 }]`. From that, §11 gives: not crippled (3 × 2 < 8), speed 15 cm, max shields 2, shield capacity 1 (one BM in contact), and a brace Command check on Ld 7 − 1 (Under Fire) + 1 (Agrippa is on Lock On) = 7.

---

## 15. Interpretations this spec adopts

Rulings from [`rules/README.md`](../rules/README.md#interpretations--known-issues) that shape the state, plus new ones:

| # | Ruling | Where it shows |
|---|---|---|
| R#4 | Torpedoes move their full speed in the launch turn's Ordnance Phase, then in every Ordnance Phase of both players. | §10.2 |
| R#5 | All halving rounds up and stacks. | §2, §11 |
| R#6 | 180 × 120 table, 90 × 30 zones centred on the long edges. | §4 |
| R#11 | Shield capacity = shields − BMs in contact; no separate "shields down" flag. | §11 |
| N1 | Blast Marker diameter 2.5 cm. | §10.1 |
| N2 | A torpedo salvo is a zero-depth segment 2.5 cm wide; contact = swept rectangle hits a base. | §10.2 |
| N3 | The target-priority Ld test is taken once per ship per Shooting Phase. Passing it frees all that ship's weapons; failing it locks them onto the nearest target. | §8 |
| N4 | A failed Brace Command check does **not** set `commandCheckFailed` (it isn't one of the Movement-Phase special-order checks the p. 48 lockout is about). | §8 |
| N5 | Hulks count as **destroyed** for Cruiser Clash's +3. | §11 |
| N6 | **Fire!** deals its damage once per round (game turn), in the **owner's** End Phase after damage control. Both players still roll repairs in every End Phase. | §6 |
| N7 | A ship that hasn't moved yet (`lastMove: null`) is **not** targeted as Defences. | §11 |
| N8 | An attack craft marker's footprint is a circle of radius `CRAFT_RADIUS` = 1 cm (a 20 mm square's inscribed circle, p. 79); a wave of `n` markers is a circle of radius `√n` cm, about the area of a compact block. | §10.2 |
| N11 | **Victory points** read the ship's state at the game's end: a hulk is destroyed (full value, like N5), a crippled ship still fighting gives 25%, a disengaged one 25% if it was crippled, else 10%. Holding the field adds half of every hulk still on the table, friend or foe, to the side that holds it. A ship destroyed outright (exploded, off the table) isn't a hulk on the table. | §11 |
| N12 | Each percentage is taken per ship and rounded **up** (p. 122). | §11 |
| N10 | Improved thrusters (Slaughter "+5D6 on All Ahead Full", p. 280; Dauntless and Siluria "+D6", pp. 77–78) all come to **5D6** in place of the usual 4D6. Traits are only added as classes that use them arrive. | §7.1 |
| N13 | **The nova cannon template** is a circle of radius `NOVA_RADIUS` = 2.5 cm with a centre hole of radius `NOVA_HOLE_RADIUS` = 0.6 cm (5 cm and 1.2 cm diameters, p. 63). Its range is measured from the firer's stem to the template's **near edge**: `distance(stem, centre) − NOVA_RADIUS`, which must be 30–150 cm when it's placed and picks the scatter dice. | §7.1 |
| N14 | A nova cannon shot is **not a target**: it's aimed at a point, so it has no target priority test and no Gunnery Table, and the shot's hits are automatic. Its template hits whatever it touches where it lands, friend or foe, hulks included. | §11 |
| N15 | **Fleet Engagement's set-up maps** are transcribed from the p. 143 diagrams' stated distances (30 cm zones and strips, 45 and 60 cm centre divisions, 60 cm gaps), on the 180 × 120 table with white along the top edge. Where a diagram's arrow is diagonal it's taken as 45° off the long edge. | §4 |
| N16 | **Formations are picked on the honour system**, p1 first: p2's pick is made with p1's in the state, and the app simply doesn't show it (George's call). | §5 |
| N17 | **Fleet Engagement has no round limit** (p. 143: "until one fleet disengages or is destroyed"): `maxRounds` is null, and the game ends only when a side has no `active` ship (D6). | §4, §6 |
| N18 | **Divisions** (p. 142, "at least one ship or squadron in each"): while a player has no more undeployed ships than empty divisions, each ship must go into an empty one. With fewer ships than divisions, each goes to a different division. A stem on the shared edge of two divisions belongs to the first in the map's list. | §4 |
| N19 | **A plain B result** leaves the colours open: it's settled by the same roll-off, without the split bonuses, and the winner picks a colour. | §5 |
| N20 | **Categories**: the fleet lists count cruisers, light cruisers, heavy cruisers, battlecruisers and grand cruisers separately for their ratios, but every one of them is a `cruiser` in the core rules (gunnery, rams, Leadership tests to ram). `category` is only read by the fleet list checks. Their differences (6 or 10 hits, 90° turns, a third shield) are all in the profile. | §7.1 |
| N21 | **Ship options** (fleets book, ship entries) are applied when the game is made: replaced weapons, an extra turret or shield, a larger base, a trait, and their points. The profile snapshot is the ship as fielded; `options` records which were taken. The v0.11 option classes (`lunar_nova`, `tyrant_long`, …) stay in the catalogue so saves replay. | §7.1 |
| N22 | **A commander's Leadership replaces the ship's**, rolled or not, even when it's lower (fleets book, p. 11). Bridge Smashed and the Mark of Slaanesh still apply to it. | §11 |
| N23 | **Re-rolls are spent from the nearest commander**: the ship's own (a Lord with the Mark of Tzeentch, or the fleet commander's flagship), then its side's fleet commander. A commander whose ship is no longer `active`, or has suffered Bridge Smashed, has none left. | §7.4, §11 |
| N24 | **A Chaos Lord's re-roll** (Mark of Tzeentch) serves only his own ship: fleet commander re-rolls are the fleet commander's to give (p. 11). | §7.4 |
| N25 | **A ship's value** for victory points includes its options and any commander aboard, with their Marks and extra re-rolls (fleets book, p. 11: "the cost of any embarked commanders … included"). | §11 |
| N26 | **The Mark of Slaanesh** reaches 15 cm stem to stem, like other ranges; several such ships don't stack: −2 either way. | §11 |
| N27 | **Cruiser Clash has no fleet lists** and no commanders: each side takes any `cruiser` of its faction's catalogue, with options, at 185 points or less (p. 128). That now includes the Dauntless light cruiser, which the Gothic Sector list sells as a cruiser. Fleet lists come with points forces. | §4 |
| N28 | **The Repulsive's third shield** (+15 pts, p. 269) comes "when modelled on a large 60 mm base": the option sets `shields` 3 **and** `baseSize: "large"`, so the ship is bigger for every contact test (Blast Markers, rams, ordnance, the nova cannon). | §7.1 |
| N30 | **Battleships** (`type: "battleship"`, category `battleship`) use the rules the engine already has for them: 15 cm before turning (p. 54), the ram test's sizes (p. 55), and a large base (p. 44: "3+ shields or more than 10 hits"). Their launch bays may sit in the prow (the Chaos battle barge), lost to Prow Armament Damaged like any prow weapon. | §7.1 |
| N31 | **No Come to New Heading**: every battleship on the Gothic War lists says it may not use the order (pp. 53–54, 255, 266–267). It's a trait, `noComeToNewHeading`, so a battleship without it can arrive later. | §7.1 |
| N32 | **The Emperor's +1 Leadership** (p. 53) is added after a commander replaces the ship's value (N22), then capped at 10: an Admiral (Ld 9) aboard gives 10. Bridge Smashed and Slaanesh come off after the cap, as before. | §11 |
| N33 | **Options can exclude each other**: options sharing a `group` replace the same weapons (the Chaos battle barge's two battery refits), so a ship takes at most one per group. | §7.1 |
| N34 | **Escorts** (`type: "escort"`, Escort/1) follow the escort rules the engine has kept room for: they turn anywhere in their move (0 cm before turning), take the escort gunnery columns, and are the smallest size for rams. An escort reduced to 0 hits, or suffering a critical hit for any reason, is `destroyed` at once, leaving a Blast Marker where it was: no hulk, no Catastrophic Damage roll (pp. 67, 68). | §7.1 |
| N35 | **Formation is measured stem to stem**, like every other range here, each link ≤ 15 cm (p. 96). The squadron is its largest chain; a tie goes to the chain with the earlier member in `shipIds`, so formation never depends on who looked last. | §7.5 |
| N36 | **Strays** (p. 96: "no longer counts as part of the squadron until it moves back") act as single ships: their own orders and Command checks (with their own Leadership, which for an escort is still the squadron's), their own fire, and they're targeted on their own. "Must move back as soon as possible" is on the honour system; nothing refuses a move that keeps a stray away (George's call: rules as written, no softlocks). | §7.5 |
| N37 | **A squadron moves as one activation, ship by ship** (p. 57: ships move one at a time, even in a squadron). Once its first member declares an order or moves, the members in formation at that moment are fixed in `squadronMove`, and they all move before any other ship. Members destroyed or disengaged mid-move are skipped. | §8 |
| N38 | **Squadron orders** (p. 95): one Command check, against `squadronLd`, puts every member in formation on the order. All Ahead Full rolls its 4D6 once; each member adds it to its own speed and must use the whole distance. Brace For Impact! taken by one member braces every member in formation, replacing their orders. | §8, §9.1 |
| N39 | **A squadron's ram**: only the member that declares All Ahead Full names a ram target and takes the ram test. The rest of the squadron follows on All Ahead Full without ramming. | §9.1 |
| N40 | **Squadrons and target priority**: the squadron takes one priority test, against `squadronLd`, and its result holds for every member for the rest of the turn (`priorityTest` is written to each). | §8 |
| N41 | **Escort squadrons disengage together** (p. 56): one test, when the last of its members has moved, with +1 per Blast Marker within 5 cm of any member and −1 per enemy ship or salvo within 15 cm of any member (each counted once). A pass takes every member off the table; a fail marks them all `disengage: "failed"`. Once any escort has left the table or disengaged, `disengaging` is set and every member's move from then on must attempt it. | §7.5 |
| N42 | **Escorts score by squadron** (p. 123): the full value only when every member is destroyed; a squadron with no member left `active` and not wholly destroyed has disengaged, for 10%, or 25% if crippled. A squadron still fighting at the end scores nothing, however battered. | §11 |
| N43 | **An escort squadron is crippled** when it has lost half its ships, **rounding up** (p. 123; George's call over p. 57's "rounding down"): 1 of 2, 2 of 3 or 4, 3 of 5 or 6. | §11 |
| N44 | **Capital squadrons** use each member's own Leadership for its own tests (disengage, ram) and `squadronLd`, the highest in formation, for the squadron's Command checks, brace and priority tests (p. 95). They score ship by ship (p. 98). | §7.5, §11 |
| N45 | **Squadrons are for points battles.** Cruiser Clash fields single cruisers (p. 128), so it has neither escorts nor capital squadrons. | §7.5 |
| N46 | **The best Admiral's bonus** (p. 142) compares fleet commanders, an Admiral or the Warmaster, by the Leadership they were bought with (`commander.leadership`), before the Emperor's bonus or any other modifier. A fleet with one beats a fleet without; a Chaos Lord isn't a fleet commander and doesn't count; equal Leadership gives neither side the bonus. | §11 |
| N47 | **The Bait's roles** (p. 130): the pursued player fields the bait and its reinforcements; the other player is the pursuers. The book doesn't name an attacker; the pursuers press the attack, so `scenario.attacker` is theirs. | §4 |
| N48 | **The Bait's forces scale with the points limit** (`forces.limit`, p. 130's 500 by default): the pursuers up to `limit`; the bait one ship or one squadron up to ⌊`limit`/2⌋; the reinforcements up to `limit`. | §4 |
| N49 | **The bait faces the east short edge.** With no celestial phenomena (N54) the two short edges are alike, so the pursued player doesn't choose. "In the table centre" is a 30 cm square around it, so a squadron fits. | §4 |
| N50 | **"More than 60 cm behind it"** (p. 130): the pursuers' stems go in the west strip `x ≤ 30`, at least 60 cm behind the centre. Like every zone edge it's inclusive (V2). The book gives no facing; the pursuers face the way the bait does, chasing it. | §4 |
| N51 | **Reserves arrive** in their owner's `move_ships` step, any turn from the first (p. 130): each is placed with its stem on an entry edge, facing into the table, and then moves as usual, its move measured from the edge. A squadron arrives whole. From round 2 the long edges open 30 cm per round past the first, next to the east edge ("turn 4 → up to 90 cm along a long edge"). | §4, §11 |
| N52 | **A fleet with reserves still waiting isn't gone**: the game ends when a side has nothing `active` and nothing in `reserve`. But a player who ends their `move_ships` step with nothing on the table has given up: their waiting reserves disengage (uncrippled, so 10% of their value in VPs), and the game ends. Reserves still waiting when the *other* fleet is gone give no VPs: they were never engaged. | §6, §11 |
| N53 | **The Bait has no round limit**: "until one fleet disengages or is destroyed" (p. 130), like Fleet Engagement (N17). | §4 |
| N54 | **The Bait's battlezone** (D6: outer reaches or deep space) needs celestial phenomena, which aren't in yet: it's fought on the plain 180 × 120 table, like Fleet Engagement (transform T55). | §4 |
| N55 | **The Bait's set-up has no rolls but Leadership**: the bait deploys first, then the pursuers; the pursued player ("the fleeing ship") takes the first turn. | §5 |
| N56 | **The Raiders' roles** (p. 131): the attacker raids, the defender is caught at anchor. `scenario.attacker` is the raiders. | §4 |
| N57 | **The Raiders' forces** (p. 131): "agree a points limit" is `forces.limit`; the defender fields up to it, the raiders up to ⌊`limit`/2⌋. | §4 |
| N58 | **"All facing the same table edge"**: the defender chooses the edge before deploying (`choose_facing`: north, east, south or west), and every ship faces it. | §5 |
| N59 | **"Each ship/squadron ≥ 20 cm apart"**: stems of ships in different units are at least 20 cm apart (inclusive, V2). A squadron's own members keep the 15 cm formation rule instead. | §4 |
| N60 | **"Moves on from any edge in his first turn"**: every raiding unit arrives in the raiders' first Movement Phase, each from any of the four edges; none may wait. The book doesn't say one edge for the whole fleet, so each unit chooses. | §4, §11 |
| N61 | **The defenders' surprise**: the D6 is rolled with Leadership (`roll_leadership`), openly. "The first D6 turns" are game turns (rounds): the defenders take −1 Leadership in rounds 1 to *n*, on every Command check and Leadership test, as a change to `leadership(s)`. | §5, §11 |
| N62 | **The Raiders' battlezone** is "mutually agreed": the plain 180 × 120 table until celestial phenomena are in (N54). | §4 |
| N63 | **The Raiders' length**: 8 rounds (`maxRounds = 8`), or until a fleet is gone (D6). | §4 |
| N64 | **Planet sizes** (p. 112): small up to 15 cm across, medium 16–25, large 26–50. A template's size is the player's to choose within those; the engine fixes one per size so games agree: 15, 25 and 35 cm. Gravity wells as the book: 10, 15 and 30 cm. | §4 |
| N65 | **A planet blocks line of sight** (p. 112): a line of fire, from stem to stem (or to an aim point or ordnance), that passes over the template, closer than its radius to the centre, is blocked. A stem on the template sees out and is seen, so a line with either end on the planet isn't blocked by it. Grazing the edge isn't blocking. | §11 |
| N66 | **Torpedoes are destroyed at the template's edge** (p. 112, "either direction"): a salvo that touches the edge going in, or whose centre reaches it coming out (launched from a ship on the planet), is removed there. Attack craft aren't affected: the book names torpedoes only. | §10.2 |
| N67 | **"In a gravity well"** includes the template itself: a ship on the planet is in its well. | §4, §11 |
| N68 | **Gravity well turns** (p. 112): a ship whose stem is in a well at the start and/or end of its move may make one free turn of up to 45° there, toward the planet: it turns the bow toward the planet's centre and no further. It's a `gravity_turn` step, first or last in the path. It isn't a turn for the order's turn limit or for distance before turning, and it's allowed on any order and with an Engine Room critical, since gravity does the turning. | §9.1 |
| N69 | **High orbit** (p. 112): a ship whose stem starts its move in a gravity well needn't move: its minimum move is 0. All Ahead Full still moves its full distance. A ship that stays put is targeted on the Defences column, as any ship moving less than 5 cm (N7). | §9.1 |
| N70 | **Hulks drifting into a planet are destroyed** (p. 112): when a drifting hulk's stem reaches the template, it's removed. Ships moving under power pass over or under (p. 112). | §6 |
| N71 | **Low orbit isn't in yet**: it needs a separate low-orbit table, and only Planetary Assault and Exterminatus use it. | §4 |
| N72 | **Surprise Attack's roles** (p. 132): the attacker strikes, the defender is caught round a planet. `scenario.attacker` is the attackers. Forces are equal: both fleets up to `forces.limit`. | §4 |
| N73 | **The planet by points** (p. 132): a limit up to 500 gives a small planet, over 500 and up to 1,500 a medium one, over 1,500 a large one, in the table centre as any planet (N64). It's the battlezone's one phenomenon: the sunward edge and other phenomena wait for the rest of the celestial phenomena. | §4 |
| N74 | **"Abeam of the planet's surface"**: a ship on standby has the planet's centre in its port or starboard arc (inclusive at the boundaries, as every arc): it lies broadside on to the planet, as a ship in orbit does. | §4 |
| N75 | **"At least one ship within 15 cm of the planet"**: the defender's first ship placed on standby has its stem within 15 cm of the template's edge (inclusive). Asking it of the first ship rather than of the finished deployment can't leave the defender with a last ship that has nowhere to go. | §4 |
| N76 | **"Moves on from a table edge of choice"**: one edge for the whole attacking fleet, unlike The Raiders (N60). The first unit to arrive chooses it: the edge its first ship's stem is on (at a corner, the one that ship faces most nearly straight in from; on a tie the first of west, east, bottom, top), and the unit's other stems must be on that edge too. Every unit arrives in the attackers' first Movement Phase. Ships still face in at any angle (transform T96). | §4, §11 |
| N77 | **"D3 ships/squadrons on full alert"**: the D3 is the last die of `roll_leadership`. The defender names that many units (a ship in no squadron, or a squadron), or every unit if they have fewer. The rest are on standby. | §5 |
| N78 | **Standby** (p. 132): a ship on standby doesn't move (it stays put, so it's targeted as Defences, N69), fire or launch, and takes no special order but Brace for Impact; its turrets and shields work and it repairs as usual. At the start of each of the defender's Movement Phases, every unit on standby takes a Leadership test, 2D6 against `leadership(s)` (a squadron's against `squadronLd`), with none of a Command check's modifiers. On a pass it's on alert and moves and fires as usual this turn, but takes no special order, Brace included, for the rest of that player turn. A failure doesn't stop the fleet's special orders. | §7, §8 |
| N79 | **Surprise Attack's length**: until one fleet disengages or is destroyed, no round limit (as N17). | §4 |
| N80 | **Planetary defences aren't in yet**: the defender's extra D6 × 10 points of defences per 500 points come with the planetary defences. Until then, Surprise Attack is played without them. | §4 |
| N81 | **Blockade Run's roles and forces** (p. 133): the attacker runs the blockade; `scenario.attacker` is the runners. "Agree a total; the blockader spends it, the attacker up to half": the blockader fields up to `forces.limit`, the runners up to ⌊`limit`/2⌋, as in The Raiders. | §4 |
| N82 | **"Divide the table lengthways into thirds"**: the table's length (its 180 cm) is cut into three 60 cm thirds, each the full 120 cm deep, so the D6 sends a blockading unit to the left, centre or right of the runners' path. Boundaries are inclusive: a stem on x = 60 is in both neighbouring thirds. | §4 |
| N83 | **The two edges are the long ones**: the runners' edge is the bottom (y = 0), the blockader's the top (y = 120), so the run is across the table's width, through the thirds. The book doesn't name them; fixing them saves a choice that changes nothing. | §4 |
| N84 | **Facing**: the blockaders "any facing", so `deploy_ship` carries a heading for them (as Surprise Attack's defender, transform T116); the book gives the runners none, and they face the edge they're running for. "Not within 60 cm of the attacker's table edge" is a stem at least 60 cm from it, inclusive (V2). | §4 |
| N85 | **Deployment order**: the blockader sets up their whole fleet, then the runners theirs, the order the book lists them in, so the runners see the blockade they face. | §5 |
| N86 | **The thirds are rolled with Leadership**: after every ship's Leadership, one D6 per blockading unit in `ships` order (a squadron at its first member): 1–2 left, 3–4 centre, 5–6 right. | §5 |
| N87 | **The edge a ship leaves by** is recorded on it as `exitEdge`, the inward heading of that edge, whatever the scenario: at a corner, the edge it faces most squarely out of (as `arrivalEdge`, reversed). A ship that disengages by test has none. | §7 |
| N88 | **Running the blockade** (p. 133): the runners score the points value (`shipValue`) of each of their ships that moved off the blockader's edge, a quarter (⌈25%⌉) if it was crippled. It's on top of standard victory points, as written, so the blockader still scores those ships as disengaged (⌈10%⌉ or ⌈25%⌉). Escorts count one by one here. | §11 |
| N89 | **Blockade Run's length and battlezone**: 6 rounds (`maxRounds = 6`), or until a fleet is gone (D6). The battlezone (outer reaches or deep space) is the plain table until celestial phenomena are in (N54). | §4 |
| N29 | **Grand cruisers' immunity to prow criticals** (Vengeance, Exorcist, Avenger, Retaliator, Executor) isn't needed yet: the only grand cruiser on the Gothic War lists, the Repulsive, doesn't have it. It arrives as a trait with the first class that does. | §7.1 |
| N9 | Crippled and braced halve a carrier's launch bays **in total**, not bay by bay: a crippled Dictator launches 2 squadrons either way, but crippled **and** braced it launches 1 (4 → 2 → 1), where bay by bay would give 2 (each 2 → 1 → 1). | §11 |

---

## 16. Not in Phase 1 (extension points)

The shapes above leave room for these without breaking changes. Each will add fields or union members, never repurpose existing ones.

- **Terrain:** `table.features` holds a planet (§4); gas clouds, asteroid fields, moons, low orbit and `table.sunwardEdge` come later.
- **Other scenarios:** new `scenario.id`s with their own set-up blocks. Fleet Engagement, The Bait, The Raiders, Surprise Attack, Blockade Run, reserves and victory points are in (§4, §5, §7, §11); attack ratings and the random scenario tables (p. 120) come with the next scenarios.

---

## 17. Decisions

No open questions at v0.3.

| # | Question | Decision |
|---|---|---|
| D1 | Where does randomness live? | Seeded PRNG in the state (§10.3). No designing for networked play. |
| D2 | Move granularity | Whole path in one transform; the interface handles step-by-step (§9.1). |
| D3 | Log in the state? | Yes (§10.4). |
| D4 | Fire! timing | Once per game turn, in the owner's End Phase (N6). |
| D5 | Defences before the first move | Not Defences (N7). |
| D6 | Is a fleet whose ships all disengaged eliminated? | Yes. The game ends as soon as a side has no ship with `status = active`, and none in `reserve` (§6, N52). |
| D7 | Scoring edge cases | Overkill damage doesn't score (`damage` is capped); a hulk counts as destroyed for the +3 (N5); damage from a ship's own torpedoes still scores for the opponent. |
| D8 | Angle convention | Aviation-style, clockwise. Relative bearings from the bow (0° ahead, 90° starboard, 180° aft, 270° port); table heading 0° = toward the top edge (§2). |
| D9 | Turrets vs torpedoes after a Brace decision | Automatic: the reducer rolls the defender's turrets, no extra input. |
