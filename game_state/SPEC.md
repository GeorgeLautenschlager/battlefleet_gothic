# Game State Specification

**Status:** draft v0.4, for discussion. **Scope:** Phase 1 (Cruiser Clash, one Lunar vs one Murder, hot-seat), with room to grow.

This document defines the **game state**: a self-contained, machine-readable snapshot of a game of *Battlefleet Gothic Remastered* (rulebook v1.10). It's the first of four rules-engine pieces:

| Piece | Signature | Spec |
|---|---|---|
| **Game state** | plain data | this document |
| **Transform** | plain data: one proposed change, e.g. "Agrippa moves along this path" | [transforms/SPEC.md](../transforms/SPEC.md) |
| **Validator** | `validate(state, transform) → { ok: true } \| { ok: false, reason }` | to do |
| **Reducer** | `reduce(state, transform) → state` (transform already validated) | to do |

Rule references like `(p. 66)` are rulebook pages; `rules/05-damage.md` etc. are the markdown extraction. "Interpretation #N" refers to the numbered list in [`rules/README.md`](../rules/README.md#interpretations--known-issues).

---

## 1. Design principles

1. **Plain JSON.** The state is a JSON value: objects, arrays, strings, finite numbers, booleans, `null`. No `undefined`, `NaN`, `Infinity`, dates, classes, maps or functions. `JSON.parse(JSON.stringify(s))` deep-equals `s`.
2. **Self-contained.** Validator and reducer need nothing but the state and the transform. Ship profiles are **snapshotted** into the state at creation, so a later change to the fleets data can't change a game in progress. The random number generator's state lives in the game state too (§10).
3. **Store facts, derive the rest.** The state records what happened (damage taken, criticals suffered, where Blast Markers sit) and never what can be computed from it (crippled, current speed, effective shields, score). Derived values are defined once, in §11, so the validator, reducer and UI can't drift apart. The exceptions are things that depend on history that's otherwise gone, e.g. how far a ship moved in its last Movement Phase.
4. **Deterministic.** `reduce(s, t)` is a pure function. Same state + same transform → byte-identical result. All dice come from the in-state PRNG.
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
  blastMarkers: BlastMarker[]
  ordnance: Ordnance[]
  turnState: TurnState        // scratch data for the current player turn
  activation: Activation | null  // a ship that has declared an order or is suspended mid-move
  pending: PendingDecision[]  // interrupt stack; top = last element
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
    ramming: boolean           // Phase 1 default true
    boarding: boolean          // Phase 1 default false
  }
}

type Scenario = {
  id: "cruiser_clash"
  maxRounds: 8
  scoring: "cruiser_clash"     // 1/damage, +1 crippled or +3 destroyed (p. 128)
  deploymentZones: { A: Rect, B: Rect }
  deploymentFacing: { A: 180, B: 0 }    // "towards the opposite long table edge"
}

type Rect = { x: number, y: number, width: number, height: number }  // x,y = bottom-left

type Table = { width: number, height: number }   // Phase 1: 180 × 120

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
```

Who deploys next during `deploy` is derived: start with `firstDeployer`, then alternate, skipping a player who has no undeployed ships left.

---

## 6. Clock

```ts
type Clock = {
  stage: "setup" | "battle" | "ended"
  setupStep: SetupStep | null        // only when stage = "setup"
  playerTurn: number                 // 0 during setup, 1..2×maxRounds in battle
  phase: Phase | null                // null during setup / ended
  step: Step | null
}

type SetupStep =
  | "roll_leadership" | "roll_zones" | "roll_deploy_order"
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
  | "boarding"           // skipped unless meta.options.boarding
  | "damage_control"     // both players repair; then the active player's fires burn
  | "blast_marker_removal"
```

Steps advance automatically once they're complete; steps with optional actions end with an `end_step` transform. The full table is in the [transform spec §2.3](../transforms/SPEC.md#23-automatic-advancement). Bookkeeping that the rules attach to a boundary is done by the reducer when it crosses that boundary:

| Boundary | Reducer housekeeping |
|---|---|
| Start of a player turn | `turnState` reset (§8). |
| Start of the owner's Movement Phase | Remove that player's special orders whose `expires.at = "movement_start"` and `expires.playerTurn ≤ now` (p. 51). |
| Entering `blast_marker_removal` | Each of the **active player's** ships takes 1 damage per `fire` critical still burning. Fires burn once per round, in their owner's End Phase, after both players have had their repair rolls. |
| End of a player turn | Remove orders whose `expires.at = "turn_end"` for this player turn (Brace For Impact!). |
| End of round `maxRounds`, or a fleet has no `active` ships left (D6) | `stage = "ended"`, `result` filled in. |

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
  loaded: { torpedoes?: boolean }    // one key per launcher kind the ship has; true at game start (p. 74)
  lastMove: { playerTurn: number, distance: number } | null
  grapple: { withShipId: string } | null   // drawn boarding action (p. 90); Phase 1: always null
}

type ShipStatus =
  | "undeployed"
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

### 7.1 Profile snapshot

Copied from [`rules/fleets/`](../rules/fleets/README.md) when the game is created, with the chosen options already applied (e.g. a nova-cannon Lunar has its torpedo entry replaced).

```ts
type ShipProfile = {
  classId: string                    // "lunar"
  className: string                  // "Lunar class cruiser"
  source: { book: "fleets", page: number }
  points: number                     // 180
  type: "battleship" | "cruiser" | "escort"
  hits: number                       // starting damage capacity
  speed: number                      // cm
  turns: 45 | 90
  shields: number
  armour: { front: number, left: number, rear: number, right: number }  // "6+" → 6
  turrets: number
  baseSize: "small" | "large"
  weapons: Weapon[]
}

type Weapon = {
  id: string                         // unique within the profile: "port_lances"
  name: string                       // "Port lance battery"
  kind: "battery" | "lance" | "torpedoes"   // later: "nova_cannon", "launch_bay", …
  location: "prow" | "port" | "starboard" | "dorsal" | "keel" | "aft"
  arcs: Quadrant[]                   // ["left"]; dorsal mounts e.g. ["left","front","right"]
  range: number | null               // direct fire: max range in cm; ordnance: null
  speed: number | null               // ordnance: marker speed in cm; direct fire: null
  strength: number                   // firepower (batteries) or strength (lances, torpedoes)
}

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
  blastMarkersRemoved: boolean
}

type ShipTurnState = {
  moved: boolean                     // finished its activation this Movement Phase
  drifted: boolean                   // hulks only: has drifted this Movement Phase
  priorityTest: "passed" | "failed" | null   // Ld test to ignore the nearest target (p. 60)
  weaponsFired: string[]             // weapon ids fired/launched this turn
  disengage: "passed" | "failed" | null      // failed → may not fire, launch or take orders (except Brace)
  boardingDeclared: string | null    // target ship id; Phase 1 unused
  repaired: boolean                  // damage control rolled this End Phase
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
  stage: "ordered" | "suspended"     // ordered: order rolled, path not yet submitted
                                     // suspended: path partly executed, waiting on `pending`
  order: OrderKind | null            // order taken for this move (null if none, or the check failed)
  aafExtra: number | null            // 4D6 cm rolled for All Ahead Full
  ram: { targetId: string, testPassed: boolean, resolved: boolean } | null
  maxDistance: number                // speed (+ aafExtra) after crippled/thrusters; −5 once if slowed by BMs
  minDistance: number                // ½ speed, 0 for Burn Retros, = maxDistance for AAF
  start: { position: Point, heading: number }
  distanceMoved: number              // forward distance executed so far
  remainingPath: PathStep[]          // empty while stage = "ordered"
  slowedByBlastMarkers: boolean      // the −5 cm has been applied (once per move)
  zeroShieldBMTestDone: boolean      // 0-shield ship already rolled for moving through BMs
  disengage: boolean                 // the move asked for a disengage test at its end
}

type PathStep =
  | { kind: "advance", distance: number }   // straight ahead, cm
  | { kind: "turn", degrees: number }       // signed, + = starboard
```

The validator checks the whole path against everything it can know in advance: speed limits, the minimum move, distance before turning (10 cm for a cruiser; not reduced by BM slowing, p. 201), turn count and angle for the order, Engine Room damage, BMs the path crosses (−5 cm), an AAF ship having to stop on contact with a BM in its last 5 cm, and leaving the table.

The reducer then executes the path step by step. Most moves finish inside one reduce: the reducer writes the ship's new `position`/`heading` and `lastMove`, rolls the disengage test if one was requested, sets `turnState.ships[id].moved`, and clears `activation`.

A move pauses only when contact needs another player's answer: the ram target's base, or an enemy torpedo salvo, with the target allowed to brace. The reducer stops the ship at the contact point, keeps the rest of the path in `remainingPath`, sets `stage: "suspended"`, and pushes the decision onto `pending`. Once `pending` empties, the reducer **carries on with the rest of the path automatically**, with no new transform from the moving player.

Dice can change things mid-path, e.g. an exploding ram target drops Blast Markers in the rammer's way, or a ram critical wrecks the engine room. The reducer runs the remaining steps for as long as they're still legal and **ends the move at the first one that isn't**. Truncating a move like this isn't penalised, even if the ship ends up short of its minimum distance.

### 9.2 Pending decisions: the interrupt stack

Some rules make the *non-acting* player decide before a roll is made. The canonical case is Brace For Impact!, which must be declared before the to-hit roll (p. 66), including before turrets against ordnance. The reducer handles these by suspending the resolution it was doing and pushing a decision onto `pending`:

```ts
type PendingDecision = {
  id: string
  kind: "brace"                      // Phase 1 has only this kind
  player: PlayerId                   // who must answer
  shipId: string                     // ship that may brace
  source: AttackSource
  resume: SuspendedResolution[]      // what to finish once answered, run in order
}

type SuspendedResolution =
  | { kind: "direct_fire", shooterId: string, weaponId: string, targetId: string,
      arc: Quadrant, aspect: Quadrant }               // aspect = target quadrant facing the firer
  | { kind: "torpedo_attack", ordnanceId: string, targetId: string, facing: Quadrant }
  | { kind: "ram", rammerId: string, targetId: string, headOn: boolean, respondingTo: "rammer" | "target" }
  | { kind: "explosion", shipId: string, targets: string[], remaining: string[], strength: number, radius: number }
```

Rules:
- While `pending` is non-empty, only the top entry's `player` may act, and only with a transform that answers it.
- The reducer only pushes a `brace` decision when bracing is actually possible: the ship is on the table, not a hulk, not already braced, has no other live order that prevents it, and hasn't failed a brace against this `source` (`turnState.braceFailures`).
- Answering a brace either attempts the Command check (2D6 ≤ Ld with the usual modifiers) or declines. Then the reducer pops the entry and runs the `resume` list in order, which may push further decisions (an explosion that hits two ships asks about each in turn).
- `resume` is plain data, so a game saved mid-interrupt reloads exactly.

---

## 10. Blast markers, ordnance, RNG, log

### 10.1 Blast markers

```ts
type BlastMarker = {
  id: string
  position: Point                    // centre
  placed: number                     // playerTurn
  cause: "shield_hit" | "hulk" | "explosion" | "nova_miss"
}
```

- Blast Markers are circles of diameter **2.5 cm** (engine constant). The rulebook only says a BM is smaller than a small base (p. 71).
- Placement (in the line of fire, fanned around the base without stacking, p. 68) is the reducer's job. The state only stores where they ended up. BMs never move once placed.

### 10.2 Ordnance (Phase 1: torpedo salvoes)

```ts
type Ordnance = TorpedoSalvo         // later: AttackCraftWave, …

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
| `isHulk(s)` | `status ∈ {drifting_hulk, blazing_hulk}` |
| `onTable(s)` | `status ∈ {active, drifting_hulk, blazing_hulk}` |
| `has(s, k)` | `s.criticals` contains an entry of kind `k` |
| `leadership(s)` | `min(10, s.leadership − (has(bridge_smashed) ? 3 : 0))` |
| `speed(s)` | `max(0, profile.speed − (crippled ? 5 : 0) − (has(thrusters) ? 10 : 0))` |
| `maxShields(s)` | `has(shields_collapse) ? 0 : crippled ? ⌈shields/2⌉ : shields`; hulks 0 |
| `bmsInContact(s)` | Blast Markers whose circle touches or overlaps the ship's base circle |
| `shieldCapacity(s)` | `max(0, maxShields − |bmsInContact|)` (interpretation #11) |
| `turrets(s)` | hulks 0; crippled `⌈turrets/2⌉`; else `turrets`. Not affected by Brace. |
| `armourFacing(target, from)` | quadrant of `target` containing `from`; armour = `profile.armour[quadrant]`. Bombers use the minimum. |
| `canTurn(s)` | `!has(engine_room)` |
| `weaponDisabled(s, w)` | a matching `<location>_armament` critical exists, or the ship failed its disengage test this turn |
| `effectiveStrength(s, w)` | `w.strength`, halved (round up) once for each that applies: crippled; braced; for direct fire only, on AAF / Come To New Heading / Burn Retros |
| `targetedAsDefences(s)` | `lastMove.distance < 5` (p. 53) |
| `commandCheckLd(s)` | `leadership(s) − (bmsInContact non-empty ? 1 : 0) + (any enemy ship has a live specialOrder ? 1 : 0)`, max 10; roll ≤ that, 11–12 always fail |
| `gunneryColumn(target, aspect)` | defences → A; capital closing → B; capital moving away → C; capital abeam → D; ordnance → E |
| `score(player)` | Σ over enemy ships: `damage` + (destroyedForScoring ? 3 : crippled ? 1 : 0) (p. 128) |
| `destroyedForScoring(s)` | `status ∈ {destroyed, drifting_hulk, blazing_hulk}` (D7) |
| `actor(state)` | who must submit the next transform (§12) |

---

## 12. Whose move is it?

`actor(state)` is derived, never stored:

1. If `pending` is non-empty → top entry's `player`.
2. If `stage = "setup"` → by `setupStep`: `roll_*` steps accept the transform from either player (it's one machine; the reducer rolls for both). `deploy` → the next deployer (§5). `choose_first_turn` → `setup.firstTurnChooser`.
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
4. A ship has at most one `specialOrder`. Hulks, undeployed, destroyed and disengaged ships have none.
5. `activation` is non-null only in `movement / move_ships`, and its ship is the active player's, on the table, with `turnState.ships[id].moved = false`. `activation.stage = "suspended"` ⇔ `pending` is non-empty during Movement.
6. `pending` is empty unless `stage = "battle"`.
7. No `bridge_smashed` or `shields_collapse` critical appears twice on the same ship.
8. Every `TorpedoSalvo.strength ≥ 1`.
9. `turnState.playerTurn = clock.playerTurn`.
10. `clock.stage = "ended"` ⇔ `result ≠ null`.

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
    "options": { "ramming": true, "boarding": false }
  },
  "scenario": {
    "id": "cruiser_clash",
    "maxRounds": 8,
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
      "ship-1": { "moved": false, "drifted": false, "priorityTest": null, "weaponsFired": [], "disengage": null, "boardingDeclared": null, "repaired": false },
      "ship-2": { "moved": false, "drifted": false, "priorityTest": null, "weaponsFired": [], "disengage": null, "boardingDeclared": null, "repaired": false }
    },
    "ordnanceMoved": [],
    "braceFailures": [],
    "blastMarkersRemoved": false
  },
  "activation": null,
  "pending": [],
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

Round 2, Agrippa's turn (`playerTurn: 4`), Shooting Phase. Agrippa has declared its starboard lances at the Unclean. Unclean took a Thrusters critical in Agrippa's previous turn and has one Blast Marker touching its base from earlier lance hits. Before Agrippa rolls, the reducer asks p2 whether the Unclean braces:

```json
{
  "clock": { "stage": "battle", "setupStep": null, "playerTurn": 4, "phase": "shooting", "step": "direct_fire" },
  "pending": [
    {
      "id": "pend-41",
      "kind": "brace",
      "player": "p2",
      "shipId": "ship-2",
      "source": { "kind": "ship", "id": "ship-1" },
      "resume": [
        {
          "kind": "direct_fire",
          "shooterId": "ship-1",
          "weaponId": "starboard_lances",
          "targetId": "ship-2",
          "arc": "right",
          "aspect": "left"
        }
      ]
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

---

## 16. Not in Phase 1 (extension points)

The shapes above leave room for these without breaking changes. Each will add fields or union members, never repurpose existing ones.

- **Squadrons:** a top-level `squadrons: { id, owner, shipIds, leadership }[]`; orders move to the squadron.
- **Attack craft:** new `Ordnance` variants (`attack_craft` with role fighter/bomber/assault boat, `onCap` ship id); `loaded.launchBays`.
- **Nova cannon:** weapon kind `nova_cannon`, a `SuspendedResolution` for scatter.
- **Terrain:** `table.features: Feature[]` (gas clouds, asteroid fields, planets with gravity wells), `table.sunwardEdge`.
- **Boarding:** already sketched (`grapple`, `boardingDeclared`, `factionTraits.boardingModifier`); switched on by `meta.options.boarding`.
- **Fleet commanders and re-rolls:** `players[].commander: { shipId, rerollsLeft }`.
- **Other scenarios / victory points:** `scenario.scoring: "victory_points"` plus scenario-specific blocks.

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
| D6 | Is a fleet whose ships all disengaged eliminated? | Yes. The game ends as soon as a side has no ship with `status = active` (§6). |
| D7 | Scoring edge cases | Overkill damage doesn't score (`damage` is capped); a hulk counts as destroyed for the +3 (N5); damage from a ship's own torpedoes still scores for the opponent. |
| D8 | Angle convention | Aviation-style, clockwise. Relative bearings from the bow (0° ahead, 90° starboard, 180° aft, 270° port); table heading 0° = toward the top edge (§2). |
| D9 | Turrets vs torpedoes after a Brace decision | Automatic: the reducer rolls the defender's turrets, no extra input. |
