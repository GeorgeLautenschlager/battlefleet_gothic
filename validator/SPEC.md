# Validator Specification

**Status:** draft v0.2, for discussion. **Scope:** Phase 1 (Cruiser Clash, Lunar vs Murder, hot-seat). Builds on [Game State v0.4](../game_state/SPEC.md) and [Transforms v0.3](../transforms/SPEC.md).

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
headingVector(h)        = (sin h, cos h)
```

`atan2deg(x, y)` is `atan2(x, y)` in degrees. Note the argument order: `x` first, because 0° is `+y`.

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
  total: number                    // total forward distance
  end: { position: Point, heading: number }
}
```

Turns rotate in place at the stem; only `advance` steps produce legs. `sinceLastTurn` is the forward distance since the start of the move or since the previous turn.

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
```

`canEngage(ship, weapon, target)` is true when **all** of:

1. `distance ≤ weapon.range`;
2. `quadrantsOfPoint(ship, target.position)` intersects `weapon.arcs`;
3. the line of fire isn't blocked (ship targets only; ordnance never blocks).

**Nearest target, per weapon** (ruling V1):

```
nearestShipTargets(ship, weapon)     = among enemy ships with status "active" for which canEngage holds,
                                       those within EPS of the minimum distance
nearestOrdnanceTargets(ship, weapon) = the same over enemy torpedo salvoes
isNearest(ship, weapon, target)      = target ∈ the matching set above
```

Hulks are never "the nearest", so shooting at an enemy hulk always needs the priority test (p. 71). Ties all count as nearest; the shooter picks.

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

`roll_leadership`, `roll_zones`, `roll_deploy_order` and `roll_first_turn` have no checks beyond the gates.

**`deploy_ship`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "undeployed"` | `ALREADY_DEPLOYED` |
| 4 | `position` lies in the player's zone rectangle (inclusive, `EPS`) | `NOT_IN_ZONE` |
| 5 | The new base doesn't overlap any deployed ship's base: `distance > r1 + r2 − EPS`. Touching is allowed. | `BASES_OVERLAP` |

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
| 4 | `turnState.ships[id].moved = false` | `ALREADY_MOVED` |
| 5 | `activation = null` | `ACTIVATION_OPEN` |
| 6 | `turnState.commandCheckFailed = false` | `ORDERS_LOCKED` |
| 7 | `ship.specialOrder = null` | `ALREADY_ON_ORDERS` |
| 8 | `order ≠ "brace_for_impact"` (Brace only comes through `answer_brace`) | `INVALID_ORDER` |
| 9 | If `ramTargetId` is given: `order = "all_ahead_full"` and `meta.options.ramming` | `RAM_NOT_ALLOWED` |
| 10 | If `ramTargetId` is given: it names an enemy ship that's `onTable` (hulks allowed, transform D2) | `INVALID_RAM_TARGET` |

**`move`**

First, identify the move:

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 4 | `turnState.ships[id].moved = false` | `ALREADY_MOVED` |
| 5 | `activation = null`, or `activation.stage = "ordered"` with `activation.shipId = shipId` | `ACTIVATION_OPEN` |

Then work out the move's parameters, the same way the reducer does:

```
order        = activation?.order ?? null
baseSpeed    = speed(ship)                                      // state §11
D0           = baseSpeed + (activation?.aafExtra ?? 0)          // unslowed maximum
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
| 6 | Every `advance.distance > 0` and every `turn.degrees ≠ 0` | `INVALID_PATH_STEP` |
| 7 | Every `|turn.degrees| ≤ ship.profile.turns` | `TURN_TOO_SHARP` |
| 8 | Number of turns ≤ `turnsAllowed` | `TOO_MANY_TURNS` |
| 9 | Each turn has `sinceLastTurn ≥ turnDist`. Exception: under Burn Retros, a turn with `sinceLastTurn = 0` is fine. | `TURN_TOO_EARLY` |
| 10 | If `exit ≠ null`: the exit happens in the **last** step, which is an `advance` | `PATH_CONTINUES_OFF_TABLE` |
| 11 | If `exit ≠ null`: `disengage = false` | `ALREADY_LEAVING_TABLE` |
| 12 | `walk.total ≤ D`. For All Ahead Full, see 14. | `PATH_TOO_LONG` |
| 13 | Unless `exit ≠ null`: `walk.total ≥ min(minDistance, D)`. A ship that can't make half speed must go as far as it can (p. 53). | `PATH_TOO_SHORT` |
| 14 | **All Ahead Full only.** `walk.total ≈ aafEnd` (below), or the path leaves the table at or before `aafEnd`. | `MUST_STOP_AT_BLAST_MARKER` if `aafEnd` is a BM stop, else `MUST_MOVE_FULL_DISTANCE` |

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

Rams and torpedo contacts don't affect legality. The reducer resolves them as the path executes (transform §4.2).

### 4.3 Shooting

**`fire`**

| # | Check | Code |
|---|---|---|
| 1 | Ship exists | `UNKNOWN_SHIP` |
| 2 | `ship.owner = player` | `NOT_YOUR_SHIP` |
| 3 | `ship.status = "active"` | `SHIP_NOT_ACTIVE` |
| 4 | `turnState.ships[id].disengage ≠ "failed"` | `DISENGAGE_FAILED` |
| 5 | Weapon exists on the profile | `UNKNOWN_WEAPON` |
| 6 | `weapon.kind ∈ {battery, lance}` | `WRONG_WEAPON_KIND` |
| 7 | Weapon not in `weaponsFired` | `WEAPON_ALREADY_FIRED` |
| 8 | Weapon not disabled (state §11 `weaponDisabled`) | `WEAPON_DISABLED` |
| 9 | Target exists: a ship id for `kind: "ship"`, a salvo id for `kind: "ordnance"` | `UNKNOWN_TARGET` |
| 10 | Target is the enemy's. A ship target must be `onTable` (so friendly hulks are out). | `INVALID_TARGET` |
| 11 | `distance(ship, target) ≤ weapon.range` | `OUT_OF_RANGE` |
| 12 | Let `Q = quadrantsOfPoint(ship, target.position) ∩ weapon.arcs`. `Q` is non-empty. | `OUT_OF_ARC` |
| 13 | If `|quadrantsOfPoint(ship, target.position)| > 1` and `|Q| > 1`, `arc` is supplied | `ARC_CHOICE_REQUIRED` |
| 14 | If `arc` is supplied, `arc ∈ Q` | `INVALID_ARC_CHOICE` |
| 15 | Ship targets only: if `|quadrantsOfPoint(target, ship.position)| > 1`, `aspect` is supplied | `ASPECT_CHOICE_REQUIRED` |
| 16 | If `aspect` is supplied, it's in `quadrantsOfPoint(target, ship.position)`. Ordnance targets must not supply it. | `INVALID_ASPECT_CHOICE` |
| 17 | Ship targets only: `!lineOfFireBlocked(ship, target)` | `LINE_OF_FIRE_BLOCKED` |
| 18 | If `priorityTest = "failed"`: `isNearest(ship, weapon, target)` | `MUST_TARGET_NEAREST` |

Check 13 only demands a choice when it makes a difference. A target on the front/right boundary of a weapon that only fires right doesn't need `arc`: `Q = {right}`.

**`launch_torpedoes`**

| # | Check | Code |
|---|---|---|
| 1–4 | As `fire` 1–4 | as `fire` |
| 5 | Weapon exists | `UNKNOWN_WEAPON` |
| 6 | `weapon.kind = "torpedoes"` | `WRONG_WEAPON_KIND` |
| 7 | Weapon not in `weaponsFired` | `WEAPON_ALREADY_FIRED` |
| 8 | Weapon not disabled | `WEAPON_DISABLED` |
| 9 | `ship.loaded.torpedoes = true` | `NOT_LOADED` |
| 10 | `0 ≤ bearing < 360` and `quadrantsOf(bearing) ∩ weapon.arcs ≠ ∅` | `BEARING_OUT_OF_ARC` |

**`end_step`**: gates only. G6 already limits it to `direct_fire` / `launch_ordnance`.

### 4.4 Ordnance

**`move_ordnance`**

| # | Check | Code |
|---|---|---|
| 1 | Salvo exists | `UNKNOWN_ORDNANCE` |
| 2 | `salvo.owner = player` | `NOT_YOUR_ORDNANCE` |
| 3 | Not in `turnState.ordnanceMoved` | `ORDNANCE_ALREADY_MOVED` |

### 4.5 Brace

**`answer_brace`**

| # | Check | Code |
|---|---|---|
| 1 | `pendingId` = id of the **top** pending entry | `NOT_TOP_PENDING` |

(G5 already made sure `player` is that entry's player.)

### 4.6 End Phase

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
| `NOT_IN_ZONE` | Deployment position outside the player's zone |
| `BASES_OVERLAP` | Deployment position overlaps another ship's base |
| `NOT_A_HULK` / `ALREADY_DRIFTED` | `drift_hulk` on a non-hulk, or a second time |
| `ALREADY_MOVED` | Ship has finished its move this turn |
| `ACTIVATION_OPEN` | Another ship has declared an order and hasn't moved yet |
| `ORDERS_LOCKED` | Fleet failed a Command check this turn |
| `ALREADY_ON_ORDERS` | Ship has a live order (usually last turn's Brace) |
| `INVALID_ORDER` | Brace declared directly |
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
| `LINE_OF_FIRE_BLOCKED` | A hulk is in the way |
| `MUST_TARGET_NEAREST` | Priority test failed; only the nearest target is allowed |
| `BEARING_OUT_OF_ARC` | Torpedo launch bearing outside the launcher's arc |
| `ORDNANCE_ALREADY_MOVED` | Salvo already moved this step |
| `ALREADY_REPAIRED` / `NOTHING_TO_REPAIR` | Damage control |
| `INVALID_PRIORITY` | Priority list isn't exactly the required set |

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

## 8. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Nearest target: per weapon or strict? | Per weapon (V1). |
| D2 | Overlapping bases at deployment? | Forbidden (V5), so the presentation layer never has to resolve it. |

No open questions at v0.2.
