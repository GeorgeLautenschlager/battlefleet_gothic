# Transform Specification

**Status:** draft v0.1, for discussion. **Scope:** Phase 1 (Cruiser Clash, Lunar vs Murder, hot-seat). Builds on [Game State v0.4](../game_state/SPEC.md).

A **transform** is plain data describing one proposed change to the game state: one player decision. This document lists every transform, says when each one is legal, and summarises what the reducer does with it.

| | Defined here | Defined in the validator / reducer specs |
|---|---|---|
| Validator | Preconditions for each transform, in prose | Check order, reason codes, geometry helpers (contact, arcs, swept bases) |
| Reducer | Effect summary and **dice draw order** for each transform | Full resolution algorithms (gunnery, Blast Marker placement, criticals, catastrophic damage) |

Section references like "state §9" point at the game state spec.

---

## 1. Principles

1. **One transform = one player decision.** Anything with no choice in it (moving torpedoes in a straight line, burning fires, advancing to the next step) is done by the reducer, not by a transform. The only exception is §2.4: some no-choice actions still get a transform so the owner picks their *order*.
2. **The validator never rolls dice.** Whether a transform is legal depends only on the state and the transform. If the outcome depends on a roll (a Command check, a target-priority test), the transform is legal and the reducer resolves the roll. A failed roll is an outcome, not a validation error.
3. **Dice are drawn in a fixed order.** Each transform's reducer summary lists its draws in order. Replays depend on it, so the reducer spec may add detail but must not reorder.
4. **The reducer always logs.** Every transform appends at least one log entry; every die drawn appears in some entry's `rolls`.

---

## 2. Shared structure

### 2.1 Envelope

```ts
type Transform = { type: TransformType, player: PlayerId } & Payload
```

`player` is the player submitting it. It must equal `actor(state)` (state §12), except for `answer_brace`, where it must equal the pending decision's `player` (which is what `actor` returns anyway).

### 2.2 Gates every transform passes first

Checked in this order before any transform-specific check:

1. **Well-formed**: known `type`, required fields present with the right JSON types, no extra fields.
2. **Game not over**: `clock.stage ≠ "ended"`.
3. **Pending first**: if `pending` is non-empty, the only legal transform is `answer_brace` for the top entry.
4. **Right player**: `player = actor(state)`.
5. **Right moment**: the transform is allowed in the current `stage` / `setupStep` / `step` (catalogue in §3).

### 2.3 Automatic advancement

After every reduce, once `pending` is empty, the reducer runs this loop:

```
while stage ≠ "ended" and pending is empty and stepComplete(state):
    advance to the next step (running its entry housekeeping)
check for game end
```

`stepComplete` is defined per step in the table below. Steps with optional actions end only when the player sends `end_step`. Entry housekeeping can push a brace decision, so the loop stops and picks up again after the answer. Housekeeping runs **on entering** a step, so it never runs twice.

| Stage / step | Who acts | Transforms | `end_step`? | Complete when | Entry housekeeping |
|---|---|---|---|---|---|
| setup / `roll_leadership` | either | `roll_leadership` | no | rolled | — |
| setup / `roll_zones` | either | `roll_zones` | no | zones assigned | — |
| setup / `roll_deploy_order` | either | `roll_deploy_order` | no | `firstDeployer` set | — |
| setup / `deploy` | next deployer | `deploy_ship` | no | no `undeployed` ships | — |
| setup / `roll_first_turn` | either | `roll_first_turn` | no | `firstTurnChooser` set | — |
| setup / `choose_first_turn` | chooser | `choose_first_turn` | no | `firstPlayer` set | on leaving: start the battle (§2.5) |
| movement / `hulks_drift` | active | `drift_hulk` | no | every active-player hulk has `drifted` | — |
| movement / `move_ships` | active | `declare_order`, `move` | no | every active-player `active` ship has `moved` | — |
| shooting / `direct_fire` | active | `fire` | **yes** | no active-player ship has an unfired, undisabled battery or lance | — |
| shooting / `launch_ordnance` | active | `launch_torpedoes` | **yes** | no active-player ship can launch (§4.3) | — |
| ordnance / `active_ordnance` | active | `move_ordnance` | no | every active-player salvo moved this step | reset `ordnanceMoved` |
| ordnance / `inactive_ordnance` | inactive | `move_ordnance` | no | every inactive-player salvo moved this step | reset `ordnanceMoved` |
| end / `boarding` | — | — | no | always (Phase 1: `options.boarding = false`) | — |
| end / `damage_control` | ship owners | `repair` | no | every ship needing repair has `repaired` (§4.6) | — |
| end / `blast_marker_removal` | active | `remove_blast_markers` | no | `blastMarkersRemoved`, or nothing is removable | **fires burn** (§4.6) |
| leaving `blast_marker_removal` | | | | | end the player turn (§2.5) |

Movement and Ordnance steps have no `end_step`: every ship must move (p. 53) and torpedoes must move their full speed (p. 201).

### 2.4 Owner-ordered automatic actions

`drift_hulk` and `move_ordnance` contain no real decision except **which goes first**, and with several hulks or salvoes the order can matter (which ship a salvo reaches first, where Blast Markers land). They're still transforms, but have no payload beyond the id.

### 2.5 Turn boundaries

**Start the battle** (leaving `choose_first_turn`): `stage = "battle"`, `playerTurn = 1`, then *start a player turn*.

**Start a player turn**: reset `turnState` for the new `playerTurn` (state §8), remove the active player's orders whose `expires = { playerTurn ≤ now, at: "movement_start" }`, enter `movement / hulks_drift`.

**End a player turn** (leaving `blast_marker_removal`): remove every order whose `expires = { playerTurn: now, at: "turn_end" }`. If `playerTurn = 2 × maxRounds`, the game ends. Otherwise `playerTurn += 1` and *start a player turn*.

**Game end** is also checked after every reduce, once `pending` is empty: if either side has no ship with `status = "active"`, the game ends at once (state D6). Ending sets `stage = "ended"`, clears `activation`, and fills in `result` from `score()` (higher score wins, equal is a draw).

### 2.6 When the reducer offers a Brace

Wherever a summary below says **offer brace (X)**, the reducer checks whether ship X can brace. If it can, it pushes a `brace` pending decision (state §9.2) carrying the rest of the resolution as `resume`, and stops. If it can't, resolution simply carries on.

Ship X **can brace** when it is `active` (not a hulk), its `specialOrder` is not already Brace For Impact!, and `turnState.braceFailures` has no entry for X against the current source.

Brace is offered **before** every roll that can damage a ship: direct-fire to-hit rolls, torpedo attacks (before turrets), rams (target first, then rammer), explosion lance hits, and a 0-shield ship's Blast Marker roll. It is **not** offered against fire damage or critical extra damage, which follow from hits already rolled, nor in boarding (p. 66).

---

## 3. Catalogue

| Transform | Payload | Stage / step |
|---|---|---|
| `roll_leadership` | — | setup / `roll_leadership` |
| `roll_zones` | — | setup / `roll_zones` |
| `roll_deploy_order` | — | setup / `roll_deploy_order` |
| `deploy_ship` | `shipId`, `position` | setup / `deploy` |
| `roll_first_turn` | — | setup / `roll_first_turn` |
| `choose_first_turn` | `goFirst` | setup / `choose_first_turn` |
| `drift_hulk` | `shipId` | movement / `hulks_drift` |
| `declare_order` | `shipId`, `order`, `ramTargetId?` | movement / `move_ships` |
| `move` | `shipId`, `path`, `disengage` | movement / `move_ships` |
| `fire` | `shipId`, `weaponId`, `target`, `arc?`, `aspect?` | shooting / `direct_fire` |
| `launch_torpedoes` | `shipId`, `weaponId`, `bearing` | shooting / `launch_ordnance` |
| `move_ordnance` | `ordnanceId` | ordnance / either step |
| `repair` | `shipId`, `priority` | end / `damage_control` |
| `remove_blast_markers` | `priority` | end / `blast_marker_removal` |
| `answer_brace` | `pendingId`, `attempt` | any, while `pending` is non-empty |
| `end_step` | — | shooting / `direct_fire` or `launch_ordnance` |

---

## 4. Transforms

Each entry: **payload**, **legal when** (beyond the gates in §2.2), and **reducer** (effect summary, dice in draw order).

### 4.1 Setup

#### `roll_leadership`
- **Payload:** none.
- **Reducer:** for each ship in `ships` order, draw 1D6 and set `leadership` from the table (1 → 6, 2–3 → 7, 4–5 → 8, 6 → 9). Sets `setup.leadershipRolled`.

#### `roll_zones`
- **Reducer:** draw 1D6 for p1 → `zoneRoll`. 1–3: p1 in A, p2 in B; 4–6: the reverse.

#### `roll_deploy_order`
- **Reducer:** draw 1D6 for p1, then 1D6 for p2; append to `deployOrderRolls`. If they differ, the **lower** roller is `firstDeployer`. A tie leaves the step open for another `roll_deploy_order`.

#### `deploy_ship`
```ts
{ type: "deploy_ship", player, shipId: string, position: Point }
```
- **Legal when:** the ship belongs to `player` and is `undeployed`; `player` is the next deployer (state §5); `position` (the stem) lies inside the player's zone.
- **Reducer:** `status = "active"`, `position` as given, `heading = scenario.deploymentFacing[zone]`. There's no heading in the payload: Cruiser Clash ships must face the opposite long edge.

#### `roll_first_turn`
- **Reducer:** draw 1D6 for p1, then p2; append to `firstTurnRolls`. The higher roller is `firstTurnChooser`. A tie leaves the step open.

#### `choose_first_turn`
```ts
{ type: "choose_first_turn", player, goFirst: boolean }
```
- **Reducer:** `firstPlayer` = `player` if `goFirst`, else the other player. Then start the battle (§2.5).

### 4.2 Movement

#### `drift_hulk`
```ts
{ type: "drift_hulk", player, shipId: string }
```
- **Legal when:** the ship is the active player's, a hulk, and hasn't `drifted` this turn.
- **Reducer:** draw 4D6; the hulk moves that far straight ahead, resolving contacts along the way like a ship move (torpedoes attack it; hulks can't brace). If it leaves the table it becomes `destroyed`. Otherwise place 1 Blast Marker in contact with its base. If it's a `blazing_hulk`, then draw 2D6 on the Catastrophic Damage table and apply the result (an explosion offers brace to each ship in range). Sets `drifted`.

#### `declare_order`
```ts
{
  type: "declare_order", player,
  shipId: string,
  order: "all_ahead_full" | "come_to_new_heading" | "burn_retros" | "lock_on" | "reload_ordnance",
  ramTargetId?: string        // only with all_ahead_full
}
```
- **Legal when:**
  - `activation` is null, and the ship is the active player's, `active`, and hasn't `moved`;
  - `turnState.commandCheckFailed` is false (p. 48);
  - the ship has no live `specialOrder` (in practice, a Brace carried over from last turn blocks it, p. 66);
  - `ramTargetId` only with `all_ahead_full` and `options.ramming`, and it names an enemy ship on the table.

  Brace For Impact! is never declared here; it only arises through `answer_brace`.
- **Reducer:** draw **2D6** Command check against `commandCheckLd` (state §11).
  - **Pass:** set `specialOrder` with its expiry (state §7.3). `reload_ordnance` sets every `loaded` flag to `true` at once. For `all_ahead_full`: if there's a ram target, draw **3D6 / 2D6 / 1D6** for the ram Leadership test (target smaller / same / larger type, p. 55; pass if ≤ Ld), then draw **4D6** for `aafExtra`.
  - **Fail:** `commandCheckFailed = true`; the ship moves with no order.

  Either way, open an `activation` with `stage: "ordered"` (state §9.1) and fill in `maxDistance`, `minDistance` and `ram`.

#### `move`
```ts
{
  type: "move", player,
  shipId: string,
  path: PathStep[],           // state §9.1; [] = stay put (Burn Retros only)
  disengage: boolean          // take a disengage test at the end of the move
}
```
- **Legal when:**
  - the ship is the active player's, `active`, and hasn't `moved`;
  - `activation` is null (no order), or is `stage: "ordered"` **for this ship**.
  - **Path shape:** every `advance.distance > 0`; every `turn.degrees ≠ 0` with `|degrees| ≤ profile.turns`.
  - **Turns:** the number of turn steps is ≤ `turnsAllowed`. That's 0 for AAF and Lock On, 2 for Come To New Heading, 1 otherwise, and 0 with Engine Room damage.
  - **Distance before turning:** before each turn, the forward distance since the start or the previous turn is ≥ 10 cm (cruiser) / 15 cm (battleship) / 0 (escort). Burn Retros' only turn is exempt (p. 54).
  - **Blast Markers:** if the swept base touches any Blast Marker (including moving off one it started on), the limit drops by 5 cm, once (p. 69).
  - **Maximum:** total advance ≤ `maxDistance` (after the BM reduction).
  - **Minimum:** total advance ≥ `min(minDistance, maxDistance after BM reduction)`. All Ahead Full must use its full distance, unless its base touches a Blast Marker within the last 5 cm. In that case the path must end exactly at the first point of contact (p. 69).
  - **Table edge:** if the stem crosses the table edge, that must happen in the last step, and the path must not go back onto the table. The ship disengages there, and the minimum doesn't apply.
  - **Disengage flag:** `disengage` must be false if the path leaves the table.
- **Reducer:** execute the path from the start, in order of contact along each advance:
  - **Ram target base** (if `ram.testPassed` and not yet `resolved`): stop at contact. Offer brace (target), then offer brace (rammer). Draw **D6 × rammer's starting hits** against the target's armour on the struck facing. Then draw **D6 × target's starting hits** (head-on or Defence) or **half** (side/rear), rounded up, against the rammer's **front** armour. Shields don't apply. Damage, criticals and catastrophic damage resolve as in the reducer spec. Set `ram.resolved`.
  - **Torpedo salvo** (any owner; a salvo ignores its own launcher during its launch turn): the salvo attacks the ship (as `move_ordnance`, minus the salvo's own move).
  - **Blast Marker, first contact:** if the ship has 0 shields, offer brace, then draw **1D6**; a 6 is 1 damage (once per move).
  - **Table edge:** `status = "disengaged"`, `position`/`heading` null, stop.

  If a decision is pushed mid-path, the activation becomes `stage: "suspended"` with `remainingPath`. The reducer carries on by itself once `pending` empties, and ends the move early if the next step is no longer legal (state §9.1).

  **At the end of the move:** write `lastMove`. If `disengage`, draw **2D6** against Ld with these modifiers (p. 56): +1 per Blast Marker within 5 cm, −1 per enemy ship or salvo within 15 cm, cap 10, 11–12 always fail. "Within" means stem to centre. Pass: `disengaged`. Fail: `turnState.ships[id].disengage = "failed"`. Then set `moved` and clear `activation`.

### 4.3 Shooting

#### `fire`
```ts
{
  type: "fire", player,
  shipId: string,
  weaponId: string,           // a battery or lance
  target: { kind: "ship" | "ordnance", id: string },
  arc?: Quadrant,             // required only when the target is on an arc boundary of the firer
  aspect?: Quadrant           // required only when the firer is on a quadrant boundary of the target ship
}
```
- **Legal when:**
  - **Shooter:** the active player's, `active`, and its disengage test didn't fail this turn.
  - **Weapon:** a `battery` or `lance` not in `weaponsFired` and not disabled by a critical.
  - **Target:** an enemy ship on the table (hulks included), or an enemy torpedo salvo. Never a friendly hulk.
  - **Range:** stem-to-stem distance ≤ `range`.
  - **Arc:** the target's bearing from the shooter falls in one of the weapon's `arcs`. On a boundary, `arc` must be supplied, must be one of the two adjacent quadrants, and must be one of the weapon's arcs. `aspect` follows the same rule for the target's quadrant facing the shooter.
  - **Line of fire:** the stem-to-stem line doesn't cross the base of a hulk other than the target (p. 71).
  - **Target priority:** if `priorityTest = "failed"`, the target must be the **nearest** eligible target. That's the nearest non-hulk enemy ship, or the nearest enemy salvo when shooting at ordnance (p. 60, p. 75).
- **Reducer:**
  1. **Priority test** (Ld test on **2D6**, no modifiers; pass if ≤ Ld): only if the target isn't the nearest and `priorityTest` is null. On a fail, record `"failed"`. The shot doesn't happen and the weapon isn't spent, so the player can fire it at the nearest target instead. On a pass, record `"passed"` and carry on.
  2. **Offer brace** (target), if it's a ship.
  3. **To hit:** draw the dice. Batteries roll the Gunnery Table result with column shifts; lances roll 1D6 per point of strength. Strength is `effectiveStrength` (state §11). A hit is ≥ armour on the aspect facing (batteries), 4+ (lances), or 6 (any weapon against ordnance). Lock On re-rolls the misses, drawn straight after the first roll.
  4. **Against ordnance:** any hit removes the salvo.
  5. **Against a ship:**
     - Shields absorb hits up to `shieldCapacity`; a Blast Marker is placed for each.
     - If braced, draw **1D6 per remaining hit**; each 4+ is saved.
     - Each unsaved hit is 1 damage, with a critical check per point (**1D6**; on a 6, draw **2D6** on the table, plus any extra-damage dice).
     - Catastrophic damage if the ship reaches 0 hits.
  6. Add `weaponId` to `weaponsFired`.

  Phase 1 has **no split fire**: a weapon fires once, at one target, at full effective strength (ruling T1).

#### `launch_torpedoes`
```ts
{ type: "launch_torpedoes", player, shipId: string, weaponId: string, bearing: number }   // relative bearing, clockwise from the bow
```
- **Legal when:**
  - the ship is the active player's, `active`, its disengage test didn't fail, and `loaded.torpedoes` is true;
  - the weapon is `torpedoes`, not fired this turn, and not disabled;
  - `bearing` falls inside the weapon's arcs (Front = 315°–45°).
- **Reducer:** create a `TorpedoSalvo` at the launcher's stem with `heading = (ship.heading + bearing) mod 360` and `strength = effectiveStrength` (crippled and braced halve it, p. 65). Set `launched = playerTurn`, `loaded.torpedoes = false`, and add the weapon to `weaponsFired`. No dice.

#### `end_step`
```ts
{ type: "end_step", player }
```
- **Legal when:** the step is `direct_fire` or `launch_ordnance`, and `activation` is null.
- **Reducer:** advance (§2.3).

### 4.4 Ordnance

#### `move_ordnance`
```ts
{ type: "move_ordnance", player, ordnanceId: string }
```
- **Legal when:** the salvo belongs to the acting player (the active player in `active_ordnance`, the other one in `inactive_ordnance`) and isn't in `ordnanceMoved`.
- **Reducer:** move the salvo its full `speed` straight along `heading`. The swept segment resolves contacts in the order it meets them:
  - **Blast Marker, first one this move:** draw **1D6**; on a 6 the salvo is removed. One roll per move, and it covers BMs in contact with a target ship too (p. 75).
  - **Another torpedo salvo:** both are removed.
  - **A ship base** (friend, foe or hulk; never the launcher in the launch turn; never a ship it has already attacked this round):
    1. Offer brace (ship).
    2. Turrets: draw **1D6 per `turrets`**; each 4+ reduces strength by 1. If strength reaches 0, the salvo is removed.
    3. Attack: draw **1D6 per strength** against the armour of the facing struck first; shields are ignored.
    4. If braced, draw saves.
    5. Apply damage and criticals as for `fire`.
    6. Strength drops by the number of hits inflicted. Record the attack in `attacks`.
    7. Continue the move.
  - **Table edge:** the salvo is removed.

  Finally, add the salvo to `ordnanceMoved`. A salvo whose strength reaches 0 is removed.

### 4.5 Answering a Brace

#### `answer_brace`
```ts
{ type: "answer_brace", player, pendingId: string, attempt: boolean }
```
- **Legal when:** `pendingId` is the **top** pending entry's id, and `player` is its `player`.
- **Reducer:**
  - If `attempt`: draw **2D6** Command check against `commandCheckLd`.
    - **Pass:** `specialOrder` becomes Brace, with `replaced` = the previous order kind and expiry per state §7.3.
    - **Fail:** append to `braceFailures`. This doesn't set `commandCheckFailed` (state N4).
  - Pop the entry and run its `resume` list in order; it may push new decisions. If `pending` empties and a move activation is `suspended`, continue the move.

### 4.6 End Phase

#### `repair`
```ts
{ type: "repair", player, shipId: string, priority: string[] }   // critical ids, most important first
```
- **Legal when:**
  - it's the `damage_control` step, the ship is `player`'s and `active`, and it isn't `repaired` yet;
  - it has at least one repairable critical (not `bridge_smashed` / `shields_collapse`);
  - `priority` lists **every** repairable critical id on the ship exactly once.

  Either player may send `repair` during this step, for their own ships; `actor` is relaxed accordingly (state §12).
- **Reducer:** draw **1D6 per `remainingHits`**, halved and rounded up if the ship has Blast Markers in contact (p. 88). For each 6, remove the next critical in `priority`. Set `repaired`.

"Every ship needing repair" in §2.3 means every `active` ship, of either side, with a repairable critical.

**Fires burn** (entry housekeeping for `blast_marker_removal`, after both players' repairs): each of the **active player's** ships takes 1 damage per remaining `fire` critical (state N6). There's no critical check, since this is damage caused by a critical (p. 66), and no brace offer. Ships are processed in `ships` order, with catastrophic damage rolled for any that reach 0. Explosions can offer brace to nearby ships.

#### `remove_blast_markers`
```ts
{ type: "remove_blast_markers", player, priority: string[] }   // blast marker ids, removed first to last
```
- **Legal when:** `priority` lists **every** removable Blast Marker exactly once. A BM is removable if it isn't touching any ship base on the table (p. 88). If there are none, the step is complete before anyone acts.
- **Reducer:** draw **1D6**; remove the first `min(roll, priority.length)` markers. Set `blastMarkersRemoved`.

---

## 5. Creating a game

A new game is made by a factory, not a transform: there's no state to validate against yet.

```ts
newGame(config: GameConfig) → GameState

type GameConfig = {
  seed: number                               // uint32
  createdAt: string
  options?: { ramming?: boolean, boarding?: boolean }   // defaults: true, false
  players: {
    p1: { name: string, faction: FactionId },
    p2: { name: string, faction: FactionId }
  }
  ships: { owner: PlayerId, name: string, classId: string }[]
}
```

- Profiles come from a ship catalogue built from `rules/fleets/`. Phase 1 needs only `lunar` and `murder`, and no options.
- Cruiser Clash checks: 1–4 ships per side, the same number each, all `cruiser`, each ≤ 185 points (p. 128). A bad config throws; it never produces an invalid state.
- The result is at `stage: "setup"`, `setupStep: "roll_leadership"`, `playerTurn: 0`. Ships are `undeployed`, with ids `ship-1 … ship-n` in config order. `rng.state = seed`.

---

## 6. Rulings introduced here

| # | Ruling |
|---|---|
| T1 | No split fire in Phase 1: each weapon fires once per Shooting Phase, at one target. |
| T2 | Brace is offered before rolls that can damage a ship, not against fire damage, critical extra damage or boarding (§2.6). |
| T3 | Repairs are mandatory, and the player chooses the order up front. There's no downside to rolling, so there's no "decline". |
| T4 | A torpedo salvo ignores its own launcher during the player turn it was launched. Otherwise it would hit the launcher it starts on. |
| T5 | "Within X cm" for disengage modifiers is measured stem to marker or salvo centre. |
| T6 | A ship that moves into a torpedo salvo is attacked by it, whoever owns the salvo. This matches "torpedoes hit friends too". |
| T7 | Head-on ram = the rammer's stem lies in the target's front quadrant. |

## 7. Open questions

- **Q1. Friendly torpedoes and moving ships (T6).** p. 75 talks about ships moving into **enemy** ordnance. Should a ship that sails into its *own* salvo be attacked, or only when the salvo moves into it?
- **Q2. Ramming hulks.** Nothing forbids it, so `ramTargetId` accepts enemy hulks. Keep that, or restrict ramming to active ships?
