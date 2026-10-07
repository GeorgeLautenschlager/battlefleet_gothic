# Validator Specification

**Status:** draft v0.15, for discussion. **Scope:** Cruiser Clash (1–4 cruisers a side; one carrier each as an option). Builds on [Game State v0.20](../game_state/SPEC.md) and [Transforms v0.18](../transforms/SPEC.md). v0.4 added the boarding checks. v0.5 adds attack craft: `launch_attack_craft`, attack craft moves and CAP (`move_ordnance`'s `path` and `cap`, `release_cap`), and shooting at waves. v0.6 adds combined battery volleys (`fire` checks 21–25, V9). v0.7 adds the nova cannon (`fire_nova_cannon`, §2.1, §2.4, §2.7, V10–V11), and caps the minimum move of a ship starting on a Blast Marker (`move` check 13, V12). v0.8 adds Fleet Engagement's set-up: `choose_formation`, `choose_setup`, and divisions in `deploy_ship` (§4.1, V13). v0.9 adds the `reroll` checks and the Mark of Nurgle's boarding check (§4.2, §4.3, §4.5, V14). v0.10 refuses Come to New Heading to ships with the `noComeToNewHeading` trait (§4.2, `declare_order` check 8). v0.11 adds squadrons: deploying them (`deploy_ship` 7–9), their orders and moves (`declare_order` 12–13, `move` 5a–5c), shooting by and at them (`fire` 27–35, §2.7), and nine reason codes (V15–V18). v0.12 adds reserves for The Bait: `arrive`, `end_step` in `move_ships`, and refusing to deploy a reserve (§4.1, §4.2, V19–V21). v0.13 adds The Raiders: `choose_facing`, spacing at deployment (`deploy_ship` 6a), and raiders who can't wait (`end_step` in `move_ships`, check 1a) (V22–V23). v0.14 adds planets: blocked lines of fire (§2.7), gravity turns (`move` 6a) and high orbit (`move` 13) (V24–V27). v0.15 adds Surprise Attack: `choose_alert`, headings, standby and the first ship near the planet in `deploy_ship` (3b, 6b–6d), standby and the turn a ship goes on alert in `declare_order`, `move` and shooting, and one entry edge in `arrive` (10a) (V28–V31).

```ts
validate(state: GameState, transform: unknown) → ValidationResult

type ValidationResult =
  | { ok: true }
  | { ok: false, reason: { code: ReasonCode, message: string, details?: object } }
```

The validator decides whether **one** transform is legal in **one** state. This document defines:

1. its contract (§1);
2. the **geometry helpers** that both the validator and the reducer use (§2);
3. the **check order** for every transform, with the reason code each check fails with (§3–§4);
4. the reason codes themselves (§5).

---

## 1. Contract

1. **Pure and total.** No side effects, no dice, no clock. It returns a result for *any* input, including garbage (`MALFORMED`), and never throws.
2. **Assumes a valid state.** The state satisfies the invariants in state §13. Behaviour on a corrupt state is undefined; that's what the invariant tests are for.
3. **First failure wins.** Checks run in the order listed, and the first one that fails is the result. Same input → same reason, every time.
4. **`ok: true` is a promise.** If the validator accepts a transform, the reducer must be able to apply it without hitting an illegal situation it didn't foresee. Dice can still go badly (a failed Command check, a move truncated mid-path by a ram explosion, state §9.1), but those are outcomes, not validation errors.
5. **Codes are the contract; messages aren't.** Tests assert on `code` and `details`. `message` is human text for the UI and may change freely. Example: `"Agrippa must move 10 cm before turning (has moved 5 cm)"`.

---

## 2. Geometry helpers

Shared by validator and reducer: one module, one definition. Everything is 2D, in the coordinate system of state §2.

### 2.1 Constants

| Name | Value | Source |
|---|---|---|
| `EPS` | 0.001 cm | state §2 |
| `BASE_RADIUS.small` / `.large` | 1.6 / 3.0 cm | 32 mm / 60 mm bases (p. 44) |
| `BM_RADIUS` | 1.25 cm | state N1 |
| `TORPEDO_WIDTH` | 2.5 cm | p. 76 |
| `SHORT_RANGE` / `LONG_RANGE` | 15 / 30 cm | p. 62 |
| `DEFENCES_MOVE` | 5 cm | p. 53 |
| `TURN_DISTANCE.battleship` / `.cruiser` / `.escort` | 15 / 10 / 0 cm | p. 54 |
| `BM_SLOWDOWN` | 5 cm | p. 69 |
| `TELEPORT_RANGE` | 10 cm | teleport attacks, pp. 91–92 |
| `CRAFT_RADIUS` | 1 cm | one attack craft marker's footprint (state N8) |
| `NOVA_RADIUS` / `NOVA_HOLE_RADIUS` | 2.5 / 0.6 cm | the nova cannon template and its centre hole (state N13) |
| `FORMATION_RANGE` | 15 cm | squadron formation, stem to stem (p. 96, state N35) |

### 2.2 Tolerant comparison

All distance comparisons go through these, never bare `<` / `≤`:

```
approxLe(a, b) = a < b + EPS
approxGe(a, b) = a > b − EPS
approxEq(a, b) = |a − b| < EPS
```

Angles are compared the same way, in degrees.

### 2.3 Angles and bearings

```
norm(a)                 = ((a mod 360) + 360) mod 360
tableBearing(from, to)  = norm(atan2deg(to.x − from.x, to.y − from.y))   // 0 = +y, clockwise
relBearing(ship, point) = norm(tableBearing(ship.position, point) − ship.heading)
headingVector(h)        = (sinDeg(h), cosDeg(h))
angleBetween(a, b)      = min(norm(a − b), 360 − norm(a − b))                // 0..180
```

`atan2deg(x, y)` is `atan2(x, y)` in degrees. Note the argument order: `x` first, because 0° is `+y`. All trig here goes through the deterministic maths module (§2.8), never the platform's `Math.sin` & co.

**Quadrants of a bearing.** `quadrantsOf(b)` returns the set of quadrants whose closed range contains `b`, widened by `EPS` at each end:

| Quadrant | Range |
|---|---|
| `front` | `b ≥ 315` or `b ≤ 45` |
| `right` | `45 ≤ b ≤ 135` |
| `rear` | `135 ≤ b ≤ 225` |
| `left` | `225 ≤ b ≤ 315` |

The result has one element, or two when `b` is on a boundary. **Coincident points:** if two stems are within `EPS` of each other the bearing is undefined, and `quadrantsOf` returns all four.

```
quadrantsOfPoint(ship, point) = quadrantsOf(relBearing(ship, point))  // or all four if coincident
```

### 2.4 Distances and contact

```
distance(a, b)                = Euclidean distance between points
baseRadius(ship)              = BASE_RADIUS[ship.profile.baseSize]
basesTouch(s1, s2)            = approxLe(distance(s1.position, s2.position), baseRadius(s1) + baseRadius(s2))
bmTouchesShip(bm, ship)       = approxLe(distance(bm.position, ship.position), BM_RADIUS + baseRadius(ship))
bmsInContact(ship)            = blast markers with bmTouchesShip
segmentPointDistance(a, b, p) = shortest distance from p to segment ab
segmentTouchesCircle(a, b, c, r) = approxLe(segmentPointDistance(a, b, c), r)
novaRange(ship, aim)          = distance(ship.position, aim) − NOVA_RADIUS      // to the template's near edge (state N13)
templateTouchesShip(c, ship, r) = approxLe(distance(c, ship.position), r + baseRadius(ship))   // r: NOVA_RADIUS, or NOVA_HOLE_RADIUS for the hole
```

Contact is **inclusive**: touching counts.

### 2.5 Swept contact

Movement is checked by sweeping a shape along a straight line and asking where it **first** touches something. Every sweep works in the mover's local frame: `u` along the direction of travel, `v` across it.

**Swept circle vs circle** (a ship's base advancing `L` cm, against a base or a Blast Marker). Let the obstacle's centre be `(cu, cv)` in the local frame, and `R` = sum of the two radii.

```
if |cv| > R + EPS:            no contact
h  = sqrt(max(0, R² − cv²))
if cu + h < −EPS:             no contact (it's behind)
t* = max(0, cu − h)
contact at t* if t* ≤ L + EPS, else none
```

`t* = 0` means already in contact at the start.

**Swept torpedo segment vs circle.** A salvo is a segment `TORPEDO_WIDTH` wide, perpendicular to travel and centred on `position`. Against a circle of radius `R` at `(cu, cv)`:

```
dv = max(0, |cv| − TORPEDO_WIDTH / 2)
then as above with cv := dv
```

**Swept segment vs segment** (salvo meets salvo). Moving the salvo `L` cm sweeps a rectangle. Contact is the smallest `t ∈ [0, L]` at which the moving segment, translated by `t`, touches the stationary salvo's segment, computed exactly. Equivalently, it's the first point at which the stationary segment enters the swept rectangle, measured along the direction of travel.

**Table exit.** `exitT(start, dir, L)` is the smallest `t ∈ (0, L]` at which the point `start + t·dir` leaves the table rectangle `[0, W] × [0, H]` (strictly outside by more than `EPS`). If there's none, it's `null`.

### 2.6 Walking a path

`walkPath(ship, path)` expands a `PathStep[]` (state §9.1) into straight **legs**, carrying the running totals the checks need:

```ts
type Leg = {
  stepIndex: number
  start: Point
  heading: number
  length: number
  distanceBefore: number           // forward distance moved before this leg
}

type Walk = {
  legs: Leg[]
  turns: { stepIndex: number, degrees: number, sinceLastTurn: number }[]
  gravityTurns: { stepIndex: number, degrees: number, at: Point, headingBefore: number }[]   // state N68
  total: number                    // total forward distance
  end: { position: Point, heading: number }
}
```

Turns rotate in place at the stem; only `advance` steps produce legs. `sinceLastTurn` is the forward distance since the start of the move or since the previous turn. A `gravity_turn` rotates in place too, but goes in `gravityTurns`, not `turns`, and doesn't reset `sinceLastTurn`.

Path queries built on it:

| Query | Meaning |
|---|---|
| `bmContacts(ship, walk, exclude)` | Path distances, ascending, at which the swept base first touches each Blast Marker not in `exclude` |
| `touchesAnyBm(ship, walk)` | `walk.total > 0`, and the ship either starts in contact with a BM or `bmContacts(…, ∅)` is non-empty. Moving off a BM you start on counts (p. 201). |
| `exitDistance(ship, walk)` | Path distance at which the stem leaves the table, or `null`. |

### 2.7 Lines of fire and targeting

```
lineOfFireBlocked(shooter, target) =
  some hulk H ≠ shooter, H ≠ target has segmentTouchesCircle(shooter.position, target.position, H.position, baseRadius(H))
  or planetBlocks(shooter.position, target.position)                          // state §11, N65
```

`canEngage(ship, weapon, target)` is true when **all** of:

1. `distance ≤ weapon.range`;
2. `quadrantsOfPoint(ship, target.position)` intersects `weapon.arcs`;
3. the line of fire isn't blocked: for a ship target, `lineOfFireBlocked`; for ordnance, only `planetBlocks(ship.position, ordnance.position)` (hulks don't block shots at ordnance, planets do: transform T111).

**Nearest target, per weapon** (ruling V1):

```
nearestShipTargets(ship, weapon)     = among enemy ships with status "active" for which canEngage holds,
                                       those within EPS of the minimum distance
nearestOrdnanceTargets(ship, weapon) = the same over enemy torpedo salvoes and enemy attack craft waves not on CAP
                                       (distance to a wave is to its centre)
isNearest(ship, weapon, target)      = target ∈ the matching set above
```

Hulks are never "the nearest", so shooting at an enemy hulk always needs the priority test (p. 71). Ties all count as nearest; the shooter picks.

**Squadrons** (V15–V17):

```
squadronTarget(target)              = formation(squadronOf(target)) if target is in formation, else none
squadronEngageable(ship, weapon, sq) = the members of formation(sq) for which canEngage(ship, weapon, member) holds
isNearest(ship, weapon, target)      = for a squadron target: some member of formation(sq) is in nearestShipTargets(ship, weapon)
```

**Nova cannon line of fire** (transform T44):

```
novaLineBlocked(ship, aim) =
  some hulk H ≠ ship, !templateTouchesShip(aim, H, NOVA_RADIUS), has segmentTouchesCircle(ship.position, aim, H.position, baseRadius(H))
  or planetBlocks(ship.position, aim)
```

### 2.8 Deterministic maths

The engine promises that the same state and transform give a byte-identical result (state §1, principle 4) **on every platform**: Chrome, Firefox, Safari, Node. IEEE-754 guarantees that `+ − × ÷` and `sqrt` are correctly rounded, so they give the same answer everywhere. JavaScript's `Math.sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `hypot`, `pow`/`**`, `exp` and `log` are **implementation-approximated**, and can differ in the last bit between engines. Our positions come from trig, and a one-bit difference can flip a contact test that sits right at `EPS`, after which a replay diverges.

**Rule:** engine code (state, validator, reducer, geometry) may use only these:

| Allowed | Notes |
|---|---|
| `+ − × ÷ %`, unary `−` | IEEE-exact. JS never fuses multiply-add, so no FMA surprises. |
| `Math.sqrt`, `abs`, `floor`, `ceil`, `trunc`, `round`, `min`, `max`, `sign`, `imul` | Exact by specification |
| `dmath.*` | The engine's own deterministic functions, below |

Everything else in `Math` is **forbidden** in engine code. That's enforced by lint (`no-restricted-properties`) on the engine package. Distances use `Math.sqrt(dx*dx + dy*dy)`, not `Math.hypot`.

**`dmath`** is a small module of pure-software functions, ported from the FreeBSD/fdlibm implementations (as found in musl, or Rust's `libm` crate), so a future port can reproduce them bit for bit:

```
sinDeg(d), cosDeg(d)   // degrees in, exact at multiples of 90°
asinDeg(x)             // degrees out
atan2Deg(x, y)         // degrees out, our argument order (x first; 0° = +y)
```

**Degree-based argument reduction.** `sinDeg` / `cosDeg` first reduce `d` mod 360 (exact in floating point for our magnitudes), pick the octant, and convert only the remainder in `[−45°, 45°]` to radians for the polynomial kernel. So the cardinal headings are exact: `headingVector(0) = (0, 1)` exactly, not `(0, 1 − 1e-17)`. Cruiser Clash ships start on cardinal headings, so most early-game geometry stays exact.

**Verification.** `dmath` ships with a test table of inputs → expected bit patterns (hex), generated once from the reference implementation. The cross-browser conformance run (seeded game transcripts in Chromium, Firefox and WebKit via Playwright; see [ADR 0001](../docs/adr/0001-engine-language.md)) checks that whole games match bit for bit.

---

## 3. Gates (all transforms)

| # | Check | Code |
|---|---|---|
| G1 | `transform` is an object with a known `type`, a `player` of `"p1"`/`"p2"`, and exactly the payload fields that type defines, with the right JSON types. Numbers must be finite. | `MALFORMED` |
| G2 | `clock.stage ≠ "ended"` | `GAME_OVER` |
| G3 | If `pending` is non-empty, `type = "answer_brace"` | `PENDING_DECISION` |
| G4 | If `type = "answer_brace"`, `pending` is non-empty | `NO_PENDING_DECISION` |
| G5 | `player = actor(state)`. For `repair`, the rule is relaxed to "either player" (transform §4.6). | `NOT_YOUR_TURN` |
| G6 | The transform is allowed at the current `stage` / `setupStep` / `step` (transform §3) | `WRONG_MOMENT` |

`MALFORMED.details` includes the offending field path, e.g. `{ field: "path[2].degrees" }`. `WRONG_MOMENT.details` includes the current `stage`, `setupStep` and `step`.

---

## 4. Transform checks

Run after the gates, in the order listed. "Ship" means `ships.find(id = transform.shipId)`.

### 4.1 Setup

`roll_leadership`, `roll_zones`, `roll_setup`, `roll_deploy_order` and `roll_first_turn` have no checks beyond the gates. `choose_formation` has none either: G5 and G6 already make it Fleet Engagement and the right player's pick. Nor has `choose_facing`: G1 limits `heading` to 0, 90, 180 or 270, and G5–G6 make it The Raiders and the defender's choice.

**`choose_alert`** (G5–G6 make it Surprise Attack and the defender's)

| # | Check | Code |
|---|---|---|
| 1 | Each id names a unit of `player`'s (a ship in no squadron, or a squadron), none twice | `INVALID_ALERT` |
| 2 | `units.length = min(alertUnits, the player's units)` (state N77) | `INVALID_ALERT` |

`INVALID_ALERT.details` is `{ expected, units }`, `units` the ids the player could name.

**`choose_setup`**

| # | Check | Code |
|---|---|---|
| 1 | `{ map, colour }` is one of `setupOptions()` seen from `player`'s side (the map, with `player` taking `colour`) | `INVALID_SETUP` |

`INVALID_SETUP.details` is `{ options: { map, colour }[] }`.

**`deploy_ship`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status ≠ "reserve"`: reinforcements arrive during the battle (transform §4.2) | `IN_RESERVE` |
| 3a | `ship.status = "undeployed"` | `ALREADY_DEPLOYED` |
| 3b | `heading` is given exactly when the ship's divisions have no heading of their own (Surprise Attack's defender, transform T116), (a heading outside `[0, 360)` is `MALFORMED`) | `HEADING_REQUIRED`, `HEADING_NOT_ALLOWED` |
| 4 | `position` lies in one of `deploymentDivisions(player, ship)` (inclusive, `EPS`); the first in list order that holds it is the ship's division | `NOT_IN_ZONE` |
| 5 | If the player's undeployed ships (this one included) are no more than their empty divisions, this ship's division is empty (state N18) | `FILL_DIVISIONS_FIRST` |
| 6 | The new base doesn't overlap any deployed ship's base: `distance > r1 + r2 − EPS`. Touching is allowed. | `BASES_OVERLAP` |
| 6a | The Raiders: the stem is at least 20 cm (`approxGe`) from the stem of every deployed ship in another unit (state N59) | `TOO_CLOSE` |
| 6b | Surprise Attack, a ship on standby: `quadrantsOfPoint(position, heading, planet.position)` includes `left` or `right` (state N74) | `NOT_ABEAM` |
| 6c | Surprise Attack, a ship on standby when none of the player's is deployed yet: `distance(position, planet.position) ≤ diameter / 2 + 15` (`approxLe`, state N75) | `STANDBY_TOO_FAR` |
| 7 | If the player has a squadron with some members deployed and some not, the ship is one of its undeployed members (transform T80) | `SQUADRON_DEPLOYING` |
| 8 | A squadron member after the first goes in the first member's division | `SQUADRON_DIVISION` |
| 9 | … with its stem within `FORMATION_RANGE` (15 cm, inclusive) of a deployed member's stem | `NOT_IN_FORMATION` |

Check 5 doesn't apply in Surprise Attack (transform T116). For check 5, a squadron counts as one: "undeployed ships" counts single ships and squadrons with no member down, and a squadron's later members skip the check (they follow check 8).

**`choose_first_turn`**: gates only.

### 4.2 Movement

**`drift_hulk`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | Ship is a hulk | `NOT_A_HULK` |
| 4 | `turnState.ships[id].drifted = false` | `ALREADY_DRIFTED` |

**`declare_order`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 3a | `!onStandby(ship)` (transform T117) | `ON_STANDBY` |
| 3b | `!wentOnAlert(ship)` (transform T120) | `JUST_ALERTED` |
| 4 | `turnState.ships[id].moved = false` | `ALREADY_MOVED` |
| 5 | `activation = null` | `ACTIVATION_OPEN` |
| 6 | `turnState.commandCheckFailed = false` | `ORDERS_LOCKED` |
| 7 | `ship.specialOrder = null` | `ALREADY_ON_ORDERS` |
| 8 | `order ≠ "brace_for_impact"` (Brace only comes through `answer_brace`), and `order ≠ "come_to_new_heading"` when `profile.traits.noComeToNewHeading` (transform T73) | `INVALID_ORDER` |
| 9 | If `ramTargetId` is given: `order = "all_ahead_full"` and `meta.options.ramming` | `RAM_NOT_ALLOWED` |
| 10 | If `ramTargetId` is given: it names an enemy ship that's `onTable` (hulks allowed, transform D2) | `INVALID_RAM_TARGET` |
| 11 | If `reroll`: `rerollFor(ship)` exists (state §11) | `NO_REROLL` |
| 12 | If the ship's squadron is `turnState.squadronMove`'s: refused, it already has the squadron's order | `SQUADRON_ORDERED` |
| 13 | If `squadronMove` is set for another squadron: refused until that squadron has moved | `SQUADRON_MOVING` |

A ship in formation in a squadron declares for the squadron (transform T81): checks 6–7 and 11 apply to it, and the reducer applies the order to every member in formation.

**`release_cap`**

| # | Check | Code |
|---|---|---|
| 1 | The ordnance exists and is an attack craft wave | `UNKNOWN_ORDNANCE` |
| 2 | `owner = player` | `NOT_YOUR_ORDNANCE` |
| 3 | `cap ≠ null` | `NOT_ON_CAP` |
| 4 | `activation = null`, and no active-player ship has moved this turn other than grappled ones (transform §4.2) | `TOO_LATE_TO_RELEASE` |

**`arrive`**

| # | Check | Code |
|---|---|---|
| 1 | `placements` isn't empty and names no ship twice | `MALFORMED` |
| 2 | Each ship exists | `UNKNOWN_SHIP` |
| 3 | Each `ship.owner = player` | `NOT_YOUR_SHIP` |
| 4 | Each `ship.status = "reserve"` | `NOT_IN_RESERVE` |
| 5 | The ships are one unit: a single ship in no squadron, or every member of one squadron (transform T94) | `ARRIVE_ONE_UNIT` |
| 6 | `activation = null` | `ACTIVATION_OPEN` |
| 7 | `turnState.squadronMove = null` | `SQUADRON_MOVING` |
| 8 | `canArrive(player)` (state §11) | `NO_ENTRY_EDGE` |
| 9 | Each `position` lies on a segment of `entryEdges(player)`: within `EPS` of the segment (V2) | `NOT_ON_ENTRY_EDGE` |
| 10 | Each `heading` is in `[0, 360)` and faces into the table: `angleBetween(heading, inward) < 90 − EPS` for the inward heading of every table edge the stem is within `EPS` of (transform T96) | `NOT_FACING_IN` |
| 10a | Surprise Attack, the first arrival (`entryEdge` null): every stem is on the edge `arrivalEdge(placements[0])` (state N76, transform T119) | `ONE_ENTRY_EDGE` |
| 11 | A squadron's stems form one chain: each within `FORMATION_RANGE` (inclusive) of another's | `NOT_IN_FORMATION` |
| 12 | No new base overlaps another new base or any base on the table: `distance > r1 + r2 − EPS` (V5) | `BASES_OVERLAP` |

`NOT_ON_ENTRY_EDGE.details` and `NO_ENTRY_EDGE.details` are `{ edges: entryEdges(player) }`; the others name the `shipId`.

**`move`**

First, identify the move:

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 3a | `!onStandby(ship)` (transform T117) | `ON_STANDBY` |
| 4 | `turnState.ships[id].moved = false` | `ALREADY_MOVED` |
| 5 | `activation = null`, or `activation.stage = "ordered"` with `activation.shipId = shipId` | `ACTIVATION_OPEN` |
| 5a | If `squadronMove` is set: the ship is one of its `members` | `SQUADRON_MOVING` |
| 5b | If the ship's squadron is `disengaging`: the path leaves the table, or `disengage` is true | `MUST_DISENGAGE` |
| 5c | In an escort squadron's move with `squadronMove.disengage ≠ null`, while the squadron isn't `disengaging`: `disengage` equals it, unless the path leaves the table | `SQUADRON_DISENGAGE` |

Then work out the move's parameters, the same way the reducer does:

```
order        = activation?.order ?? squadronMove?.order ?? null   // a squadron member moves on the squadron's order
baseSpeed    = speed(ship)                                      // state §11
D0           = baseSpeed + (activation?.aafExtra ?? squadronMove?.aafExtra ?? 0)   // unslowed maximum
minDistance  = order = burn_retros ? 0 : baseSpeed / 2
maxIfBR      = order = burn_retros ? baseSpeed / 2 : D0
turnsAllowed = has(engine_room) ? 0
             : order ∈ {all_ahead_full, lock_on} ? 0
             : order = come_to_new_heading ? 2 : 1
turnDist     = TURN_DISTANCE[ship.profile.type]
walk         = walkPath(ship, path)
exit         = exitDistance(ship, walk)
slowed       = touchesAnyBm(ship, walk)
D            = maxIfBR − (slowed ? BM_SLOWDOWN : 0)
```

Burn Retros moves "zero to half speed", so its maximum is `baseSpeed / 2`. Distances aren't rounded; "half" is exact.

Then check the path:

| # | Check | Code |
|---|---|---|
| 6 | Every `advance.distance > 0` and every `turn.degrees ≠ 0` and `gravity_turn.degrees ≠ 0` | `INVALID_PATH_STEP` |
| 6a | Each gravity turn (state N68, transform T108–T109): it's the first step or the last, at most one of each and only one without an advance; its stem is in a gravity well, `gravityWellAt(at)`; and with `delta` the signed angle from `headingBefore` to `tableBearing(at, planet.position)` (in −180…180), `degrees` has `delta`'s sign (either sign when `|delta| = 180`) and `|degrees| ≤ min(45, |delta|) + EPS` | `INVALID_GRAVITY_TURN` |
| 7 | Every `|turn.degrees| ≤ ship.profile.turns` | `TURN_TOO_SHARP` |
| 8 | Number of turns ≤ `turnsAllowed` | `TOO_MANY_TURNS` |
| 9 | Each turn has `sinceLastTurn ≥ turnDist`. Exception: under Burn Retros, a turn with `sinceLastTurn = 0` is fine. | `TURN_TOO_EARLY` |
| 10 | If `exit ≠ null`: the exit happens in the **last** step, which is an `advance` | `PATH_CONTINUES_OFF_TABLE` |
| 11 | If `exit ≠ null`: `disengage = false` | `ALREADY_LEAVING_TABLE` |
| 12 | `walk.total ≤ D`. For All Ahead Full, see 14. | `PATH_TOO_LONG` |
| 13 | Unless `exit ≠ null`: `walk.total ≥ min(minDistance, D′)`, where `D′` is `D`, or `maxIfBR − BM_SLOWDOWN` when the ship starts in contact with a BM (V12). A ship that can't make half speed must go as far as it can (p. 53). A ship whose stem starts in a gravity well has no minimum (high orbit, state N69). | `PATH_TOO_SHORT` |
| 14 | **All Ahead Full only.** `walk.total ≈ aafEnd` (below), or the path leaves the table at or before `aafEnd`. `aafEnd` is measured along the heading after any first gravity turn. | `MUST_STOP_AT_BLAST_MARKER` if `aafEnd` is a BM stop, else `MUST_MOVE_FULL_DISTANCE` |
| 15 | If `boardTargetId` is given: `meta.options.boarding` | `BOARDING_OFF` |
| 16 | … it names an enemy ship that is `active` (not a hulk, transform T9) and `canBeBoarded` (not on the Mark of Nurgle, T62) | `INVALID_BOARDING_TARGET` |
| 17 | … the target isn't grappled (T9) | `TARGET_GRAPPLED` |
| 18 | … `exit = null` and `disengage = false` | `CANNOT_BOARD_AND_LEAVE` |
| 19 | … the bases touch at the path's end: `basesTouch` with the ship at `walk.end` (inclusive; overlap counts, V7) | `NOT_IN_CONTACT` |
| 20 | If `reroll`: `disengage` is true and `rerollFor(ship)` exists | `NO_REROLL` |

Check 14 replaces 12 and 13 for AAF. An AAF path has no turns (check 8), so it's one straight line. `aafEnd` is computed along that line out to `D0`, whatever the path's own length:

```
line     = walkPath(ship, [{ kind: "advance", distance: D0 }])
contacts = bmContacts(ship, line, bmsInContact(ship))     // new BMs only
slowed   = bmsInContact(ship) non-empty  or  (contacts non-empty and contacts[0] < D0 − BM_SLOWDOWN)
D        = D0 − (slowed ? BM_SLOWDOWN : 0)
stop     = first c in contacts with D − BM_SLOWDOWN ≤ c ≤ D
aafEnd   = stop ?? D
```

In words:
- A new Blast Marker met within the last 5 cm stops the ship on contact. The stop takes precedence over the slowdown, so the −5 cm doesn't apply as well.
- An earlier contact, or starting in contact with a BM, slows the ship by 5 cm. It must then cover exactly `D0 − 5`, unless it meets another BM in its new last 5 cm.

The details for `TURN_TOO_EARLY` are `{ stepIndex, sinceLastTurn, required }`; for `PATH_TOO_LONG` / `PATH_TOO_SHORT` they're `{ total, limit, slowed }`.

Rams and torpedo contacts don't affect legality. The reducer resolves them as the path executes (transform §4.2). If one of them truncates the move, a boarding declaration lapses (transform T8): that's an outcome, not a validation error.

`NOT_IN_CONTACT.details` is `{ distance, needed }`: the stem-to-stem distance at the path's end, and the sum of the two base radii.

Grappled ships never reach the `declare_order` or `move` checks: they're marked `moved` on entering `move_ships` (state §6), so they fail check 4 with `ALREADY_MOVED`.

### 4.3 Shooting

**`fire`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 4 | `turnState.ships[id].disengage ≠ "failed"` | `DISENGAGE_FAILED` |
| 5 | `ship.grapple = null` (drawn combats, pp. 90–91) | `GRAPPLED` |
| 6 | `turnState.ships[id].boardingDeclared = null` (p. 89) | `BOARDING_SHIP` |
| 6a | `!onStandby(ship)` (transform T117) | `ON_STANDBY` |
| 7 | Weapon exists on the profile | `UNKNOWN_WEAPON` |
| 8 | `weapon.kind ∈ {battery, lance}` | `WRONG_WEAPON_KIND` |
| 9 | Weapon not in `weaponsFired` | `WEAPON_ALREADY_FIRED` |
| 10 | Weapon not disabled (state §11 `weaponDisabled`) | `WEAPON_DISABLED` |
| 11 | Target exists: a ship id for `kind: "ship"`, a salvo id for `kind: "ordnance"` | `UNKNOWN_TARGET` |
| 12 | Target is the enemy's. A ship target must be `onTable` (so friendly hulks are out). An attack craft target must not be on CAP (T27). | `INVALID_TARGET` |
| 13 | `distance(ship, target) ≤ weapon.range` | `OUT_OF_RANGE` |
| 14 | Let `Q = quadrantsOfPoint(ship, target.position) ∩ weapon.arcs`. `Q` is non-empty. | `OUT_OF_ARC` |
| 15 | If `|quadrantsOfPoint(ship, target.position)| > 1` and `|Q| > 1`, `arc` is supplied | `ARC_CHOICE_REQUIRED` |
| 16 | If `arc` is supplied, `arc ∈ Q` | `INVALID_ARC_CHOICE` |
| 17 | Ship targets only: if `|quadrantsOfPoint(target, ship.position)| > 1`, `aspect` is supplied | `ASPECT_CHOICE_REQUIRED` |
| 18 | If `aspect` is supplied, it's in `quadrantsOfPoint(target, ship.position)`. Ordnance targets must not supply it. | `INVALID_ASPECT_CHOICE` |
| 19 | Ship targets only: `!lineOfFireBlocked(ship, target)` | `LINE_OF_FIRE_BLOCKED` |
| 20 | If `priorityTest = "failed"`: `isNearest(ship, weapon, target)` | `MUST_TARGET_NEAREST` |
| 21 | If `combineWith` is given: `weapon.kind = "battery"`, and its ids are distinct and don't include `weaponId` | `INVALID_VOLLEY` |
| 22 | … each id names a weapon on the profile, of kind `battery` | `UNKNOWN_WEAPON` / `WRONG_WEAPON_KIND` |
| 23 | … each is not in `weaponsFired` and not disabled | `WEAPON_ALREADY_FIRED` / `WEAPON_DISABLED` |
| 24 | … the target is within each one's range and in one of its arcs | `OUT_OF_RANGE` / `OUT_OF_ARC` |
| 25 | … if `priorityTest = "failed"`: the target is nearest for each one | `MUST_TARGET_NEAREST` |
| 26 | If `reroll`: `rerollFor(ship)` exists | `NO_REROLL` |
| 27 | If `withShips` is given: the shooter is in formation in a squadron, and the target is a ship | `INVALID_SQUADRON_FIRE` |
| 28 | … each entry names another member in formation of that squadron, once | `INVALID_SQUADRON_FIRE` |
| 29 | … each such ship passes checks 3–6 | `SHIP_NOT_ACTIVE` / `DISENGAGE_FAILED` / `GRAPPLED` / `BOARDING_SHIP` |
| 30 | … each weapon id is on that ship's profile, once, and of the volley's kind (`battery` with a battery `weaponId`, `lance` with a lance) | `UNKNOWN_WEAPON` / `WRONG_WEAPON_KIND` |
| 31 | … each is not in that ship's `weaponsFired` and not disabled | `WEAPON_ALREADY_FIRED` / `WEAPON_DISABLED` |
| 32 | … the target can be engaged by each (for a squadron target, some member in formation, V15) | `OUT_OF_RANGE` / `OUT_OF_ARC` |
| 33 | … if `priorityTest = "failed"`: the target is nearest for each | `MUST_TARGET_NEAREST` |
| 34 | If `targetAspect` is given: the target is a squadron target (V15) | `INVALID_TARGET_ASPECT` |
| 35 | … it's the aspect (closing, moving away, abeam; the easier one on a boundary, V16) of at least one member that took fire from the volley (V17) | `INVALID_TARGET_ASPECT` |

**Squadron targets** (V15): when the target ship is in formation in a squadron, checks 13–20 and 24–25 are taken against the squadron instead of the named ship. Range and arc pass if `squadronEngageable` is non-empty for the weapon; `arc` and `aspect` choices aren't asked for (V16); line of fire is per member, inside `squadronEngageable`; and check 20 passes if any member in formation is nearest.

Check 15 only demands a choice when it makes a difference. A target on the front/right boundary of a weapon that only fires right doesn't need `arc`: `Q = {right}`.

**`fire_nova_cannon`**

| # | Check | Code |
|---|---|---|
| 1–6a | As `fire` 1–6a | as `fire` |
| 7 | Weapon exists on the profile | `UNKNOWN_WEAPON` |
| 8 | `weapon.kind = "nova_cannon"` | `WRONG_WEAPON_KIND` |
| 9 | Weapon not in `weaponsFired` | `WEAPON_ALREADY_FIRED` |
| 10 | Weapon not disabled | `WEAPON_DISABLED` |
| 11 | `novaCannonBarred(ship) = null` (state §11) | `NOVA_CANNON_BARRED` |
| 12 | `aim` is on the table: `0 ≤ x ≤ W`, `0 ≤ y ≤ H` | `AIM_OFF_TABLE` |
| 13 | `quadrantsOfPoint(ship, aim) ∩ weapon.arcs` is non-empty | `OUT_OF_ARC` |
| 14 | `approxGe(novaRange, weapon.minRange)` and `approxLe(novaRange, weapon.range)` | `OUT_OF_RANGE` |
| 15 | `!novaLineBlocked(ship, aim)` | `LINE_OF_FIRE_BLOCKED` |

`NOVA_CANNON_BARRED.details` is `{ why: "crippled" | "order", order? }`. `OUT_OF_RANGE.details` here is `{ range, min, max }`. There's no `arc` choice: nothing depends on which side of a boundary the aim is (V10). There's no target priority check (state N14). `fire` with a nova cannon's id fails check 8 with `WRONG_WEAPON_KIND`, and so does `fire_nova_cannon` with a battery's.

**`launch_torpedoes`**

| # | Check | Code |
|---|---|---|
| 1–6a | As `fire` 1–6a | as `fire` |
| 7 | Weapon exists | `UNKNOWN_WEAPON` |
| 8 | `weapon.kind = "torpedoes"` | `WRONG_WEAPON_KIND` |
| 9 | Weapon not in `weaponsFired` | `WEAPON_ALREADY_FIRED` |
| 10 | Weapon not disabled | `WEAPON_DISABLED` |
| 11 | `ship.loaded.torpedoes = true` | `NOT_LOADED` |
| 12 | `0 ≤ bearing < 360` and `quadrantsOf(bearing) ∩ weapon.arcs ≠ ∅` | `BEARING_OUT_OF_ARC` |

**`launch_attack_craft`**

| # | Check | Code |
|---|---|---|
| 1–6a | As `fire` 1–6a | as `fire` |
| 7 | The ship has at least one `launch_bay` weapon | `NO_LAUNCH_BAYS` |
| 8 | `ship.loaded.launchBays = true` | `NOT_LOADED` |
| 9 | `waves` is non-empty, and no wave is empty | `EMPTY_WAVE` |
| 10 | Every role is one the ship's bays carry | `CRAFT_NOT_CARRIED` |
| 11 | A wave with `cap: true` holds only fighters | `CAP_NOT_FIGHTERS` |
| 12 | Total squadrons ≤ `launchCapacity(ship)` | `TOO_MANY_SQUADRONS` |
| 13 | Every `recall` id is one of the player's attack craft waves, not on CAP, named once | `INVALID_RECALL` |
| 14 | `craftInPlay − recalled squadrons + launched squadrons ≤ fleetBays(player)` | `FLEET_LIMIT` |

`TOO_MANY_SQUADRONS.details` is `{ launching, capacity }`; `FLEET_LIMIT.details` is `{ inPlay, recalled, launching, limit }`.

**`end_step`**: G6 already limits it to `move_ships`, `direct_fire`, `launch_ordnance` and `boarding`. In `boarding`, one check:

| # | Check | Code |
|---|---|---|
| 1 | `boardingsToFight(state)` is empty (transform §4.6): declared boarding actions must be fought | `BOARDING_UNRESOLVED` |

In `move_ships` (transform T95):

| # | Check | Code |
|---|---|---|
| 1 | `canArrive(player)`: the step is only held open for reserves | `NO_ENTRY_EDGE` |
| 1a | `reservesMayWait(player)`: The Raiders' raiders all arrive now (transform T104) | `RESERVES_MUST_ARRIVE` |
| 2 | `activation = null` | `ACTIVATION_OPEN` |
| 3 | `turnState.squadronMove = null` | `SQUADRON_MOVING` |
| 4 | Every `active` ship of the player's has `moved` | `SHIPS_TO_MOVE` |

`SHIPS_TO_MOVE.details` is `{ shipIds }`, the ships still to move.

### 4.4 Ordnance

**`move_ordnance`**

| # | Check | Code |
|---|---|---|
| 1 | The ordnance exists | `UNKNOWN_ORDNANCE` |
| 2 | `owner = player` | `NOT_YOUR_ORDNANCE` |
| 3 | Not in `turnState.ordnanceMoved` | `ORDNANCE_ALREADY_MOVED` |
| 4 | A torpedo salvo has no `path` and no `cap`; an attack craft wave has a `path` | `WRONG_ORDNANCE_MOVE` |
| 5 | A CAP fighter moves only in `inactive_ordnance` (transform §4.4) | `ON_CAP` |
| 6 | The path's total length (from the wave's position through every waypoint) ≤ the wave's speed | `PATH_TOO_LONG` |
| 7 | Every waypoint is on the table | `PATH_OFF_TABLE` |
| 8 | If `cap`: the wave is all fighters | `CAP_NOT_FIGHTERS` |
| 9 | If `cap`: it names a friendly ship that's `active` | `INVALID_CAP_SHIP` |
| 10 | If `cap`: at the path's end, the wave's footprint touches that ship's base | `NOT_IN_CONTACT` |

`PATH_TOO_LONG.details` is `{ total, limit }`, as for ship moves. The path isn't checked for the contacts it will meet: those are outcomes, resolved by the reducer as the wave flies (V8).

### 4.5 Brace

**`answer_brace`**

| # | Check | Code |
|---|---|---|
| 1 | `pendingId` = id of the **top** pending entry | `NOT_TOP_PENDING` |
| 2 | If `reroll`: `attempt` is true and `rerollFor(the bracing ship)` exists | `NO_REROLL` |

(G5 already made sure `player` is that entry's player.)

### 4.6 End Phase

**`board`**

| # | Check | Code |
|---|---|---|
| 1 | Target exists | `UNKNOWN_TARGET` |
| 2 | `boardingsToFight(state)` has a group for the target (transform §4.6) | `NO_BOARDING_DECLARED` |
| 3 | `priority` is exactly that group's ship ids: no extras, no duplicates, none missing | `INVALID_PRIORITY` |

**`teleport`**

| # | Check | Code |
|---|---|---|
| 1–3 | As `fire` 1–3 | as `fire` |
| 4 | `turnState.ships[id].disengage ≠ "failed"` | `DISENGAGE_FAILED` |
| 5 | `ship.grapple = null` (T13) | `GRAPPLED` |
| 6 | `turnState.ships[id].boardingDeclared = null` (T13) | `BOARDING_SHIP` |
| 7 | `turnState.ships[id].teleported = false` | `ALREADY_TELEPORTED` |
| 8 | `ship.profile.type ≠ "escort"`, `!isCrippled(ship)`, and `ship.specialOrder` is null, Lock On or Reload Ordnance (R#7) | `CANNOT_TELEPORT` |
| 9 | Target exists | `UNKNOWN_TARGET` |
| 10 | Target is an enemy ship that is `active` | `INVALID_TARGET` |
| 11 | `shieldsDown(target)` (state §11) | `SHIELDS_UP` |
| 12 | `distance(ship, target) ≤ TELEPORT_RANGE` (10 cm, stem to stem, T14) | `OUT_OF_RANGE` |
| 13 | `remainingHits(target) ≤ remainingHits(ship)` | `TARGET_TOO_LARGE` |

`CANNOT_TELEPORT.details` is `{ reason: "escort" | "crippled" | "orders" }`, the first that applies.

**`repair`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 4 | `turnState.ships[id].repaired = false` | `ALREADY_REPAIRED` |
| 5 | The ship has ≥ 1 repairable critical | `NOTHING_TO_REPAIR` |
| 6 | `priority` is exactly the set of the ship's repairable critical ids: no extras, no duplicates, none missing | `INVALID_PRIORITY` |

**`remove_blast_markers`**

| # | Check | Code |
|---|---|---|
| 1 | `priority` is exactly the set of removable Blast Marker ids (not touching any on-table ship's base) | `INVALID_PRIORITY` |

`INVALID_PRIORITY.details` is `{ missing: string[], unexpected: string[], duplicates: string[] }`.

---

## 5. Reason codes

| Code | Meaning |
|---|---|
| `MALFORMED` | Not a well-formed transform |
| `GAME_OVER` | The game has ended |
| `PENDING_DECISION` | A brace decision must be answered first |
| `NO_PENDING_DECISION` | `answer_brace` with nothing pending |
| `NOT_TOP_PENDING` | `answer_brace` for an entry that isn't on top |
| `NOT_YOUR_TURN` | `player` isn't the one being asked to act |
| `WRONG_MOMENT` | Transform not allowed in the current stage / step |
| `UNKNOWN_SHIP` / `UNKNOWN_WEAPON` / `UNKNOWN_TARGET` / `UNKNOWN_ORDNANCE` | Id doesn't resolve |
| `NOT_YOUR_SHIP` / `NOT_YOUR_ORDNANCE` | Belongs to the other player |
| `SHIP_NOT_ACTIVE` | Ship is a hulk, undeployed, destroyed or disengaged |
| `ALREADY_DEPLOYED` | Ship is already on the table |
| `IN_RESERVE` | `deploy_ship` with a reinforcement: it arrives during the battle |
| `NOT_IN_RESERVE` | `arrive` with a ship that isn't waiting in reserve |
| `ARRIVE_ONE_UNIT` | `arrive` with more than one ship outside a squadron, or only part of a squadron |
| `NO_ENTRY_EDGE` | No reserves can arrive now: none left, or no entry edge this turn |
| `NOT_ON_ENTRY_EDGE` | An arriving stem isn't on an entry edge |
| `NOT_FACING_IN` | An arriving ship doesn't face into the table |
| `SHIPS_TO_MOVE` | `end_step` in `move_ships` before every ship on the table has moved |
| `INVALID_GRAVITY_TURN` | A gravity turn that isn't first or last, isn't in a gravity well, turns away from the planet or past it, or turns more than 45° |
| `TOO_CLOSE` | The Raiders: a deployed ship within 20 cm of a ship of another unit |
| `INVALID_ALERT` | Surprise Attack: `choose_alert` names the wrong units, or the wrong number |
| `HEADING_REQUIRED` | Surprise Attack: the defender's `deploy_ship` without a heading |
| `HEADING_NOT_ALLOWED` | `deploy_ship` with a heading where the division sets it |
| `NOT_ABEAM` | Surprise Attack: a ship on standby without the planet in its port or starboard arc |
| `STANDBY_TOO_FAR` | Surprise Attack: the first ship on standby more than 15 cm from the planet |
| `ON_STANDBY` | Surprise Attack: a ship on standby can't move, fire, launch or take a special order |
| `JUST_ALERTED` | Surprise Attack: no special orders the turn a ship goes on alert |
| `ONE_ENTRY_EDGE` | Surprise Attack: an arriving unit facing in from a different edge |
| `RESERVES_MUST_ARRIVE` | The Raiders: `end_step` while raiders are still off the table |
| `FILL_DIVISIONS_FIRST` | Fleet Engagement: a division still needs a ship before this one gets another (p. 142) |
| `INVALID_SETUP` | `choose_setup` with a set-up the formations don't offer |
| `NOT_IN_ZONE` | Deployment position outside the player's zone |
| `BASES_OVERLAP` | Deployment position overlaps another ship's base |
| `SQUADRON_DEPLOYING` | A squadron is part-deployed; its members go first |
| `SQUADRON_DIVISION` | A squadron member must go in its squadron's division |
| `NOT_IN_FORMATION` | A squadron member must be deployed within 15 cm of one already down |
| `NOT_A_HULK` / `ALREADY_DRIFTED` | `drift_hulk` on a non-hulk, or a second time |
| `ALREADY_MOVED` | Ship has finished its move this turn |
| `ACTIVATION_OPEN` | Another ship has declared an order and hasn't moved yet |
| `ORDERS_LOCKED` | Fleet failed a Command check this turn |
| `ALREADY_ON_ORDERS` | Ship has a live order (usually last turn's Brace) |
| `SQUADRON_ORDERED` | The ship's squadron has already begun moving, on its own order |
| `SQUADRON_MOVING` | Another squadron is part-way through its move |
| `MUST_DISENGAGE` | An escort of a disengaging squadron must attempt to disengage or leave the table |
| `SQUADRON_DISENGAGE` | An escort squadron's members must all ask for the disengage test, or none |
| `INVALID_ORDER` | Brace declared directly, or Come to New Heading on a ship that can't use it |
| `RAM_NOT_ALLOWED` / `INVALID_RAM_TARGET` | Ram without AAF / with ramming off / at an invalid ship |
| `INVALID_PATH_STEP` | Zero or negative advance, zero turn |
| `TURN_TOO_SHARP` / `TOO_MANY_TURNS` / `TURN_TOO_EARLY` | Turning rules (p. 54) |
| `PATH_TOO_LONG` / `PATH_TOO_SHORT` | Distance limits |
| `MUST_MOVE_FULL_DISTANCE` / `MUST_STOP_AT_BLAST_MARKER` | All Ahead Full distance rules |
| `PATH_CONTINUES_OFF_TABLE` | Steps after the ship leaves the table |
| `ALREADY_LEAVING_TABLE` | Disengage test requested on a move that leaves the table anyway |
| `DISENGAGE_FAILED` | Failed disengage: can't fire or launch this turn |
| `WRONG_WEAPON_KIND` | `fire` with torpedoes, or `launch_torpedoes` with a gun |
| `WEAPON_ALREADY_FIRED` / `WEAPON_DISABLED` / `NOT_LOADED` | Weapon unavailable |
| `INVALID_TARGET` | Friendly, off-table, or a friendly hulk |
| `OUT_OF_RANGE` / `OUT_OF_ARC` | Range and arc |
| `ARC_CHOICE_REQUIRED` / `INVALID_ARC_CHOICE` | Target on an arc boundary |
| `ASPECT_CHOICE_REQUIRED` / `INVALID_ASPECT_CHOICE` | Shooter on the target's quadrant boundary |
| `LINE_OF_FIRE_BLOCKED` | A hulk or a planet is in the way |
| `MUST_TARGET_NEAREST` | Priority test failed; only the nearest target is allowed |
| `INVALID_TARGET_ASPECT` | `targetAspect` on a single ship, or an aspect no reachable member shows |
| `INVALID_SQUADRON_FIRE` | `withShips` from a ship not in formation, or naming ships outside its squadron's formation |
| `BEARING_OUT_OF_ARC` | Torpedo launch bearing outside the launcher's arc |
| `ORDNANCE_ALREADY_MOVED` | Salvo already moved this step |
| `ALREADY_REPAIRED` / `NOTHING_TO_REPAIR` | Damage control |
| `INVALID_PRIORITY` | Priority list isn't exactly the required set |
| `BOARDING_OFF` | Boarding declared with `options.boarding` off |
| `INVALID_BOARDING_TARGET` / `TARGET_GRAPPLED` | Boarding a friend, a hulk, or a ship already in a grapple |
| `CANNOT_BOARD_AND_LEAVE` | Boarding declared on a move that leaves the table or asks to disengage |
| `NOT_IN_CONTACT` | The path doesn't end with the bases touching |
| `GRAPPLED` | The ship is locked in a grapple: it can't fire, launch or teleport |
| `BOARDING_SHIP` | The ship declared a boarding action this turn: it can't fire, launch or teleport |
| `NO_BOARDING_DECLARED` | `board` against a ship nobody is boarding (or whose boarding has lapsed) |
| `BOARDING_UNRESOLVED` | `end_step` while a declared boarding action is still to be fought |
| `ALREADY_TELEPORTED` / `CANNOT_TELEPORT` | One teleport per ship per turn; escorts, crippled ships and ships on other orders can't |
| `SHIELDS_UP` / `TARGET_TOO_LARGE` | Teleport target still has shields, or more hits left than the attacker |
| `NO_REROLL` | `reroll` asked for with no fleet commander re-roll for that ship, or no test to re-roll |
| `INVALID_VOLLEY` | `combineWith` on a lance, naming a weapon twice, or naming the main weapon |
| `NOVA_CANNON_BARRED` | The ship is crippled, or on All Ahead Full, Come To New Heading, Burn Retros or Brace For Impact! (p. 64) |
| `AIM_OFF_TABLE` | A nova cannon aimed with its template's centre off the table |
| `NO_LAUNCH_BAYS` | `launch_attack_craft` from a ship without launch bays |
| `EMPTY_WAVE` / `CRAFT_NOT_CARRIED` | A launch with an empty wave, or a craft role the ship's bays don't carry |
| `TOO_MANY_SQUADRONS` / `FLEET_LIMIT` | More squadrons than the ship's bays, or than the fleet's ordnance limit (p. 73) |
| `INVALID_RECALL` | Recalling something that isn't one of your free-flying attack craft waves |
| `CAP_NOT_FIGHTERS` / `INVALID_CAP_SHIP` | Only fighters fly CAP, and only for a friendly active ship |
| `NOT_ON_CAP` / `ON_CAP` / `TOO_LATE_TO_RELEASE` | CAP release and movement rules (p. 82) |
| `WRONG_ORDNANCE_MOVE` | A path for torpedoes, or none for attack craft |
| `PATH_OFF_TABLE` | An attack craft waypoint off the table |

---

## 6. Examples

All from the round-1 state in state §14: Agrippa at `(85, 15)` heading 0, Unclean at `(100, 105)` heading 180, p2 (Unclean) to move first.

**Wrong player.**
```json
{ "type": "move", "player": "p1", "shipId": "ship-1", "path": [{ "kind": "advance", "distance": 20 }], "disengage": false }
```
→ `{ code: "NOT_YOUR_TURN", details: { expected: "p2" } }`

**Turning too early.** Unclean, no orders:
```json
{ "type": "move", "player": "p2", "shipId": "ship-2",
  "path": [{ "kind": "advance", "distance": 5 }, { "kind": "turn", "degrees": 45 }, { "kind": "advance", "distance": 15 }],
  "disengage": false }
```
→ `{ code: "TURN_TOO_EARLY", details: { stepIndex: 1, sinceLastTurn: 5, required: 10 } }`

**Too slow.** Unclean (speed 25), no orders, `advance 10`:
→ `{ code: "PATH_TOO_SHORT", details: { total: 10, limit: 12.5, slowed: false } }`

**Legal.** Unclean `advance 12.5, turn −45, advance 12.5`: two legs of 12.5 cm, one 45° port turn after 12.5 cm ≥ 10. → `{ ok: true }`

**Out of arc.** Later, Unclean at `(100, 60)` heading 180 fires its port battery at Agrippa at `(85, 35)`. The table bearing from Unclean to Agrippa is `atan2deg(−15, −25) ≈ 211°`; relative to heading 180 that's ≈ 31°, which is **front**. The port battery fires `left` only → `OUT_OF_ARC`. The prow lances (front, 60 cm, range ≈ 29 cm) can take that shot.

---

## 7. Rulings introduced here

| # | Ruling |
|---|---|
| V1 | **Nearest target is per weapon.** It's the nearest enemy that *this weapon* could legally engage (range, arc, line of fire). A ship can fire its broadside at the only ship in that arc without a test, even if a closer enemy sits off its other beam. That matches p. 60: "other weapons may fire at other targets, provided the closest enemy is shot at as a priority." |
| V2 | **Contact is inclusive**: touching within `EPS` counts, for bases, Blast Markers, torpedoes and lines of fire. |
| V3 | **Burn Retros' maximum is half speed**, with no rounding. The turn-without-moving exemption only applies when `sinceLastTurn = 0`. |
| V4 | **All Ahead Full meeting a BM within its last 5 cm** stops on contact, and the 5 cm slowdown is not applied on top. |
| V5 | **No overlapping bases at deployment.** Bases may touch but not overlap. Overlap during play is still legal (p. 57). |
| V6 | **Deterministic maths.** Engine code uses only IEEE-exact operations and the `dmath` module; platform trig is forbidden (§2.8). |
| V7 | **Boarding contact is `basesTouch`** at the end of the path: inclusive, and overlapping bases count (overlap is legal in play, V5). |
| V9 | **`arc` belongs to the main weapon.** A combined battery only needs the target in one of its own arcs; on a boundary it doesn't ask which, because the volley shares one column either way. |
| V10 | **A nova cannon's aim is in arc** if `quadrantsOfPoint` meets the weapon's arcs, boundaries included; there's nothing for an `arc` choice to decide. |
| V11 | **The nova cannon's range is checked to the template's near edge** with the usual tolerance, both ends: 30 cm and 150 cm both count. |
| V12 | **A ship starting on a Blast Marker** has its minimum capped by the slowed limit even for a path that doesn't move: any move it makes is slowed (p. 69), so a ship whose speed the slowdown takes to 0 stays put legally instead of having no legal move. |
| V13 | **A division is empty** when none of the player's deployed ships has its stem in it (by the same first-in-list rule as check 4). `FILL_DIVISIONS_FIRST.details` is `{ empty: divisionIndexes }`. |
| V14 | **`reroll` is checked against the re-rolls available now**, not against whether the test will fail: the flag says what to do if it does (transform §2.7). `fire.reroll` is accepted even when no priority test will be taken; it then spends nothing. |
| V15 | **A squadron target is its formation**, whichever member is named (transform T83). The named member doesn't itself need to be in range or arc. |
| V16 | **No arc or aspect choices against a squadron.** A member on an arc boundary is in arc if either quadrant is one of the weapon's arcs, and a member on a quadrant boundary shows the shooter the easier of its two aspects. The choice that matters is `targetAspect`. |
| V17 | **A member "took fire" if any weapon in the volley can engage it** (p. 97): `squadronEngageable` over the whole volley. The dice are pooled, as the book adds firepower together, so any hit can go to any member that took fire (reducer §4.5). |
| V18 | **Squadron moves are checked against the squadron's order**: a member's limits come from `squadronMove` when the activation hasn't been opened for it. |
| V19 | **An arrival is checked as a whole**: every placement passes or the transform fails; there's no partial arrival. |
| V20 | **Entry edges are inclusive at their ends** (V2): a stem exactly at the corner of an open long-edge segment and the east edge is on both, and must face in from both (transform T96). |
| V21 | **`deploy_ship` with a reserve** says why (`IN_RESERVE`) rather than `ALREADY_DEPLOYED`: the ship isn't on the table, it's waiting. |
| V22 | **`TOO_CLOSE.details`** is `{ shipId }`, the nearest ship it's too close to. Squadron-mates are exempt: they follow the 15 cm formation rule. |
| V23 | **`RESERVES_MUST_ARRIVE`** comes after `NO_ENTRY_EDGE`: when reserves can't arrive at all, the step isn't being held for them. |
| V24 | **A planet's template blocks a line that passes closer than its radius** (less `EPS`) to its centre; a line that only grazes the edge isn't blocked, and a line with an end on the template isn't blocked by that planet (state N65). |
| V25 | **`INVALID_GRAVITY_TURN.details`** is `{ stepIndex, reason }`, with `reason` one of `"position"`, `"not_in_well"`, `"direction"`, `"too_sharp"`. |
| V26 | **A gravity turn's legality uses the planned pose**: the stem and heading where the path puts it. The reducer re-checks it when the step is reached and skips it if a contact stopped the ship short (transform §4.2). |
| V27 | **High orbit waives the minimum only** (state N69): a ship in a well still can't exceed its maximum, and All Ahead Full still moves its full distance. |
| V28 | **`ON_STANDBY` comes before `ALREADY_MOVED`**: a standby ship is marked `moved` (transform T117), and "on standby" is the reason. |
| V29 | **Abeam is inclusive**: a planet's centre exactly on the boundary between the front and starboard arcs is abeam, as it would be in both arcs for firing (V2). |
| V30 | **`STANDBY_TOO_FAR` only binds the first ship on standby** (state N75): once one is down, the rest go anywhere abeam. |
| V31 | **`ONE_ENTRY_EDGE.details`** is `{ entryEdge: null }`: it's only checked on the first arrival. With `entryEdge` set, check 9 already holds the stems to that edge. |
| V8 | **An attack craft path is checked for length and table only.** Whatever it meets on the way (Blast Markers, ordnance, a ship that stops it) is the reducer's to resolve. |

## 8. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Nearest target: per weapon or strict? | Per weapon (V1). |
| D2 | Overlapping bases at deployment? | Forbidden (V5), so the presentation layer never has to resolve it. |

No open questions.
