# Reducer Specification

**Status:** v0.4. v0.3 is implemented in [`engine/`](../engine/README.md); v0.4 adds boarding actions, grapples and teleport attacks (§6, §7.4, §8, §10.4–10.5, §11, §12, R11–R15), not yet implemented. **Scope:** Cruiser Clash (1–4 cruisers a side). Builds on [Game State v0.7](../game_state/SPEC.md), [Transforms v0.5](../transforms/SPEC.md) and [Validator v0.4](../validator/SPEC.md).

```ts
reduce(state: GameState, transform: Transform) → GameState
```

The reducer applies one **already validated** transform and returns the next state. The transform spec gives each transform's effect in summary, with its dice in draw order; this document gives the algorithms. Contents:

- the work queue and the reduce pipeline (§1)
- dice (§2)
- the damage pipeline (§3)
- direct fire (§4)
- Blast Marker placement (§5)
- criticals (§6)
- catastrophic damage (§7)
- movement, rams and drifting hulks (§8)
- torpedoes (§9)
- the End Phase (§10)
- the work item catalogue (§11)
- log entries (§12)
- a worked example (§13)

Geometry helpers (`relBearing`, `quadrantsOf`, swept contact, `walkPath`, …) are the ones in [validator §2](../validator/SPEC.md#2-geometry-helpers). The reducer imports the same module. The maths rule in [validator §2.8](../validator/SPEC.md#28-deterministic-maths) applies here too: `asin` in Blast Marker placement means `dmath.asinDeg`, `sin`/`cos` mean `sinDeg`/`cosDeg`.

---

## 1. The work queue

### 1.1 Why a queue

A single transform can set off a chain of events. A ram damages the target and the rammer; the target explodes; the explosion hits a third ship, which explodes too. At any point in the chain the reducer may have to stop and ask a player whether a ship braces.

Rather than unwinding a call stack and remembering what it still owed, the reducer keeps **all outstanding work in `state.queue`** (state §9.3), a list of plain-data **work items** processed front first.

- An item that needs follow-up work **inserts the follow-ups at the front** of the queue, in the order they should run. That gives depth-first, in-order resolution: an explosion's hits resolve before the next thing the ram still owed.
- **Offering a brace is itself a work item.** It's placed right before the roll it protects. When it runs and the ship can brace, it pushes a `brace` decision onto `pending`, and the queue simply stops until the answer arrives. Nothing needs to be "resumed": the next item in the queue is the roll.

### 1.2 Pipeline

```
reduce(s, t):
  s' = deep copy of s                         // never mutate the input
  handle(s', t)                               // per-transform handler; usually just enqueues work
  settle(s')
  return s'

settle(s):
  loop:
    while pending is empty and queue is non-empty:
      item = queue.shift(); run(item)         // §11; may insert items at the front and/or push a pending decision
    if pending is non-empty: return           // waiting on a brace answer
    if stage = "battle" and some side has no ship with status "active": endGame(s, "fleet_eliminated"); return
    if stage ≠ "ended" and stepComplete(s): advanceStep(s); continue      // transform §2.3; entry housekeeping may enqueue work
    return
```

`answer_brace` resolves the brace Command check, pops the decision, and leaves the rest to `settle`. The queue then picks up exactly where it stopped.

### 1.3 Contract

1. **Pure.** No I/O, no clock, no global randomness. Same `(s, t)` → structurally equal result.
2. **Precondition:** `validate(s, t).ok`. Behaviour on an unvalidated transform is undefined. The reducer doesn't repeat validator checks.
3. **Postcondition:** the result satisfies state §13. In particular, **`queue` is empty unless `pending` is non-empty.**
4. **Order.** "In order" means `ships` / `blastMarkers` / `ordnance` array (creation) order unless stated otherwise.
5. **Stale items are no-ops.** An item whose subject is gone (salvo removed, ship destroyed or off the table) does nothing, and logs `skipped`.

---

## 2. Dice, ids and tests

### 2.1 RNG

`mulberry32` over `rng.state`, which `newGame` initialises to `seed`:

```
nextUint32(rng):
  rng.state = (rng.state + 0x6D2B79F5) >>> 0
  t = rng.state
  t = imul(t ^ (t >>> 15), t | 1)
  t = t ^ (t + imul(t ^ (t >>> 7), t | 61))
  rng.draws += 1
  return (t ^ (t >>> 14)) >>> 0

d6():   loop { u = nextUint32(); if u < 4294967292: return (u mod 6) + 1 }
nD6(n): [d6() for i in 1..n]          // left to right; nD6(0) draws nothing
d3():   ceil(d6() / 2)
```

`imul` is 32-bit integer multiply (`Math.imul`).

### 2.2 Leadership-style tests

```
test(dice, target): rolls = nD6(dice); passed = sum(rolls) ≤ min(target, 10)
```

The cap gives "11–12 always fails" on 2D6 (p. 48), and "modified Ld 13 still rolls against 10" (p. 56).

| Test | Dice | Target |
|---|---|---|
| Command check (orders, Brace) | 2 | `commandCheckLd(ship)` (state §11) |
| Target priority | 2 | `leadership(ship)` |
| Ram | 3 / 2 / 1 for a target of smaller / same / larger type | `leadership(ship)` |
| Disengage | 2 | `leadership(ship)` + 1 per BM within 5 cm − 1 per enemy ship or salvo within 15 cm |

Size order: escort < cruiser < battleship < defence. Phase 1 rams are always cruiser on cruiser, so 2D6.

### 2.3 Ids

`newId(kind)` returns `` `${kind}-${nextId}` `` and increments `nextId`. Kinds: `ship`, `bm`, `ord`, `crit`, `pend`, `log`.

---

## 3. The damage pipeline

Every way of hurting a ship ends here.

```
inflict(target, hits, src):     // src: { source: AttackSource, origin: Point, shieldable, braceable }
  if hits = 0 or target isn't on the table: return
  if isHulk(target): hulkHit(target, src); return                                  // §7.3
  if src.shieldable:
    absorbed = min(hits, shieldCapacity(target))
    placeShieldBlastMarkers(target, absorbed, src.origin)                          // §5.1
    hits −= absorbed
  if hits > 0 and src.braceable and isBraced(target):
    rolls = nD6(hits); hits −= count(rolls, r ≥ 4)                                 // 4+ save (p. 66)
  for i in 1..hits:
    if target.damage = target.profile.hits: break                                  // overkill discarded (R2)
    damagePoint(target, critCheck = true)
  if target.damage = target.profile.hits and target.status = "active": catastrophic(target)   // §7

damagePoint(ship, critCheck):
  ship.damage += 1; log damage
  if critCheck and ship.damage < ship.profile.hits and d6() = 6: critical(ship)    // §6
```

- `isBraced(ship)` is true when the ship's `specialOrder` is Brace For Impact!.
- `shieldCapacity` is read **once**. Absorbing `n` hits places `n` BMs in contact, which is how capacity falls (state R#11).
- `inflict` never pauses. Anything that might need a brace (an explosion) is **enqueued** by `catastrophic`, and runs after `inflict` returns but ahead of anything already queued.

| Source | shieldable | braceable |
|---|---|---|
| Batteries, lances | yes | yes |
| Explosions | yes | yes |
| Torpedoes | no | yes |
| Rams | no | yes |
| 0-shield ship crossing a BM | no | yes |
| Fire!, critical extra damage | (bypass `inflict`; `damagePoint` with `critCheck = false`) | no |
| Boarding damage | (bypasses `inflict`; `damagePoint` with `critCheck = false`; 0 hits → drifting hulk, no catastrophic roll, §10.4) | no |
| Teleport attacks | (no hits: a critical only, §10.5) | yes |

---

## 4. Direct fire

The `fire` handler runs the priority test if one is needed (transform §4.3). If the test fails, it records `"failed"` and stops. Otherwise it records `"passed"` if a test was taken, adds `weaponId` to `weaponsFired`, and enqueues:

```
[ brace_offer { shipId: target, source: { kind: "ship", id: shooter } },   // ship targets only
  direct_fire { shooterId, weaponId, target, arc, aspect } ]
```

Omitted `arc` / `aspect` are filled in by the handler: they're the single element the validator guarantees.

### 4.1 Batteries

```
fp     = effectiveStrength(shooter, weapon)                       // state §11
column = clamp(baseColumn(target, aspect) + shifts, A, E)
dice   = gunnery(fp, column)
need   = target is ordnance ? 6 : target.profile.armour[aspect]
rolls  = nD6(dice);            hits = count(rolls, r ≥ need)
if shooter is on Lock On: rerolls = nD6(dice − hits); hits += count(rerolls, r ≥ need)
```

**Base column:**

| Target | Column |
|---|---|
| ordnance | E |
| ship with `targetedAsDefences` | A |
| capital ship, aspect front / rear / left or right | B / C / D |
| escort, aspect front / rear / left or right | C / D / E |

**Shifts** (A = 0 … E = 4; + is right, meaning fewer dice). Summed, then clamped.

| Condition | Shift |
|---|---|
| distance ≤ `SHORT_RANGE` | −1 |
| distance > `LONG_RANGE` | +1 |
| stem-to-stem line touches a BM, or shooter or target has a BM in contact | +1 |

**Gunnery table** (p. 62). For `fp > 20`: `gunnery(fp) = gunnery(20) + gunnery(fp − 20)`. `gunnery(0) = 0`.

```
FP:  A  B  C  D  E      FP:  A  B  C  D  E
 1:  1  1  1  0  0      11: 10  8  6  4  2
 2:  2  1  1  1  0      12: 11  8  6  4  2
 3:  3  2  2  1  1      13: 12  9  7  5  3
 4:  4  3  2  1  1      14: 13 10  7  5  3
 5:  5  4  3  2  1      15: 14 11  8  5  3
 6:  5  4  3  2  1      16: 14 11  8  6  3
 7:  6  5  4  2  1      17: 15 12  9  6  3
 8:  7  6  4  3  2      18: 16 13  9  6  4
 9:  8  6  5  3  2      19: 17 13 10  7  4
10:  9  7  5  4  2      20: 18 14 10  7  4
```

### 4.2 Lances

```
str   = effectiveStrength(shooter, weapon)
need  = target is ordnance ? 6 : 4                                 // armour ignored (p. 60)
rolls = nD6(str); hits = count(rolls, r ≥ need)
if shooter is on Lock On: rerolls = nD6(str − hits); hits += count(rerolls, r ≥ need)
```

No column shifts (p. 61).

### 4.3 Hits

- **Ordnance target:** one hit or more removes the salvo (p. 78).
- **Ship target:** `inflict(target, hits, { source: shooter, origin: shooter.position, shieldable: true, braceable: true })`.

Shield BMs take effect at once, so they count towards the shooter's next weapon's shift (p. 201).

---

## 5. Blast Marker placement

All Blast Markers are circles of radius `BM_RADIUS`. Two BMs **overlap** if their centres are closer than `2·BM_RADIUS − EPS`.

### 5.1 Shield hits: fanned around the target

```
placeShieldBlastMarkers(target, n, origin):
  ρ  = baseRadius(target) + BM_RADIUS                // a BM touching the base
  δ  = 2·asin(BM_RADIUS / ρ)                         // neighbouring touching BMs
  θ0 = tableBearing(target.position, origin)         // in the line of fire; 0 if origin = stem
  slots = θ0, θ0+δ, θ0−δ, θ0+2δ, θ0−2δ, … (while |kδ| ≤ 180°)
  each marker goes in the first slot that overlaps no existing BM; if none is free, at θ0 (stacked, p. 68)
```

For a small base `δ ≈ 52°`, so six BMs fit around it.

### 5.2 Explosion cluster

```
placeCluster(centre, n):
  the first BM at centre; then ring k = 1, 2, …: radius 2k·BM_RADIUS, step δk = 2·asin(1/(2k)),
  slots at bearings 0, δk, 2δk, … clockwise; fill free slots until n are placed
```

### 5.3 Single markers

| Event | Placement |
|---|---|
| Ship becomes a hulk | 1 BM at its stem |
| Hulk finishes a drift | 1 BM on the ring `ρ` at bearing `heading + 180` (trailing). If occupied, use the §5.1 slot order. |

---

## 6. Critical hits

```
critical(ship):
  rolls = nD6(2); applyCritical(ship, sum(rolls))

applyCritical(ship, n):                              // also a Hit-and-Run result: n is one D6 (§10.5)
  while not applies(ship, n): n += 1                 // "next highest" (p. 67); 12 always applies
  apply n, then its extra damage via damagePoint(ship, critCheck = false)
```

| n | Applies if | Effect | Extra damage |
|---|---|---|---|
| 2 | ship has a `dorsal` weapon | `dorsal_armament` | — |
| 3 | has a `starboard` weapon | `starboard_armament` | — |
| 4 | has a `port` weapon | `port_armament` | — |
| 5 | has a `prow` weapon | `prow_armament` | — |
| 6 | always | `engine_room` | 1 |
| 7 | always | `fire` | — |
| 8 | always | `thrusters` | 1 |
| 9 | no `bridge_smashed` yet | `bridge_smashed` | — |
| 10 | no `shields_collapse` yet and `profile.shields > 0` | `shields_collapse` | — |
| 11 | always | (Hull Breach) | `d3()` |
| 12 | always | (Bulkhead Collapse) | `d6()` |

Repeats of repairable criticals stack (state §7.2). New criticals get `id = newId("crit")` and `playerTurn = clock.playerTurn`. Extra damage stops early if the ship hits 0; catastrophic damage then follows from `inflict` (or from the caller, for Fire!).

---

## 7. Catastrophic damage

### 7.1 The roll

```
catastrophic(ship):
  n = sum(nD6(2))
  2–6:  status = "drifting_hulk"; 1 BM at the stem; specialOrder = null
  7–8:  status = "blazing_hulk";  1 BM at the stem; specialOrder = null
  9–11: explode(ship, strength = ceil(H / 2), markers = ceil(H / 2))
  12:   explode(ship, strength = H, markers = H)
```

`H` is the ship's starting hits (`profile.hits`). Every outcome takes the ship out of its grapple, if it's in one (§7.4).

### 7.2 Explosions

```
explode(ship, strength, markers):
  radius = sum(nD6(3)); centre = ship.position
  status = "destroyed"; position = heading = specialOrder = null
  placeCluster(centre, markers)
  targets = on-table ships (hulks included) with distance(stem, centre) ≤ radius, in order    // R9
  insert at the front of the queue, for each target in order:
    brace_offer { shipId: t, source: { kind: "explosion", id: ship.id } },
    explosion_hit { shipId: ship.id, centre, strength, targetId: t }
```

`explosion_hit` draws `nD6(strength)`; each 4+ is a hit (lance shots, p. 71). It then calls `inflict(t, hits, { source: explosion, origin: centre, shieldable: true, braceable: true })`.

Explosions ignore line of sight (p. 64). A chained explosion inserts its items at the front, so it resolves before the original explosion's remaining targets.

### 7.3 Hits on a hulk

```
hulkHit(hulk, src):
  if (hulk.id, src.source) is in turnState.hulkRolls: return                       // once per source (R3)
  record it; n = sum(nD6(2))
  2–6: status = "drifting_hulk"   7–8: status = "blazing_hulk"   (no extra BM, R4)
  9–12: explode as §7.1
```

A hulk has no shields, can't brace, and is already at 0 hits, so the hits themselves do nothing. Only the re-roll matters.

---

### 7.4 Leaving a grapple

Whenever a ship stops being `active` (it becomes a hulk, explodes or leaves the table), it leaves its grapple (state §7):

```
leaveGrapple(x):
  if x.grapple = null: return
  g = x.grapple; x.grapple = null
  rest = g.attackerIds minus x.id
  if x.id = g.defenderId or rest is empty:
    for every other member m: m.grapple = null
    log grapple_ended { defenderId: g.defenderId, shipId: x.id }
  else:
    for every other member m: m.grapple = { defenderId: g.defenderId, attackerIds: rest }
```

In practice that's §7.1 (a capital ship reaching 0) and §10.4 (a ship boarded to 0). Grappled ships don't move, so they never leave the table.

## 8. Movement

### 8.1 Handlers

**`declare_order`.**
1. Run the Command check.
2. On a pass, set `specialOrder` with `expires = { playerTurn: now + 2, at: "movement_start" }`. Reload Ordnance also sets every `loaded` flag to `true`.
3. For All Ahead Full with a ram target, run the ram test; then draw 4D6 for `aafExtra`.
4. On a fail, set `commandCheckFailed = true`.
5. Open the activation with `stage: "ordered"` (state §9.1). Its `maxDistance` / `minDistance` come from validator §4.2's parameter block, with no BM slowdown yet.

**`move`.**
1. Create the activation if there isn't one (no order).
2. Set `stage: "moving"`, `remainingPath = path`, `disengage` and `boardTargetId` (null if absent).
3. Enqueue `continue_move`.

**Entering `move_ships`.** For each of the active player's `active` ships with `grapple ≠ null`, in order: `turnState.ships[id].moved = true`, `lastMove = { playerTurn, distance: 0 }` (so it's targeted as Defences), log `grappled`. The step's completion rule then needs nothing from them.

### 8.2 `continue_move`

```
continue_move:
  a = activation; ship = a.ship
  while a.remainingPath is non-empty and ship.status = "active":
    step = a.remainingPath[0]
    if step is a turn:
      if !turnStillLegal(ship, a, step): a.remainingPath = []; a.truncated = true; break      // validator checks 7–9, current state
      ship.heading = norm(ship.heading + step.degrees); a.turnsMade += 1; a.distanceSinceTurn = 0
      shift; continue
    allowed = a.maxDistance − a.distanceMoved
    if allowed ≤ EPS: a.remainingPath = []; a.truncated = true; break
    len = min(step.distance, allowed)
    e = firstEvent(ship, a, len)                      // earliest event along this leg, table below
    if e = null:
      advance(len); step.distance −= len
      if step.distance ≤ EPS: shift
      else: a.truncated = true; a.remainingPath = []
      continue
    advance(e.t); step.distance −= e.t
    insert at the front: [...eventItems(e), continue_move]
    return                                            // the queue runs the event, then us again
  finish_move
```

`advance(d)` moves the stem `d` cm along `headingVector(heading)`, and adds `d` to `distanceMoved` and `distanceSinceTurn`.

**Events.** Ties are ordered: table exit, ram target, salvo (in `ordnance` order), Blast Marker. An event counts at any `t ≥ 0` along the leg, so contact the ship starts in counts as soon as it moves. Nothing fires twice, because each event is gated by state rather than by distance: a ram resolves once (`a.ram.resolved`), a salvo attacks a given ship once per round (its `attacks`), and only the first BM contact of the move is an event (`slowedByBlastMarkers`).

| Event | Condition | Items / effect |
|---|---|---|
| Table exit | stem leaves the table (`exitT`) | Immediately: `status = "disengaged"`, position, heading and order null; log `disengaged { reason: "table_edge" }`. No items. |
| Ram target | `a.ram.testPassed`, not `resolved`, swept base meets the target's base | `brace_offer(target)`, `brace_offer(rammer)`, `ram { rammerId, targetId }` |
| Torpedo salvo | swept base meets a salvo's segment. Skip a salvo that already attacked this ship this round, and one this ship launched this player turn (T4). | `torpedo_attack { ordnanceId, targetId: ship, bmTested: false }` |
| Blast Marker | first BM contact this move | Immediately: if `!slowedByBlastMarkers`, `maxDistance −= BM_SLOWDOWN` and set the flag. If `maxShields(ship) = 0` and `!zeroShieldBMTestDone`, set it and add items `brace_offer(ship)`, `zero_shield_bm { shipId }`. If the order is All Ahead Full, the BM is new (met at `t > EPS`, not started on), and `distanceMoved ≥ maxDistance − BM_SLOWDOWN`, end the move here (`remainingPath = []`). Log `blast_marker_contact`. |

**`finish_move`:**
1. If the ship is still `active`: set `lastMove = { playerTurn, distance: distanceMoved }`.
2. If `disengage` was requested, run the test. Pass → `disengaged`; fail → `turnState.ships[id].disengage = "failed"`.
3. If `boardTargetId ≠ null` (transform T8), with `t` the target:
   ```
   if !a.truncated and ship.status = "active" and t.status = "active" and t.grapple = null and basesTouch(ship, t):
     turnState.ships[id].boardingDeclared = t.id; log boarding_declared
   else:
     log boarding_lapsed { reason: a.truncated ? "truncated" : t.status ≠ "active" or t.grapple ≠ null ? "target_gone" : "no_contact" }
   ```
4. Set `turnState.ships[id].moved = true`, log `move`, and set `activation = null`.

### 8.3 `ram`

```
headOn = "front" ∈ quadrantsOfPoint(target, rammer.position)                               // T7
facing = the quadrant of target containing rammer.position (on a boundary, the lower armour, R7)
rRolls = nD6(rammer.profile.hits);                                    rHits = count(r ≥ target.profile.armour[facing])
tDice  = isHulk(target) ? 0 : headOn ? target.profile.hits : ceil(target.profile.hits / 2)  // R5
tRolls = nD6(tDice);                                                  tHits = count(r ≥ rammer.profile.armour.front)
a.ram.resolved = true; log ram
inflict(target, rHits, { source: rammer, origin: rammer.position, shieldable: false, braceable: true })
inflict(rammer, tHits, { source: target, origin: target.position, shieldable: false, braceable: true })
```

If the target explodes from the first `inflict`, its explosion is queued. It then resolves before `continue_move`, and it can hit the rammer (p. 56). The rammer's own `inflict` still runs straight away, because it's part of the same item.

The rammer can brace (p. 66: rams included). Bracing replaces All Ahead Full, but the activation keeps its own `order`, so the move finishes under AAF's movement rules.

### 8.4 Drifting hulks

The `drift_hulk` handler draws `sum(nD6(4))` and enqueues `hulk_drift { shipId, distance, travelled: 0 }`:

```
hulk_drift:
  move straight ahead, using the event loop of §8.2 with only two events:
    table exit (status "destroyed", position null, log hulk_lost; stop)
    torpedo salvo (insert [torpedo_attack…, hulk_drift (with updated travelled)] and return)
  at the end: 1 trailing BM (§5.3); if blazing, catastrophic re-roll as §7.3 with a fresh source
  turnState.ships[id].drifted = true
```

---

## 9. Torpedoes

### 9.1 Launch

```
{ id: newId("ord"), kind: "torpedo_salvo", owner, launchedBy: ship.id, launched: playerTurn,
  position: ship.position, heading: norm(ship.heading + bearing),
  strength: effectiveStrength(ship, weapon), speed: weapon.speed, width: TORPEDO_WIDTH, attacks: [] }
```

Then `loaded.torpedoes = false`, add the weapon to `weaponsFired`, and log `ordnance_launch`. No dice.

### 9.2 Moving a salvo

The `move_ordnance` handler enqueues `ordnance_move { ordnanceId, travelled: 0, bmTested: false }`:

```
ordnance_move:
  while travelled < speed:
    e = earliest event along the remaining (speed − travelled) cm:
        table exit | another salvo | a ship base (skip: launcher during launch turn; ships already attacked this round)
        | a Blast Marker (only if !bmTested)
    if none: advance the rest; travelled = speed; break
    advance to e.t; travelled += e.t
    table exit   → remove salvo; break
    other salvo  → remove both; break
    Blast Marker → bmTested = true; if d6() = 6: remove salvo; break           // p. 75
    ship         → insert [torpedo_attack { ordnanceId, targetId, bmTested }, ordnance_move { …, travelled, bmTested: true }]
                   return
  ordnanceMoved += ordnanceId (if the salvo still exists, or was removed this move)
```

Setting `bmTested: true` on the continuation is deliberate. Either the BM roll has already happened this move, or `torpedo_attack` will take it, so either way there's no second roll.

### 9.3 `torpedo_attack`

```
torpedo_attack { ordnanceId, targetId, bmTested }:
  if !bmTested and bmsInContact(ship) non-empty and d6() = 6: remove salvo; return      // p. 75
  insert at the front: [brace_offer { shipId: target, source: { kind: "ordnance", id } }, torpedo_hit { ordnanceId, targetId }]

torpedo_hit:
  turretRolls = nD6(turrets(ship)); strength −= count(r ≥ 4)        // turrets after the brace decision (p. 66)
  if strength ≤ 0: remove; return
  facing = quadrant of ship containing the salvo's centre (on a boundary, the lower armour)  // p. 201, R7
  rolls  = nD6(strength); hits = count(r ≥ ship.profile.armour[facing])
  attacks += { targetId, round }; strength −= hits                  // hits scored, before saves (R6)
  if strength ≤ 0: remove salvo
  inflict(ship, hits, { source: ordnance, origin: salvo position, shieldable: false, braceable: true })
```

When a **ship** moves into a salvo (§8.2), the same `torpedo_attack` runs. It's followed by `continue_move` instead of `ordnance_move`, and the salvo stays where it is.

---

## 10. End Phase

### 10.1 `repair`

```
dice  = remainingHits(ship); if bmsInContact(ship) non-empty: dice = ceil(dice / 2)     // p. 88
rolls = nD6(dice); k = count(rolls, r = 6)
remove the first min(k, |priority|) criticals in priority; repaired = true
```

### 10.2 Fires burn (entry housekeeping for `blast_marker_removal`)

```
enqueue fire_damage { shipId } for each of the active player's "active" ships with ≥ 1 fire, in order

fire_damage { shipId }:
  repeat (number of fire criticals) times: if the ship is at 0, stop; damagePoint(ship, critCheck = false)
  if the ship reached 0: catastrophic(ship)
```

A ship's explosion is queued in front of the next ship's `fire_damage`, so it resolves first.

### 10.3 `remove_blast_markers`

```
roll = d6(); remove the first min(roll, |priority|) BMs in priority; blastMarkersRemoved = true
```

If nothing is removable, the step is complete on entry and no die is rolled.

### 10.4 Boarding

**Entering `boarding`.** If `meta.options.boarding` is off, nothing happens and the step is complete. Otherwise, for each ship `d` in order whose `grapple.defenderId = d.id`, enqueue `boarding_fight { defenderId: d.id, attackerIds: d.grapple.attackerIds }`.

**Completion.** The step is complete when `boardingsToFight` is empty (transform §4.6) and no legal `teleport` exists: no pair of an active-player ship and an enemy ship passes validator §4.6's `teleport` checks. Otherwise it waits for `board`, `teleport` or `end_step`.

**`board` handler.** Set `boarded` on every ship in `priority`. Together: enqueue one `boarding_fight { defenderId: target, attackerIds: priority }`. Separately: enqueue one `boarding_fight { defenderId: target, attackerIds: [a] }` per ship `a`, in `priority` order.

**`boarding_fight { defenderId, attackerIds }`:**

```
d = ship(defenderId); A = [ship(a) for a in attackerIds if status = "active"]
if d.status ≠ "active" or A is empty: log skipped; return               // e.g. separately, after the target fell (T16)

attVal = Σ boardingValue(a) for a in A
defVal = boardingValue(d) + turrets(d)                                  // the defender adds its turrets (p. 89)
enemy(x) = (bmsInContact(x) ≠ ∅ ? 1 : 0) + (isCrippled(x) ? 2 : 0) + (x.specialOrder ≠ null ? 1 : 0)
attMod = ratio(attVal, defVal) + enemy(d) + players[owner(A)].factionTraits.boardingModifier
defMod = ratio(defVal, attVal) + max(enemy(a) for a in A) + players[d.owner].factionTraits.boardingModifier   // T11
attRoll = d6(); defRoll = d6()
att = attRoll + attMod; def = defRoll + defMod; diff = |att − def|
log boarding

if diff = 0: joinGrapple(d, A); return                                  // a draw: no damage, no criticals
(losers, winners) = att < def ? (A, [d]) : ([d], A)
boardingDamage(losers, diff)
(loserNeed, winnerNeed) = CRITS[min(diff, 5)]
insert at the front, in order:
  boarding_critical { shipId: x, need: loserNeed }  for x in losers
  boarding_critical { shipId: x, need: winnerNeed } for x in winners
```

```
ratio(own, enemy) = own ≥ 4·enemy ? 4 : own ≥ 3·enemy ? 3 : own ≥ 2·enemy ? 2 : own > enemy ? 1 : 0

CRITS = { 1: (5, 5), 2: (4, 5), 3: (3, 6), 4: (2, 6), 5: ("auto", "none") }    // (loser, winner), R#1

boardingDamage(ships, n):                       // in order: fill each ship before the next (T16)
  for x in ships:
    while n > 0 and x.damage < x.profile.hits: damagePoint(x, critCheck = false); n −= 1    // cause "boarding"
    if x.damage = x.profile.hits:
      status = "drifting_hulk"; specialOrder = null; 1 BM at the stem (§5.3); leaveGrapple(x); log boarded_hulk   // R12
    if n = 0: return
                                                // damage left over after every loser is a hulk is discarded (R2)

joinGrapple(d, A):
  g = d.grapple ?? { defenderId: d.id, attackerIds: [] }
  append to g.attackerIds each a in A not already in it, in order
  set an identical copy of g on d and on every attacker in g; log grapple
```

All of a fight's ships stay in base contact while grappled, because nothing moves them, so contact isn't checked again (R14).

**`boarding_critical { shipId, need }`:**

```
x = ship(shipId)
if x.status ≠ "active" or need = "none": return        // a ship at 0 makes no critical checks (R2)
rolls = need = "auto" ? [] : [d6()]
log boarding_critical
if need = "auto" or rolls[0] ≥ need:
  critical(x)                                           // §6; Brace doesn't apply (T12)
  if x.damage = x.profile.hits: catastrophic(x)         // reduced to 0 by a critical: roll as normal (p. 90)
```

One item per ship, queued, so an explosion set off by one check (and its brace offers) resolves before the next check (R11).

### 10.5 Teleport attacks

**`teleport` handler.** Set `teleported`. Enqueue `[brace_offer { shipId: target, source: { kind: "ship", id: shipId } }, teleport_attack { shipId, targetId }]`.

**`teleport_attack { shipId, targetId }`:**

```
t = ship(targetId)
if t.status ≠ "active": log skipped; return
r = d6()
if r = 1: log teleport { result: "failed" }; return
if isBraced(t): s = d6(); if s ≥ 4: log teleport { result: "saved" }; return       // p. 66
log teleport { result: "critical" }
applyCritical(t, r)                                     // §6: the D6 score read as the 2D6 total
if t.damage = t.profile.hits: catastrophic(t)
```

Against escorts a Hit-and-Run destroys the ship on 4+ instead (pp. 91–92). Cruiser Clash has no escorts, so that waits for them.

---

## 11. Work items

The definitive `WorkItem` union. The state stores these in `queue` (state §9.3).

```ts
type WorkItem =
  | { kind: "brace_offer", shipId: string, source: AttackSource }
  | { kind: "direct_fire", shooterId: string, weaponId: string,
      target: { kind: "ship" | "ordnance", id: string }, arc: Quadrant, aspect: Quadrant | null }
  | { kind: "continue_move" }
  | { kind: "ram", rammerId: string, targetId: string }
  | { kind: "zero_shield_bm", shipId: string }
  | { kind: "torpedo_attack", ordnanceId: string, targetId: string, bmTested: boolean }
  | { kind: "torpedo_hit", ordnanceId: string, targetId: string }
  | { kind: "ordnance_move", ordnanceId: string, travelled: number, bmTested: boolean }
  | { kind: "explosion_hit", shipId: string, centre: Point, strength: number, targetId: string }
  | { kind: "hulk_drift", shipId: string, distance: number, travelled: number }
  | { kind: "fire_damage", shipId: string }
  | { kind: "boarding_fight", defenderId: string, attackerIds: string[] }
  | { kind: "boarding_critical", shipId: string, need: number | "auto" | "none" }
  | { kind: "teleport_attack", shipId: string, targetId: string }
```

| Item | Does |
|---|---|
| `brace_offer` | If the ship can brace (transform §2.6) and the offer is still relevant, push `{ kind: "brace", player: owner, shipId, source }` onto `pending`. Otherwise do nothing. |
| `direct_fire` | §4.1–4.3 |
| `continue_move` | §8.2 |
| `ram` | §8.3 |
| `zero_shield_bm` | `d6()`; on a 6, `inflict(ship, 1, { shieldable: false, braceable: true, … })` |
| `torpedo_attack`, `torpedo_hit` | §9.3 |
| `ordnance_move` | §9.2 |
| `explosion_hit` | §7.2 |
| `hulk_drift` | §8.4 |
| `fire_damage` | §10.2 |
| `boarding_fight`, `boarding_critical` | §10.4 |
| `teleport_attack` | §10.5 |

**`answer_brace` handler.**
- `attempt: true`: run the Command check. On a pass, set `specialOrder = { kind: brace, issued: now, expires, replaced: previous kind or null }`; the expiry follows state §7.3. On a fail, append to `turnState.braceFailures`.
- `attempt: false`: log `brace_check { declined: true }`.

Either way, pop the decision. `settle` carries on with the queue.

---

## 12. Log entries

Shape as in state §10.4. `data` by `kind`; `rolls` always lists the dice in draw order.

| kind | data |
|---|---|
| `leadership_roll` | `shipId, rolls, leadership` |
| `zone_roll` | `rolls, zones` |
| `deploy_order_roll`, `first_turn_roll` | `rolls: [p1, p2], winner: PlayerId \| null` |
| `deploy` | `shipId, position, heading` |
| `first_turn_choice` | `firstPlayer` |
| `battle_start` | `firstPlayer` |
| `turn_start` | `round, player` |
| `step` | `phase, step` (battle) or `setupStep` (setup) |
| `end_step` | `step` (the step the player ended) |
| `order_expired` | `shipId, order` |
| `command_check` | `shipId, order, target, rolls, passed` |
| `ram_test`, `priority_test`, `disengage_test` | `shipId, target, rolls, passed` (+ `targetId` for rams) |
| `aaf_roll` | `shipId, rolls, extra` |
| `move` | `shipId, from, to, distance, truncated` |
| `grappled` | `shipId` (stays put this Movement Phase) |
| `boarding_declared` | `shipId, targetId` |
| `boarding_lapsed` | `shipId, targetId, reason: "truncated" \| "no_contact" \| "target_gone"` |
| `blast_marker_contact` | `shipId, distance, maxDistance` (the slowed maximum) |
| `ram` | `rammerId, targetId, headOn, facing, rammerRolls, rammerHits, targetRolls, targetHits` |
| `attack` | `source, targetId, weapon: "battery" \| "lance" \| "torpedo" \| "explosion", column?, shifts?, facing? (torpedoes), need, rolls, rerolls, hits` |
| `shields` | `shipId, absorbed, blastMarkerIds` |
| `brace_offer` | `pendingId, shipId, source` |
| `brace_check` | `shipId, rolls, target, passed`, or `shipId, declined: true` |
| `brace_saves` | `shipId, rolls, saved` |
| `damage` | `shipId, cause, damageAfter` (one entry per point; `cause` includes `"boarding"`) |
| `critical` | `shipId, rolls, rolled, applied, kind, extraRolls` |
| `catastrophic` | `shipId, rolls, result, blastMarkerIds, radiusRolls?, radius?` |
| `turrets` | `shipId, ordnanceId, rolls, stopped` |
| `bm_test` | `entityId, rolls, effect: "none" \| "removed" (salvo) \| "damage" (zero-shield ship)` |
| `ordnance_launch` | `ordnanceId, shipId, position, heading, strength` |
| `ordnance_move` | `ordnanceId, to` (only if the salvo survives the move) |
| `ordnance_removed` | `ordnanceId, reason: "left_table" \| "collision" \| "blast_marker" \| "turrets" \| "spent" \| "shot"` |
| `hulk_drift` | `shipId, rolls, distance` |
| `hulk_lost` | `shipId, reason: "table_edge"` |
| `disengaged` | `shipId, reason: "table_edge" \| "test"` |
| `repair` | `shipId, rolls, repaired` |
| `fire_damage` | `shipId, fires` |
| `boarding` | `defenderId, attackerIds, values: { attackers, defender }, modifiers: { attackers, defender }, rolls: [attackers, defender], totals: { attackers, defender }, result: "draw" \| "stalemate" \| "heavy_fighting" \| "driven_back" \| "stormed" \| "overwhelmed", loser: "attackers" \| "defender" \| null, damage` |
| `boarding_critical` | `shipId, need, rolls, critical` |
| `boarded_hulk` | `shipId, blastMarkerIds` |
| `grapple` | `defenderId, attackerIds` (formed or joined) |
| `grapple_ended` | `defenderId, shipId` (the ship whose loss ended it) |
| `teleport` | `shipId, targetId, rolls, saveRolls?, result: "failed" \| "saved" \| "critical"` |
| `bm_removal` | `rolls, removed` |
| `skipped` | `item` |
| `game_end` | `reason, scores, winner` |

`actor` is the player whose transform led to the entry, or `null` for housekeeping.

---

## 13. Worked example

Round 2, Unclean's turn (`playerTurn: 3`). Unclean is at `(100, 50)` heading 180; Agrippa is at `(76, 46)` heading 0, undamaged. Neither is on orders, and there are no BMs.

```json
{ "type": "fire", "player": "p2", "shipId": "ship-2", "weaponId": "starboard_battery", "target": { "kind": "ship", "id": "ship-1" } }
```

1. **Validation.** Bearing Unclean → Agrippa is `atan2deg(−24, −4) ≈ 260.5°`. Relative to heading 180 that's 80.5°, which is **right**, so the starboard battery bears. Range ≈ 24.3 cm ≤ 45. Agrippa is the only enemy, so it's the nearest.
2. **Handler.** No priority test. Add `starboard_battery` to `weaponsFired`. Queue: `[brace_offer(ship-1), direct_fire(…)]`.
3. **`brace_offer`.** Agrippa can brace → `pending = [brace for p1]`, and `settle` returns. **The state is now at rest, waiting on p1.**
4. **p1 sends** `{ type: "answer_brace", player: "p1", pendingId: "pend-40", attempt: false }`. The reducer logs the decline and pops the decision; `settle` then runs `direct_fire`.
5. **Gunnery.**
   - Aspect: bearing Agrippa → Unclean is 80.5°, relative to heading 0 → right, so **abeam**.
   - Column: capital ship abeam → **D**. 24.3 cm is in the middle band and there are no BMs, so no shift.
   - Dice: `gunnery(10, D)` = **4 dice**, needing **5+** (side armour).
6. **Rolls** `[6, 2, 5, 3]` → **2 hits**.
7. **Shields.** Capacity 2 → both absorbed. Two BMs go on Agrippa's ring, at θ0 ≈ 80.5° and θ0 + 52° ≈ 132.5°. Agrippa's shield capacity is now 0, and any battery that fires at it next takes a right shift for the BMs.
8. **Log.**
   ```
   brace_check { shipId: ship-1, declined: true }
   attack { source: {kind:"ship",id:"ship-2"}, targetId: ship-1, weapon: "battery", column: "D", shifts: 0, need: 5, rolls: [6,2,5,3], rerolls: [], hits: 2 }
   shields { shipId: ship-1, absorbed: 2, blastMarkerIds: ["bm-21", "bm-22"] }
   ```

---

## 14. Rulings introduced here

| # | Ruling |
|---|---|
| R1 | The "BM goes between the target and an adjacent ship" sub-rule (p. 68) isn't modelled. Shield BMs always fan around the target from the line of fire. |
| R2 | A ship at 0 hits makes no further critical checks. Overkill hits are discarded (state D7). |
| R3 | Hits on a hulk: one catastrophic re-roll per source (ship, salvo or explosion) per player turn. |
| R4 | A hulk re-roll of 2–8 switches drifting ⇄ blazing, but places no extra BM. |
| R5 | Hulks don't hit back when rammed. |
| R6 | A salvo loses strength for hits **scored**, even if Brace then saves them. |
| R7 | On a facing boundary with no player choice (torpedoes, rams), the attacker gets the **lower** armour. |
| R8 | A ship braced over All Ahead Full / Come To New Heading / Burn Retros halves its firepower **once**, for Brace. The replaced order's movement rules persist; its firepower penalty doesn't stack. |
| R9 | Explosion radius is measured to the stem: a ship is hit if its stem is within 3D6 cm. |
| R10 | Explosion BMs form a cluster (§5.2); a new hulk's BM sits on its stem. |
| R11 | Boarding critical checks are separate work items, losers first: an explosion set off by one resolves, with its brace offers, before the next check. |
| R12 | A ship boarded to 0 becomes a drifting hulk with its BM on the stem, like any new hulk, and rolls no catastrophic damage (p. 90). Damage beyond 0 is discarded. |
| R13 | A ship that stops being `active` leaves its grapple; a grapple that loses its defender or its last attacker dissolves (§7.4). |
| R14 | Grappled ships aren't re-checked for base contact: nothing moves them while they're locked together. |
| R15 | A teleport attack's brace save is rolled after the Hit-and-Run roll, and only if that roll would cause a critical. |

## 15. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Do brace-saved torpedo hits still cost the salvo strength? | Yes (R6). The torpedoes hit something; they just didn't do the job. |
| D2 | Brace over a firepower-halving order: halve once or twice? | Once (R8). It's more fun. |
| D3 | Explosion range measured to the stem or to the base edge? | The stem (R9). |

No open questions at v0.4.
