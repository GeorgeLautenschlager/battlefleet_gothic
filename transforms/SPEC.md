# Transform Specification

**Status:** draft v0.14, for discussion. **Scope:** Cruiser Clash (1–4 cruisers a side; one carrier each as an option). Builds on [Game State v0.16](../game_state/SPEC.md). v0.5 added boarding actions, grapples and teleport attacks (pp. 89–92). v0.6 adds attack craft (pp. 73–87): `launch_attack_craft`, attack craft moves, Combat Air Patrol and `release_cap`, massed turrets, and the carriers option (§2.3, §2.6, §4.2–4.4, §5, T17–T31, D8–D12). v0.7 adds combined battery fire (`fire.combineWith`, T32–T33), the remaining Cruiser Clash cruisers, and class traits (§5, T34–T35, D13–D14). v0.8 adds points battles and the scoring choice (§5, T36–T39, D15–D16). v0.9 adds the nova cannon (pp. 63–64): `fire_nova_cannon` and the ship options that carry one (§2.3, §2.6, §4.3, §5, T40–T48, D17–D19). v0.10 adds the Fleet Engagement scenario (pp. 142–143): `choose_formation`, `roll_setup`, `choose_setup`, divisions at deployment, and no round limit (§2.3, §2.5, §3, §4.1, §5, T49–T55, D20–D23). v0.11 adds battlecruisers and heavy cruisers, per-ship options, the Gothic War fleet lists, fleet commanders, re-rolls (`reroll` on four transforms) and the Marks of Chaos (§2.7, §3, §4.2–4.3, §4.5, §5, T56–T66, D24–D27). v0.12 adds the Gothic War lists' grand and light cruisers, the Repulsive and the Dauntless, with their options and the grand cruisers' ratio (§5, T67–T70, D28–D29). v0.13 adds the Gothic War lists' battleships, their options (some exclusive), the battleship ratio, and the ban on Come to New Heading (§4.2, §5, T71–T74, D30–D31). v0.14 adds escorts and squadrons, escort and capital: squadron Leadership, deployment, orders, moves, brace, disengaging, shooting by and at squadrons (`fire.withShips`, `fire.targetAspect`), escorts in boarding and teleport attacks, and the six Gothic War escorts (§2.6, §4.1–4.3, §4.5–4.6, §5, T75–T92, D32–D35).

A **transform** is plain data describing one proposed change to the game state: one player decision. This document lists every transform, says when each one is legal, and summarises what the reducer does with it.

| | Defined here | Defined in the validator / reducer specs |
|---|---|---|
| Validator | Preconditions for each transform, in prose | [validator/SPEC.md](../validator/SPEC.md): check order, reason codes, geometry helpers (contact, arcs, swept bases) |
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
| setup / `choose_formation` | p1, then p2 | `choose_formation` | no | both formations chosen | — |
| setup / `roll_setup` | either | `roll_setup` | no | `setupChooser` set | — |
| setup / `choose_setup` | set-up chooser | `choose_setup` | no | `map` set | — |
| setup / `roll_deploy_order` | either | `roll_deploy_order` | no | `firstDeployer` set | — |
| setup / `deploy` | next deployer | `deploy_ship` | no | no `undeployed` ships | — |
| setup / `roll_first_turn` | either | `roll_first_turn` | no | `firstTurnChooser` set | — |
| setup / `choose_first_turn` | chooser | `choose_first_turn` | no | `firstPlayer` set | on leaving: start the battle (§2.5) |
| movement / `hulks_drift` | active | `drift_hulk` | no | every active-player hulk has `drifted` | — |
| movement / `move_ships` | active | `declare_order`, `move`, `release_cap` | no | every active-player `active` ship has `moved` | grappled ships stay put (state §6) |
| shooting / `direct_fire` | active | `fire`, `fire_nova_cannon` | **yes** | no active-player ship has an unfired, undisabled battery, lance or nova cannon it could fire (a nova cannon can't while `novaCannonBarred`, state §11) | — |
| shooting / `launch_ordnance` | active | `launch_torpedoes`, `launch_attack_craft` | **yes** | no active-player ship can launch torpedoes or attack craft (§4.3) | — |
| ordnance / `active_ordnance` | active | `move_ordnance` | no | every active-player salvo and wave (CAP aside) moved this step | reset `ordnanceMoved` |
| ordnance / `inactive_ordnance` | inactive | `move_ordnance` | no | every inactive-player salvo and wave (CAP aside) moved this step | reset `ordnanceMoved` |
| end / `boarding` | active | `board`, `teleport` | **yes** | `options.boarding` is off; or no boarding action is left to fight (§4.6) and no ship can teleport | **grapples fight** (§4.6) |
| end / `damage_control` | ship owners | `repair` | no | every ship needing repair has `repaired` (§4.6) | — |
| end / `blast_marker_removal` | active | `remove_blast_markers` | no | `blastMarkersRemoved`, or nothing is removable | **fires burn** (§4.6) |
| leaving `blast_marker_removal` | | | | | end the player turn (§2.5) |

Cruiser Clash goes `roll_leadership` → `roll_zones` → `roll_deploy_order`. Fleet Engagement replaces `roll_zones` with `choose_formation` → `roll_setup` → `choose_setup`; the rest is the same (p. 142: lowest roll deploys first, alternating; first turn by roll-off).

Movement and Ordnance steps have no `end_step`: every ship must move (p. 53), torpedoes must move their full speed (p. 201), and an attack craft wave that stays put still sends a `move_ordnance` with an empty path. CAP fighters don't count: they stay with their ship unless their owner moves them off CAP (§4.4).

### 2.4 Owner-ordered automatic actions

`drift_hulk` and `move_ordnance` contain no real decision except **which goes first**, and with several hulks or salvoes the order can matter (which ship a salvo reaches first, where Blast Markers land). They're still transforms, but have no payload beyond the id.

### 2.5 Turn boundaries

**Start the battle** (leaving `choose_first_turn`): `stage = "battle"`, `playerTurn = 1`, then *start a player turn*.

**Start a player turn**: reset `turnState` for the new `playerTurn` (state §8), remove the active player's orders whose `expires = { playerTurn ≤ now, at: "movement_start" }`, enter `movement / hulks_drift`.

**End a player turn** (leaving `blast_marker_removal`): remove every order whose `expires = { playerTurn: now, at: "turn_end" }`. If `maxRounds` is set and `playerTurn = 2 × maxRounds`, the game ends. Fleet Engagement has no round limit (state N17). Otherwise `playerTurn += 1` and *start a player turn*.

**Game end** is also checked after every reduce, once `pending` is empty: if either side has no ship with `status = "active"`, the game ends at once (state D6). Ending sets `stage = "ended"`, clears `activation`, and fills in `result` from `score()` (higher score wins, equal is a draw). `score()` is Cruiser Clash points or victory points, per `scenario.scoring` (state §11).

### 2.6 When the reducer offers a Brace

Wherever a summary below says **offer brace (X)**, the reducer checks whether ship X can brace. If it can, it pushes a `brace` pending decision (state §9.2) and stops; the rest of the resolution waits in the work queue (state §9.3, [reducer §1](../reducer/SPEC.md#1-the-work-queue)). If it can't, resolution simply carries on.

Ship X **can brace** when it is `active` (not a hulk), its `specialOrder` is not already Brace For Impact!, and `turnState.braceFailures` has no entry for X against the current source.

**Squadrons** (p. 95, state N38): a squadron braces together. The offer goes to one member in formation (the attack's first target among them, else the first in `shipIds`), and its answer covers every member in formation. A volley at a squadron makes one offer, not one per ship (T86).

Brace is offered **before** every roll that can damage a ship: direct-fire to-hit rolls, torpedo attacks (before turrets), rams (target first, then rammer), explosion lance hits, and a 0-shield ship's Blast Marker roll. It is also offered before an **attack craft** attack on a ship (before turrets, like torpedoes), before a **nova cannon**'s scatter roll to every ship it could reach (T41), and before a **teleport attack**'s roll, since Brace protects against Hit-and-Run critical damage (p. 66). It is **not** offered against fire damage or critical extra damage, which follow from hits already rolled, nor in a boarding action (p. 66, p. 90).

### 2.7 Fleet commander re-rolls

A failed Command check or Leadership test may be re-rolled with a fleet commander re-roll (fleets book, p. 11). The decision is made **up front**: the transform whose roll it is carries `reroll: true`, meaning "if this fails, re-roll it". It's the same choice as deciding after the dice, since a re-roll is only ever worth spending on a failure, and it saves a round trip (state §1, principle 7).

- `declare_order.reroll`: the Command check, and the ram target's Leadership test.
- `move.reroll`: the disengage test.
- `fire.reroll`: the target-priority test.
- `answer_brace.reroll`: the brace Command check.

Each failed test of the transform uses one re-roll, from `rerollFor(ship)` (state §11), while one is left: its dice are drawn again straight after the failure, and the second result stands. A test is never re-rolled twice (p. 11). `reroll: true` with no re-roll available is refused (`NO_REROLL`); a test that passes spends nothing.

---

## 3. Catalogue

| Transform | Payload | Stage / step |
|---|---|---|
| `roll_leadership` | — | setup / `roll_leadership` |
| `roll_zones` | — | setup / `roll_zones` |
| `choose_formation` | `formation` | setup / `choose_formation` |
| `roll_setup` | — | setup / `roll_setup` |
| `choose_setup` | `map`, `colour` | setup / `choose_setup` |
| `roll_deploy_order` | — | setup / `roll_deploy_order` |
| `deploy_ship` | `shipId`, `position` | setup / `deploy` |
| `roll_first_turn` | — | setup / `roll_first_turn` |
| `choose_first_turn` | `goFirst` | setup / `choose_first_turn` |
| `drift_hulk` | `shipId` | movement / `hulks_drift` |
| `declare_order` | `shipId`, `order`, `ramTargetId?`, `reroll?` | movement / `move_ships` |
| `move` | `shipId`, `path`, `disengage`, `boardTargetId?`, `reroll?` | movement / `move_ships` |
| `release_cap` | `ordnanceId` | movement / `move_ships` |
| `fire` | `shipId`, `weaponId`, `combineWith?`, `target`, `arc?`, `aspect?`, `reroll?`, `withShips?`, `targetAspect?` | shooting / `direct_fire` |
| `fire_nova_cannon` | `shipId`, `weaponId`, `aim` | shooting / `direct_fire` |
| `launch_torpedoes` | `shipId`, `weaponId`, `bearing` | shooting / `launch_ordnance` |
| `launch_attack_craft` | `shipId`, `waves`, `recall` | shooting / `launch_ordnance` |
| `move_ordnance` | `ordnanceId`, `path?`, `cap?` | ordnance / either step |
| `board` | `targetId`, `together`, `priority` | end / `boarding` |
| `teleport` | `shipId`, `targetId` | end / `boarding` |
| `repair` | `shipId`, `priority` | end / `damage_control` |
| `remove_blast_markers` | `priority` | end / `blast_marker_removal` |
| `answer_brace` | `pendingId`, `attempt`, `reroll?` | any, while `pending` is non-empty |
| `end_step` | — | shooting / `direct_fire` or `launch_ordnance`; end / `boarding` |

---

## 4. Transforms

Each entry: **payload**, **legal when** (beyond the gates in §2.2), and **reducer** (effect summary, dice in draw order).

### 4.1 Setup

#### `roll_leadership`
- **Payload:** none.
- **Reducer:** for each ship in `ships` order, draw 1D6 and set `leadership` from the table (1 → 6, 2–3 → 7, 4–5 → 8, 6 → 9). An escort whose squadron has already rolled takes that value without a draw: escort squadrons roll once (p. 45). Sets `setup.leadershipRolled`.

#### `roll_zones`
- **Reducer:** draw 1D6 for p1 → `zoneRoll`. 1–3: p1 in A, p2 in B; 4–6: the reverse.

#### `choose_formation`
```ts
{ type: "choose_formation", player, formation: "sphere" | "wedge" | "cross" }
```
- **Legal when:** Fleet Engagement, and `player` hasn't picked yet: p1 first, then p2 (state §12). Formations are picked on the honour system (state N16).
- **Reducer:** set `engagement.formations[player]`. No dice. The log entry doesn't name the formation until both are in (T50).

#### `roll_setup`
- **Reducer:** draw 1D6 for p1, then 1D6 for p2. On a split (`isSplit`, state §11) each adds `setupBonus`; on a plain B neither does (state N19). Append `{ rolls, bonus }` to `setupRolls`. The higher total is `setupChooser`; a tie leaves the step open for another `roll_setup`.

#### `choose_setup`
```ts
{ type: "choose_setup", player, map: "A" | "B" | "C" | "D", colour: "white" | "dark" }   // colour: the chooser's own
```
- **Legal when:** `player` is `setupChooser`, and `{ map, colour }` is one of the two `setupOptions` from the chooser's side.
- **Reducer:** set `engagement.map` and `engagement.colours` (the other player takes the other colour). No dice.

#### `roll_deploy_order`
- **Reducer:** draw 1D6 for p1, then 1D6 for p2; append to `deployOrderRolls`. If they differ, the **lower** roller is `firstDeployer`. A tie leaves the step open for another `roll_deploy_order`.

#### `deploy_ship`
```ts
{ type: "deploy_ship", player, shipId: string, position: Point }
```
- **Legal when:** the ship belongs to `player` and is `undeployed`; `player` is the next deployer (state §5); `position` (the stem) lies inside one of `deploymentDivisions(player)` (state §11); while the player has no more undeployed ships than empty divisions, that division is an empty one (state N18); and its base doesn't overlap any already-deployed base (validator V5).
  - **Squadrons** (T80): while the player has a squadron partly deployed, the ship must be one of its members; it goes in the same division as the squadron's first member, with its stem within 15 cm of an already-deployed member's. For filling divisions (N18), a squadron counts as one.
- **Reducer:** `status = "active"`, `position` as given, `heading` = the division's heading. There's no heading in the payload: Cruiser Clash ships face the opposite long edge, and Fleet Engagement ships their division's arrow (p. 142).

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
  ramTargetId?: string,       // only with all_ahead_full
  reroll?: boolean            // re-roll a failed Command check, and a failed ram Leadership test (§2.7)
}
```
- **Legal when:**
  - `activation` is null, and the ship is the active player's, `active`, not grappled, and hasn't `moved`;
  - `turnState.commandCheckFailed` is false (p. 48);
  - the ship has no live `specialOrder` (in practice, a Brace carried over from last turn blocks it, p. 66);
  - `ramTargetId` only with `all_ahead_full` and `options.ramming`, and it names an enemy ship on the table.

  Brace For Impact! is never declared here; it only arises through `answer_brace`.
- **Reducer:** draw **2D6** Command check against `commandCheckLd` (state §11).
  - **Pass:** set `specialOrder` with its expiry (state §7.3). `reload_ordnance` sets every `loaded` flag to `true` at once. For `all_ahead_full`: if there's a ram target, draw **3D6 / 2D6 / 1D6** for the ram Leadership test (target smaller / same / larger type, p. 55; pass if ≤ Ld), then draw **4D6** for `aafExtra` (the class's `allAheadFullDice`, if it has one: 5D6 with improved thrusters, state N10).
  - **Fail:** `commandCheckFailed = true`; the ship moves with no order.

  Either way, open an `activation` with `stage: "ordered"` (state §9.1) and fill in `maxDistance`, `minDistance` and `ram`.
- **Squadrons** (state N37–N39, T81–T82): a ship in formation in a squadron that hasn't begun moving declares for the squadron.
  - The check is against the squadron's `commandCheckLd`. On a pass, every member in formation takes the order (Reload Ordnance reloads each). All Ahead Full draws its 4D6 once, for all of them; only the declaring ship may name a ram.
  - `turnState.squadronMove` is set with the order (null on a fail), `aafExtra` and the members in formation; the activation carries `squadronId`.
  - A member of a squadron that has begun moving can't declare: it already has the squadron's order (`SQUADRON_ORDERED`). A stray declares for itself (N36).

#### `release_cap`
```ts
{ type: "release_cap", player, ordnanceId: string }
```
- **Legal when:** the wave is the active player's CAP fighter, and it's the **start** of the Movement Phase: `activation` is null and no active-player ship has moved yet (grappled ships, set `moved` on entry, don't count) (p. 82).
- **Reducer:** `cap = null`. The fighter stays at the ship's stem as an ordinary wave, and moves in the Ordnance Phase. No dice.

#### `move`
```ts
{
  type: "move", player,
  shipId: string,
  path: PathStep[],           // state §9.1; [] = stay put (Burn Retros only)
  disengage: boolean,         // take a disengage test at the end of the move
  boardTargetId?: string,     // declare a boarding action against this ship (p. 89)
  reroll?: boolean            // re-roll a failed disengage test (§2.7)
}
```
- **Legal when:**
  - the ship is the active player's, `active`, and hasn't `moved`;
  - `activation` is null (no order), or is `stage: "ordered"` **for this ship**.
  - **Squadron moves** (state N37): while `squadronMove` is set, only its members that haven't `moved` may move (`SQUADRON_MOVING`). A member's limits use the squadron's order and `aafExtra` with its own speed.
  - **Disengaging escorts** (state N41): a member of a `disengaging` squadron must leave the table or have `disengage` true (`MUST_DISENGAGE`). In an escort squadron's move, every member's `disengage` is the same (`SQUADRON_DISENGAGE`).
  - **Path shape:** every `advance.distance > 0`; every `turn.degrees ≠ 0` with `|degrees| ≤ profile.turns`.
  - **Turns:** the number of turn steps is ≤ `turnsAllowed`. That's 0 for AAF and Lock On, 2 for Come To New Heading, 1 otherwise, and 0 with Engine Room damage.
  - **Distance before turning:** before each turn, the forward distance since the start or the previous turn is ≥ 10 cm (cruiser) / 15 cm (battleship) / 0 (escort). Burn Retros' only turn is exempt (p. 54).
  - **Blast Markers:** if the swept base touches any Blast Marker (including moving off one it started on), the limit drops by 5 cm, once (p. 69).
  - **Maximum:** total advance ≤ `maxDistance` (after the BM reduction).
  - **Minimum:** total advance ≥ `min(minDistance, maxDistance after BM reduction)`. All Ahead Full must use its full distance, unless its base touches a Blast Marker within the last 5 cm. In that case the path must end exactly at the first point of contact (p. 69).
  - **Table edge:** if the stem crosses the table edge, that must happen in the last step, and the path must not go back onto the table. The ship disengages there, and the minimum doesn't apply.
  - **Disengage flag:** `disengage` must be false if the path leaves the table.
  - **Boarding** (only with `boardTargetId`): `options.boarding` is on; the target is an enemy ship that is `active` (not a hulk), not grappled, and can be boarded (not on the Mark of Nurgle, state §7.4); the path doesn't leave the table and `disengage` is false; and at the path's end the two bases touch (inclusive, overlap counts; validator `basesTouch`). A ship can board only if it ends its move in base contact (p. 56, p. 89), so the declaration goes with the move that makes the contact (T8).
- **Reducer:** execute the path from the start, in order of contact along each advance:
  - **Ram target base** (if `ram.testPassed` and not yet `resolved`): stop at contact. Offer brace (target), then offer brace (rammer). Draw **D6 × rammer's starting hits** against the target's armour on the struck facing. Then draw **D6 × target's starting hits** (head-on or Defence) or **half** (side/rear), rounded up, against the rammer's **front** armour. Shields don't apply. Damage, criticals and catastrophic damage resolve as in the reducer spec. Set `ram.resolved`.
  - **Torpedo salvo** (any owner; a salvo ignores its own launcher during its launch turn): the salvo attacks the ship (as `move_ordnance`, minus the salvo's own move).
  - **Enemy attack craft wave** (not CAP): the wave meets the ship as in §4.4: CAP screens, turrets fire (unmassed: massing never helps during the Movement Phase, p. 80), and bombers and assault boats attack. A fighters-only wave has no effect and stays where it is (p. 82).
  - **CAP fighters ride along:** when the ship's move ends (or it pauses), its CAP fighters' `position` is set to its stem.
  - **Blast Marker, first contact:** if the ship has 0 shields, offer brace, then draw **1D6**; a 6 is 1 damage (once per move).
  - **Table edge:** `status = "disengaged"`, `position`/`heading` null, stop.

  If a decision is pushed mid-path, the rest of the path waits in `remainingPath`, with a `continue_move` work item queued behind the contact's resolution. The reducer carries on by itself once the decision is answered, and ends the move early if the next step is no longer legal (state §9.1).

  **At the end of the move:** write `lastMove`. If `disengage`, draw **2D6** against Ld with these modifiers (p. 56): +1 per Blast Marker within 5 cm, −1 per enemy ship or salvo within 15 cm, cap 10, 11–12 always fail. "Within" means stem to centre. Pass: `disengaged`. Fail: `turnState.ships[id].disengage = "failed"`.

  If the move declared a boarding action, it **stands** only if the ship completed its whole path (not truncated), is still `active`, and the target is still an `active`, ungrappled enemy whose base touches its own. Then set `boardingDeclared = boardTargetId`. Otherwise the declaration **lapses**: it's logged, and the ship may fire as normal (T8). No dice.

  Then set `moved` and clear `activation`.

  **In a squadron's move:** the first `move` of a squadron in formation with no order declared sets `squadronMove` with `order: null` and the members in formation, like `declare_order` does. Each member's own move then runs as above, except:
  - An **escort** squadron's disengage test is taken once, when its last member has moved (state N41): one **2D6** against `squadronLd`, modifiers counted over all members. Pass: every member still `active` is `disengaged`. Fail: each gets `disengage: "failed"`. An escort leaving the table edge sets `disengaging`.
  - A **capital** squadron's members test one by one, on their own Leadership (N44). A member that fails leaves the squadron (state §7.5).
  - When no member of `squadronMove` is left to move (moved, or no longer `active`), `squadronMove` is cleared.

### 4.3 Shooting

#### `fire`
```ts
{
  type: "fire", player,
  shipId: string,
  weaponId: string,           // a battery or lance
  combineWith?: string[],     // more of this ship's weapons batteries, fired in the same volley (T32)
  target: { kind: "ship" | "ordnance", id: string },
  arc?: Quadrant,             // required only when the target is on an arc boundary of the firer
  aspect?: Quadrant,          // required only when the firer is on a quadrant boundary of the target ship
  reroll?: boolean,           // re-roll a failed target-priority test (§2.7)
  withShips?: { shipId: string, weaponIds: string[] }[],   // squadron-mates' weapons joining the volley (T84)
  targetAspect?: "closing" | "moving_away" | "abeam"       // a squadron target: the aspect fired at (T85)
}
```
- **Legal when:**
  - **Shooter:** the active player's, `active`, its disengage test didn't fail this turn, it isn't grappled, and it hasn't declared a boarding action this turn (p. 89; drawn combats, pp. 90–91).
  - **Weapon:** a `battery` or `lance` not in `weaponsFired` and not disabled by a critical.
  - **Target:** an enemy ship on the table (hulks included), an enemy torpedo salvo, or an enemy attack craft wave that isn't on CAP (T27). Never a friendly hulk.
  - **Range:** stem-to-stem distance ≤ `range`.
  - **Arc:** the target's bearing from the shooter falls in one of the weapon's `arcs`. On a boundary, `arc` must be supplied, must be one of the two adjacent quadrants, and must be one of the weapon's arcs. `aspect` follows the same rule for the target's quadrant facing the shooter.
  - **Line of fire:** the stem-to-stem line doesn't cross the base of a hulk other than the target (p. 71).
  - **Combined batteries** (`combineWith`, T32): only with a battery as `weaponId`. Each id names another of the ship's weapons batteries, once, not fired and not disabled, with the target in its range and in one of its arcs.
  - **Squadron targets** (T83): a target ship in formation in a squadron means the squadron: its members in formation. At least one must be in range and arc of the volley. `targetAspect`, if given, must be the aspect of at least one such member. A stray, or a ship in no squadron, is a target on its own; `targetAspect` is refused for it.
  - **Squadron fire** (`withShips`, T84): the shooter is in formation in a squadron, and each entry names another member in formation, once, with weapons of the volley's kind (all batteries, or all lances), each once, not fired, not disabled, with the target in range and arc.
  - **Target priority:** if `priorityTest = "failed"`, the target must be **nearest** for this weapon (and for each combined battery). For a squadron target, it's nearest if any of its members in formation is. That's the nearest non-hulk enemy ship (or enemy salvo, when shooting at ordnance) that this weapon could legally engage. See [validator §2.7](../validator/SPEC.md#27-lines-of-fire-and-targeting) and ruling V1 (p. 60, p. 75).
- **Reducer:**
  1. **Priority test** (Ld test on **2D6**, no modifiers; pass if ≤ Ld): only if the target isn't the nearest (for any weapon in the volley) and `priorityTest` is null. On a fail, record `"failed"`. The shot doesn't happen and the weapon isn't spent, so the player can fire it at the nearest target instead. On a pass, record `"passed"` and carry on.
  2. **Offer brace** (target), if it's a ship.
  3. **To hit:** draw the dice. Batteries roll the Gunnery Table result with column shifts, for the **sum** of the volley's firepower (T32); lances roll 1D6 per point of strength. Strength is `effectiveStrength` (state §11), each battery halved on its own before they're added. A hit is ≥ armour on the aspect facing (batteries), 4+ (lances), or 6 (any weapon against ordnance). Lock On re-rolls the misses, drawn straight after the first roll.
  4. **Against ordnance:** any hit removes the salvo, or the **whole** attack craft wave (p. 85). A wave's range and bearing are measured to its centre.
  5. **Against a ship:**
     - Shields absorb hits up to `shieldCapacity`; a Blast Marker is placed for each.
     - If braced, draw **1D6 per remaining hit**; each 4+ is saved.
     - Each unsaved hit is 1 damage, with a critical check per point (**1D6**; on a 6, draw **2D6** on the table, plus any extra-damage dice).
     - Catastrophic damage if the ship reaches 0 hits.
  6. Add `weaponId`, and every `combineWith` id, to `weaponsFired`, and each `withShips` weapon to its ship's.

  **By and at squadrons** (reducer §4.5, T83–T88): the priority test is the squadron's, against `squadronLd`, and its result is written to every member in formation (N40). Batteries from ships in different positions are summed by gunnery column, each column's firepower looked up on its own and the dice added (p. 99). An **escort** squadron on an order that halves firepower halves its total, rounding up, instead of each ship's (p. 99). Against a squadron, hits go one at a time to the **nearest eligible member** they can hurt: shields first, then brace saves, then damage; when it's destroyed or a hulk, the next (pp. 96–98).

  Phase 1 has **no split fire**: a weapon fires once, at one target, at full effective strength (ruling T1).

#### `fire_nova_cannon`
```ts
{ type: "fire_nova_cannon", player, shipId: string, weaponId: string, aim: Point }   // where the template's centre is placed
```
- **Legal when:**
  - **Shooter:** as `fire`, and `novaCannonBarred(ship)` is `null` (state §11): not crippled, and not on All Ahead Full, Come To New Heading, Burn Retros or Brace For Impact! (p. 64).
  - **Weapon:** a `nova_cannon`, not in `weaponsFired` and not disabled by a critical.
  - **Aim** (T43): on the table; in one of the weapon's arcs (`quadrantsOfPoint(ship, aim)`); and the template's near edge 30–150 cm from the stem (`minRange` to `range`, state N13).
  - **Line of fire** (T44): the line from the stem to `aim` doesn't cross the base of a hulk, other than one the template touches at `aim`.
  - There's **no target priority** (state N14). A failed priority test doesn't limit where the template goes.
- **Reducer:**
  1. Add the weapon to `weaponsFired`.
  2. **Scatter dice** from the range (p. 63): near edge ≤ 45 cm → 1D6; ≤ 60 cm → 2D6; further → 3D6.
  3. **Offer brace** to every `active` ship the template could touch after the longest scatter: its base within `NOVA_RADIUS + 6 × scatter dice` cm of `aim`. Enemy ships first, then the firer's own, each in `ships` order (T41).
  4. **Scatter** (T42): draw **1D6** for the scatter die. On 1–2 it's a hit and the template stays at `aim`. On 3–6, draw **2D6** for the direction, table bearing `60 × (first − 1) + 10 × (second − 1)`, then the **scatter dice**: the template moves their total, in cm, along that bearing. It may end partly or wholly off the table.
  5. **Ordnance** touching the template where it lands is removed, whoever owns it: salvoes, whole attack craft waves and CAP fighters (p. 64, p. 85, T45).
  6. **Ships** on the table whose bases touch the template, hulks included, friend or foe: a base touching the centre hole takes **D6** hits (one draw per such ship, in `ships` order), and any other base touching the template **1** hit (p. 64). The hits are automatic, whatever the armour. Each ship then takes its hits, in `ships` order, as from direct fire: shields, brace saves, damage with critical checks, catastrophic damage.
  7. **Nothing touched**, no ship and no ordnance: a single Blast Marker at the template's centre (`nova_miss`), unless the centre is off the table (T46).

  Lock On and Reload Ordnance don't affect it (T47).

#### `launch_torpedoes`
```ts
{ type: "launch_torpedoes", player, shipId: string, weaponId: string, bearing: number }   // relative bearing, clockwise from the bow
```
- **Legal when:**
  - the ship is the active player's, `active`, its disengage test didn't fail, it isn't grappled or boarding (as `fire`), and `loaded.torpedoes` is true;
  - the weapon is `torpedoes`, not fired this turn, and not disabled;
  - `bearing` falls inside the weapon's arcs (Front = 315°–45°).
- **Reducer:** create a `TorpedoSalvo` at the launcher's stem with `heading = (ship.heading + bearing) mod 360` and `strength = effectiveStrength` (crippled and braced halve it, p. 65). Set `launched = playerTurn`, `loaded.torpedoes = false`, and add the weapon to `weaponsFired`. No dice.

#### `launch_attack_craft`
```ts
{
  type: "launch_attack_craft", player,
  shipId: string,
  waves: { roles: CraftRole[], cap: boolean }[],   // each entry: one wave (or one squadron), its squadrons by role
  recall: string[]                                 // own attack craft waves to remove first (p. 73)
}
```
- **Legal when:**
  - the ship is as for `launch_torpedoes`, and `loaded.launchBays` is true;
  - `waves` is non-empty, every wave has ≥ 1 squadron, and every role is one the ship's bays carry (`craft`);
  - the total squadrons ≤ `launchCapacity(ship)` (state §11);
  - **fleet limit:** `craftInPlay(player) − recalled + launched ≤ fleetBays(player)` (p. 73). `recall` names own waves, not CAP (T29), each once;
  - a wave with `cap: true` holds fighters only (T28).
- **Reducer:** remove the recalled waves. For each entry of `waves`, in order: a wave at the launcher's stem, its squadrons in the order given with each role's `name` and `speed` from the ship's bays, `launched = playerTurn`. A `cap: true` entry instead becomes one CAP fighter per squadron on the launcher. Then `loaded.launchBays = false` (launching any amount expends the bays, p. 73) and add every launch bay weapon to `weaponsFired`. No dice.

#### `end_step`
```ts
{ type: "end_step", player }
```
- **Legal when:** the step is `direct_fire`, `launch_ordnance` or `boarding`, and `activation` is null. In `boarding`, only once no boarding action is left to fight: declared boardings must be fought (§4.6).
- **Reducer:** advance (§2.3).

### 4.4 Ordnance

#### `move_ordnance`
```ts
{
  type: "move_ordnance", player,
  ordnanceId: string,
  path?: Point[],            // attack craft only: waypoints, flown in order from the wave's position
  cap?: string               // attack craft only: fighters ending in base contact with this friendly ship go on CAP
}
```
- **Legal when:** the ordnance belongs to the acting player (the active player in `active_ordnance`, the other one in `inactive_ordnance`) and isn't in `ordnanceMoved`.
  - **Torpedo salvo:** no `path`, no `cap`.
  - **Attack craft wave:** `path` is required (`[]` stays put). Its total length is ≤ the wave's speed (its slowest squadron's), and it stays on the table (T20). A CAP fighter may move only in its owner's part of the **opponent's** Ordnance Phase (`inactive_ordnance`), which takes it off CAP (p. 82).
  - **`cap`:** the wave is all fighters, and at the end of `path` its footprint touches the base of `cap`, a friendly `active` ship (p. 82).
- **Reducer, torpedo salvo:** move the salvo its full `speed` straight along `heading`. The swept segment resolves contacts in the order it meets them:
  - **Blast Marker, first one this move:** draw **1D6**; on a 6 the salvo is removed. One roll per move, and it covers BMs in contact with a target ship too (p. 75).
  - **Another torpedo salvo:** both are removed.
  - **An enemy wave with fighters:** one fighter and the whole salvo are removed (p. 82). A wave without fighters doesn't stop torpedoes, and they don't stop it.
  - **A ship base** (friend, foe or hulk; never the launcher in the launch turn; never a ship it has already attacked this round): the salvo **meets the ship** (below), then continues its move if it survives.
  - **Table edge:** the salvo is removed.
- **Reducer, attack craft wave:** fly the footprint along `path`, leg by leg. Contacts resolve in the order the footprint meets them:
  - **Blast Marker, first one this move:** draw **1D6**; on a 6 the **whole** wave is removed (p. 75, p. 85).
  - **An enemy torpedo salvo:** if the wave has fighters, one fighter and the whole salvo are removed. Otherwise nothing.
  - **An enemy wave** (not on CAP): the two **dogfight** (below), and whatever survives flies on.
  - **An enemy ship base:** the wave stops there (it can't fly through, p. 79) and **meets the ship** (below). Hulks count as ships: bombers and assault boats attack them, which can only re-roll catastrophic damage (reducer R3).
  - Friendly ships and ordnance are ignored (p. 82).

  After the move: if `cap` is given, the fighters go on CAP for that ship, one CAP fighter per squadron. Add the wave to `ordnanceMoved`.

#### Dogfights: waves meeting waves

Interactions go marker to marker (p. 85). When waves A and B meet:

1. Fighters engage fighters first: `k = min(fighters(A), fighters(B))` of each are removed.
2. Each side's remaining fighters then remove the other side's bombers and assault boats one for one, each fighter removed with its kill: bombers and assault boats lose to fighters (pp. 83, 85). Enemy fighters always remove fighters first in a wave (p. 85), so step 1 already did that.
3. Bombers and assault boats do nothing to each other or to torpedoes (pp. 83, 85).

No dice. Which squadrons go within a role is the wave's launch order, last first (T25).

#### Ordnance meeting a ship

When a torpedo salvo contacts any ship, or an attack craft wave contacts an enemy ship (by its own move or the ship's), in this order:

1. **CAP screens** (enemy ordnance only; never the protected ship's own torpedoes, p. 82). CAP fighters sit at their ship's stem, so ordnance always meets the ship's base, and its CAP, before anything else of it. Against a salvo, one CAP fighter and the whole salvo are removed. Against a wave, the ship's CAP fighters dogfight it as one wave. A wave with no bombers or assault boats left stops here: fighters alone have no effect on a ship and stay where they are (p. 82).
2. **Blast Markers:** if the target has BMs in base contact and the ordnance hasn't rolled for BMs this move, draw **1D6**; on a 6 it's removed (p. 75).
3. **Offer brace** (target), unless it's a hulk.
4. **Turrets** (p. 80): the target's `turrets(ship)`, plus **massed** dice: +1 for each friendly ship in base contact that is `active`, not crippled and has turrets, up to +3 (p. 80). Massing never applies during the Movement Phase. Turrets fire at torpedoes **or** at attack craft in one phase, not both: a ship (target or helper) whose `turrets` this phase is already set to the other kind doesn't fire; one that fires is set to this kind.
   - Against a salvo: **1D6 per die**; each 4+ reduces strength by 1.
   - Against a wave: **1D6 per die**, once for the whole wave; each 4+ removes one squadron, **fighters first** (p. 85).
5. **The attack.**
   - **Torpedoes:** **1D6 per strength** against the armour of the facing struck first; shields are ignored. Brace saves, damage and criticals as for `fire`. Strength drops by the hits inflicted; record the attack in `attacks`.
   - **Bombers:** each surviving bomber makes **D6 − the target's own turrets** attacks, minimum 0 (massed turrets don't count, and turrets always count, even if they fired at torpedoes this phase, p. 83). Each fighter in the wave adds **+1 attack**, whether or not turrets shot it down, up to the number of surviving bombers (turret suppression, p. 83). Draw **1D6 per bomber** for its attacks, in order, then **1D6 per attack** against the target's **lowest armour**; each hit is 1 damage. Shields are ignored; Brace saves on 4+.
   - **Assault boats:** each surviving assault boat makes a **Hit-and-Run** attack, in order: as a teleport attack (§4.6), D6, 1 fails, 2–6 a critical, Brace saves on 4+ (p. 85).
   - The whole wave is then removed: fighters with it (p. 85).

#### CAP fighters

- A fighter goes on CAP at launch (`launch_attack_craft` with `cap: true`) or at the end of an ordnance move (`cap`).
- It leaves CAP with `release_cap` at the start of its owner's Movement Phase, or by moving in its owner's part of the opponent's Ordnance Phase (p. 82).
- If its ship stops being `active`, it leaves CAP where the ship was, as an ordinary single fighter (T30).

### 4.5 Answering a Brace

#### `answer_brace`
```ts
{ type: "answer_brace", player, pendingId: string, attempt: boolean, reroll?: boolean }   // reroll: a failed check (§2.7)
```
- **Legal when:** `pendingId` is the **top** pending entry's id, and `player` is its `player`.
- **Reducer:**
  - If `attempt`: draw **2D6** Command check against `commandCheckLd`.
    - **Pass:** `specialOrder` becomes Brace, with `replaced` = the previous order kind and expiry per state §7.3. In a squadron, every member in formation braces (state N38).
    - **Fail:** append to `braceFailures` (for every member in formation, in a squadron). This doesn't set `commandCheckFailed` (state N4).
  - Pop the entry. The reducer then carries on with the work queue (reducer §1), which may push new decisions or finish a paused move.

### 4.6 End Phase

The End Phase runs boarding first, then damage control, then Blast Marker removal (p. 88).

#### Boarding: what's left to fight

**`boardingsToFight(state)`** groups the active player's declared boarding actions by target. For each enemy ship `t` that is `active` and not grappled, its group is the active player's ships with `boardingDeclared = t.id` and `boarded = false` that are still `active` with bases touching `t`'s. Only non-empty groups count. A declaration whose ship or target no longer qualifies (say the target exploded in the Shooting Phase) has simply lapsed.

#### Grapples fight (entry housekeeping for `boarding`)

Every grapple fights again, in **every** End Phase, both players' (drawn combats, pp. 90–91). In `ships` order of their defenders, each grapple is one boarding fight (below): all its attackers together against the defender, taking damage in `attackerIds` order (T10). No transform and no choices.

#### `board`
```ts
{ type: "board", player, targetId: string, together: boolean, priority: string[] }   // priority: boarding ship ids
```
- **Legal when:** `targetId` has a group in `boardingsToFight`, and `priority` lists exactly that group's ships, once each. `together` is the attacker's choice (multi-ship boarding, pp. 90–91); with one boarder both values mean the same.
- **Reducer:** set `boarded` on each ship in `priority`. Then:
  - **Together:** one fight, every ship in `priority` against the target. The attackers take damage in `priority` order.
  - **Separately:** one fight per ship, in `priority` order, each on its own boarding value. Damage to the target carries over. Once the target is no longer `active`, the remaining fights lapse (T16).

#### A boarding fight

One boarding action: one or more attackers against one defender (pp. 89–91). Dice in draw order:

1. **Boarding values.** Attackers: `Σ boardingValue(a)`. Defender: `boardingValue(d) + turrets(d)` (state §11; the defender adds its remaining turrets, p. 89).
2. **Modifiers**, for each side (p. 90):
   - **Boarding values:** own value higher than the enemy's +1, at least twice +2, three times +3, four or more times +4. Only the highest applies.
   - **The enemy ship:** has Blast Markers in base contact +1; is crippled +2; is on special orders (any live order, Brace included) +1. Against several attackers, the defender takes the best single attacker's total of these (T11).
   - **Own fleet:** `factionTraits.boardingModifier` (Chaos and Orks +1, Space Marines +2).
3. **Roll:** draw **1D6** for the attackers, then **1D6** for the defender. Each total is roll + modifiers, uncapped.
4. **A draw** (equal totals): no damage and no criticals. The fight's ships grapple. If the defender is already grappled, any attacker new to it is appended to its grapple's `attackerIds`. Otherwise a new grapple forms, with `attackerIds` in the fight's order.
5. **Otherwise the lower total loses**, and takes **1 damage per point of difference**. There are no per-point critical checks, and Brace doesn't help (p. 90, T12).
   - Against attackers, the damage fills them in order: the first until it reaches 0, then the next.
   - A ship reduced to 0 by boarding damage becomes a **drifting hulk** with no catastrophic damage roll (p. 90).
6. **Critical checks**, for the loser's ships first, then the winner's, each in order, skipping any at 0. The results table is read as Loser / Winner (R#1):

   | Difference | Result | Loser | Winner |
   |---:|---|---|---|
   | 1 | Stalemate | 5+ | 5+ |
   | 2 | Heavy Fighting | 4+ | 5+ |
   | 3 | Driven Back | 3+ | 6+ |
   | 4 | Stormed | 2+ | 6+ |
   | 5+ | Overwhelmed | automatic | none |

   Each check draws **1D6** (none when it's automatic or none). On a success, the ship suffers a critical as usual: **2D6** on the table, then any extra-damage dice. A ship reduced to 0 by a critical's extra damage rolls catastrophic damage as normal (p. 90), and an explosion can offer brace to ships nearby.

A decisive result inside a grapple doesn't end it: the ships fight on in the next End Phase until the defender or every attacker is no longer `active` (T10, state §7).

#### `teleport`
```ts
{ type: "teleport", player, shipId: string, targetId: string }
```
- **Legal when:**
  - **Ship:** the active player's, `active`, a capital ship (not an escort), not crippled, not grappled, hasn't declared a boarding action this turn, didn't fail a disengage test, and hasn't teleported this turn (pp. 91–92, T13). Its special order is none, Lock On or Reload Ordnance (R#7).
  - **Target:** an enemy ship that is `active`, with `shieldsDown` (state §11), within **10 cm** stem to stem (T14), and with no more hits remaining than the ship (pp. 91–92).
- **Reducer:** set `teleported`. Offer brace (target). Then:
  1. Draw **1D6**. On a 1 the attack fails.
  2. Otherwise the score is a result on the Critical Hits table, as if it were the 2D6 total (pp. 91–92). "Next highest" applies when it can't be.
  3. If the target is braced, draw **1D6**; on a 4+ the critical is saved (Brace covers Hit-and-Run criticals, p. 66).
  4. Apply the critical, and draw any extra-damage dice. Catastrophic damage follows as usual if the target reaches 0.

  Fleets with a Hit-and-Run bonus (+1, or −1 against them) aren't in Cruiser Clash yet; they'd add a `factionTraits` entry.

  **Against an escort** (p. 92, T90): the D6 destroys it on a **4+**. Brace saves it on a 4+, as for a critical.

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
  options?: { ramming?: boolean, boarding?: boolean, carriers?: boolean, fleetLists?: boolean }
                                             // defaults: true, false, false, false (false keeps older saves replaying unchanged)
  scenario?: "cruiser_clash" | "fleet_engagement"   // default "cruiser_clash"
  forces?: Forces                            // default { kind: "cruiser_clash" } (state §4)
  scoring?: "cruiser_clash" | "victory_points"   // default "cruiser_clash"
  players: {
    p1: { name: string, faction: FactionId },
    p2: { name: string, faction: FactionId }
  }
  ships: {
    owner: PlayerId, name: string, classId: string,
    options?: string[],                      // the class's option ids (T57)
    commander?: CommanderConfig,             // fleet lists only (T60)
    squadron?: string                        // a squadron's name: ships of one owner with the same name form it (T76)
  }[]
}

type CommanderConfig =
  | { kind: "admiral", leadership: 8 | 9 | 10, extraRerolls: 0 | 1 | 2 | 3 }   // Gothic Sector
  | { kind: "warmaster", leadership: 8 | 9, marks: Mark[] }                    // Chaos Incursion
  | { kind: "lord", mark: Mark | null }                                         // Chaos Incursion, Ld 8
```

- Profiles come from a ship catalogue built from `rules/fleets/`. Imperial Navy: `lunar` (p. 71); `gothic` (p. 70); `tyrant` (p. 69); `dominator` (p. 68); the carrier `dictator` (p. 67); the battlecruisers `mars` (p. 61) and `overlord` (p. 66); the light cruiser `dauntless` (p. 77: Cruiser/6, 25 cm, 90°, improved thrusters); and the battleships `emperor` (p. 53: Battleship/12, 15 cm, launch bays 4+4, Ld +1) and `retribution` (p. 54: Battleship/12, 20 cm). Chaos adds the battleships `chaos_battle_barge` (p. 255: 20 cm, launch bays 3+3 and 2 in the prow), `despoiler` (p. 266: 20 cm, launch bays 4+4) and `desolator` (p. 267: 25 cm), the grand cruiser `repulsive` (p. 269: Cruiser/10, 20 cm, 45°) and the heavy cruisers `styx` (p. 272), `hecate` (p. 273), `hades` (p. 274) and `acheron` (p. 275) to the list below. The v0.9 option classes (`lunar_nova`, `tyrant_long`, `tyrant_nova`, `tyrant_long_nova`, `dominator_long`) stay for saves (state N21).
- **Options** (T57), each once per ship, applied in this order, with their points:

  | Class | Option id | Effect | Points |
  |---|---|---|---|
  | `lunar` | `nova_cannon` | prow torpedoes → prow nova cannon | +20 |
  | `tyrant` | `long_batteries` | the 30 cm batteries → 45 cm | +10 |
  | `tyrant` | `nova_cannon` | prow torpedoes → prow nova cannon | +20 |
  | `dominator` | `long_batteries` | FP 12, 30 cm batteries → FP 6, 45 cm | −5 |
  | `mars`, `overlord` | `targeting_matrix` | trait `targetingMatrix` (state §7.1) | +15 |
  | `mars`, `overlord` | `third_turret` | turrets 2 → 3 | +10 |
  | `dauntless` | `prow_torpedoes` | prow lances (Str 3) → prow torpedoes (Str 6, speed 30 cm) | 0 |
  | `repulsive` | `long_dorsal_lances` | dorsal lances 30 → 45 cm (ancient targeting systems) | +10 |
  | `repulsive` | `third_shield` | shields 2 → 3, and a large base (state N28) | +15 |
  | `emperor` | `sharks` | its launch bays also carry Shark assault boats (30 cm) | +5 |
  | `chaos_battle_barge` | `batteries_45` | port and starboard batteries → 45 cm, FP 8 (group `batteries`) | 0 |
  | `chaos_battle_barge` | `batteries_30` | port and starboard batteries → 30 cm, FP 10 (group `batteries`) | 0 |
  | `chaos_battle_barge` | `prow_torpedoes` | prow lances (Str 4) → prow torpedoes (Str 8, speed 30 cm) | +10 |
  | `chaos_battle_barge` | `dorsal_lances_45` | dorsal lances 60 cm Str 3 → 45 cm Str 4 | +10 |
  | `despoiler` | `prow_torpedoes` | prow lances (Str 4) → prow torpedoes (Str 8, speed 30 cm) | +10 |

  Options in the same group exclude each other (state N33); naming two throws.
 Chaos: `murder`, its lance variant `murder_lances` (p. 279), `carnage` (p. 277), `inferno` (p. 278), `slaughter` (p. 280, improved thrusters), and the carrier `devastation` (p. 276). A ship option that changes a profile is its own catalogue class (D13). Their launch bays carry their fleets' attack craft: Fury fighters and Starhawk bombers (Imperial Navy); Swiftdeath fighters, Doomfire bombers and Dreadclaw assault boats (Chaos).
- **Escorts** (T75): Imperial Navy `firestorm` (p. 79, 40 pts), `sword` (p. 82, 35), `cobra` (p. 84, 30); Chaos `idolator` (p. 281, 45, no column shift for range over 30 cm), `infidel` (p. 282, 40), `iconoclast` (p. 283, 30). Escort/1, 90° turns, shields 1.
- **Squadrons** (T76, state §7.5): ships with the same `squadron` name and owner form a squadron, in order of first appearance, named as given. Their ids come from the shared counter after the ships': with five ships, `sq-6`, `sq-7` …
  - Every escort has a `squadron`; an escort squadron holds escorts only, one to six (two to six under the fleet lists).
  - A capital squadron holds two or more capital ships of one `profile.type`.
  - Squadrons, and so escorts, come with points forces only (state N45).
- **Cruiser Clash forces** (`forces.kind = "cruiser_clash"`): 1–4 ships per side, the same number each, all `cruiser`, each ≤ 185 points (p. 128). With `carriers` on, each side may also field **at most one** ship with launch bays above that cap ("allow one carrier each", p. 129).
- **Points forces** (`forces.kind = "points"`, p. 129): each side's ships total ≤ `limit` points (a positive integer), at least one ship a side, any number, any classes of its fleet, battleships included (T71). There's no per-ship cap, so carriers need no option (T36). Without fleet lists, ship types are still limited to what the catalogue has, in any mix. A class with a rarity limit is held to it per side: the Murder lance variant, no more than two per 750 points, or part, of that side's fleet (p. 279). A bad config throws; it never produces an invalid state.
- **Fleet lists** (`options.fleetLists`, points forces only, T58): each side follows its faction's Gothic War list (D24). Every class must be on it.
  - **Imperial Navy, Gothic Sector** (fleets book, p. 35): 0–12 cruisers (`lunar`, `gothic`, `tyrant`, `dominator`, `dictator`, and the light cruiser `dauntless`); up to one battlecruiser (`mars`, `overlord`) per two cruisers; up to one battleship (`emperor`, `retribution`) per three cruisers or battlecruisers; **0–1 Admiral**: Fleet-Admiral Ld 8 (50 pts), Admiral Ld 9 (100), Solar Admiral Ld 10 (150), with one re-roll, plus extra re-rolls (one +25, two +75, three +150). A fleet worth **over 750 points** (Admiral included) must have one.
  - **Chaos, Chaos Incursion** (p. 232): 0–12 cruisers (`murder`, `murder_lances`, `carnage`, `inferno`, `slaughter`, `devastation`); up to one heavy cruiser (`styx`, `hecate`, `hades`, `acheron`) per two cruisers; up to one grand cruiser (`repulsive`) per three cruisers or heavy cruisers; up to one battleship (`chaos_battle_barge`, `despoiler`, `desolator`) per three cruisers or heavy cruisers; **one Chaos Warmaster**, always: Ld 8 (50) or Ld 9 (100), one re-roll, aboard the side's most expensive ship (by its points with options; any of them on a tie), with up to four Marks, each once; **0–3 Chaos Lords**, Ld 8 (50), each on a different ship from the Warmaster and each other, with up to one Mark. Marks: Slaanesh +25, Khorne +20, Tzeentch +30, Nurgle +35.
  - Both lists add **escorts** in any number, in squadrons of 2–6 (p. 35, p. 233): Gothic Sector `firestorm`, `sword`, `cobra`; Chaos Incursion `idolator`, `infidel`, `iconoclast`. They don't count towards any ratio (T77).
  - The commander's points count towards the limit. Without fleet lists, `commander` is refused (T60).
- **Commanders on the ship** (state §7.4): `leadership` as bought (Lords 8); `points` the commander, extra re-rolls and Marks; `rerolls` one for an Admiral or Warmaster plus extras, +1 with the Mark of Tzeentch (a Lord's only re-roll); `marks`. The Mark of Nurgle adds 1 to `profile.hits`.
- `scoring` is copied into `scenario.scoring`, and `forces` into `scenario.forces`. Either scoring goes with either forces (T37).
- **Fleet Engagement** (`scenario: "fleet_engagement"`, pp. 142–143): forces must be `points` ("equal points": the same limit a side), and scoring `victory_points` (the default for this scenario; anything else throws). `maxRounds` is null, `deploymentZones` and `deploymentFacing` are absent, and `setup.engagement` starts with no formations (state §5). The battlezone is the plain 180 × 120 table (T55).
- The result is at `stage: "setup"`, `setupStep: "roll_leadership"`, `playerTurn: 0`. Ships are `undeployed`, with ids `ship-1 … ship-n` in config order, then the squadrons'. `rng.state = seed`.

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
| T8 | **Boarding is declared with the move that makes contact** (`move.boardTargetId`), and stands only if the ship completes its whole path in base contact with the target (p. 56, p. 89). A truncated move, or a target that's no longer an active enemy, lapses it; the ship may then fire as normal. |
| T9 | **Only active, ungrappled enemy ships can be boarded.** Not hulks (there's no crew left to fight), and not ships already locked in a grapple, which fight their own action until it ends. |
| T10 | **A grapple is one fight.** It fights in every End Phase, both players', with all its attackers together, until the defender or every attacker is no longer `active` (drawn combats, pp. 90–91: "until one is reduced to zero damage"). A decisive result inside a grapple doesn't break it. |
| T11 | **Several attackers against one defender:** the defender's "enemy ship" modifiers (Blast Markers, crippled, special orders) are the best single attacker's total, counted once (multi-ship boarding, pp. 90–91: "counted once, highest applies"). |
| T12 | **Boarding damage makes no per-point critical checks.** Criticals come only from the results table, read as Loser / Winner (R#1). Brace protects against neither (p. 90). |
| T13 | A ship that's grappled, or that declared a boarding action this turn, can't make a teleport attack. |
| T14 | **Teleport range is stem to stem**, ≤ 10 cm, like weapon ranges. "No shields" means shield capacity 0 (state R#11), which covers ships with collapsed or no shields too. |
| T15 | `options.boarding` switches boarding actions and teleport attacks on together. |
| T16 | **Boarding separately** resolves in the attacker's `priority` order; once the target is no longer `active`, the rest lapse. **Boarding together**, the attackers take damage in `priority` order. |
| T17 | **A wave is one entity** with a list of squadrons (state §10.2). Waves form only at launch, and lose squadrons marker by marker (p. 85). |
| T18 | **Attack craft move in both players' Ordnance Phases**, the launch turn's included, like torpedoes (R#4). |
| T19 | **An attack craft move is a list of waypoints**, flown in order, with a total length ≤ the wave's speed (its slowest squadron's). An empty path stays put. |
| T20 | Attack craft can't leave the table. |
| T21 | **A wave stops at the first enemy ship base it touches**, whatever it carries (p. 79: it can't fly through). To attack a ship, fly into it. |
| T22 | **A fighter meeting a torpedo salvo** removes the whole salvo and itself: one fighter, however many the wave has (p. 82). |
| T23 | **Turrets fire at torpedoes or attack craft, per ship, per phase**: whichever comes first that phase decides, for the target and any ship massing for it (p. 80). Bomber attacks are always reduced by the target's own turrets. |
| T24 | **Massed turrets**: +1 die for each friendly `active`, non-crippled ship with turrets in base contact with the target, up to +3; never during the Movement Phase (p. 80). |
| T25 | **Which squadron goes**: within a role, the last launched goes first. There's no player choice to make. |
| T26 | **Fighter escorts** add +1 bomber attack each if they reach the target: after CAP and dogfights, before turrets (p. 83). |
| T27 | **CAP fighters can't be shot at** by direct fire: they're on their ship's base. Enemy ordnance has to go through them instead. |
| T28 | Only fighters fly CAP, one squadron per CAP marker: a wave going on CAP splits into single fighters. |
| T29 | **Recall** (p. 73) is part of a launch, removes whole waves, and never CAP fighters. |
| T30 | CAP fighters whose ship stops being `active` stay where it was, as ordinary single fighters. |
| T32 | **Combined batteries** (pp. 61, 63): a ship's weapons batteries firing at the same target fire as one volley: their effective firepower is added and looked up once on the Gunnery Table, with one column (shared aspect, range band and Blast Marker shift). A battery may still fire alone, and a ship may send different batteries at different targets. |
| T33 | Lances aren't combined: they roll 1D6 per point of strength whatever the grouping, so there's nothing to add up. |
| T34 | A volley's target priority: if the target isn't the nearest for **any** battery in it, one priority test covers the volley. A failed test leaves every battery in it unfired. |
| T36 | **Points battles** (p. 129, "play to a points value") drop Cruiser Clash's per-ship cap and equal numbers: a side spends up to the limit however it likes. With no cap, the carriers option has nothing to do in a points battle. |
| T37 | **Scoring is its own choice** (p. 129, "use standard victory points"): Cruiser Clash points or victory points, with either kind of forces. The app suggests victory points for points battles. |
| T38 | **Holding the field** is judged when the game ends: no enemy ship `active` (all destroyed, hulked or disengaged) and at least one of yours `active`. With the game ending as soon as a side has no `active` ship (state D6), the side left fighting holds it. |
| T39 | Points battles keep Cruiser Clash's 8 rounds and set-up. Fleet Engagement's formations and its play-until-one-side-is-gone length come with that scenario. |
| T49 | **The scenario is chosen when the game is made** (p. 120, "arbitrary": the players pick). Attack ratings and the random scenario tables wait until there are more than two scenarios to choose from. |
| T50 | **Formations are picked p1 first, then p2**, on the honour system (state N16). The `formation` log entry for the first pick doesn't name it; the second pick's entry names both. |
| T51 | **The set-up roll-off** is both players' D6, plus `setupBonus` on a split (p. 142): the faster fleet, the better fleet commander, the more escorts. The higher total picks; ties re-roll, without the bonuses changing. |
| T52 | **The winner picks a whole set-up**, map and colours, from the two on offer. On a plain B it's a choice of colour (state N19). |
| T53 | **Deploying into divisions** (state N18): the stem must lie in one of the player's divisions, and the ship faces that division's arrow. While the player has no more undeployed ships than empty divisions, each ship goes into an empty one. |
| T54 | **Fleet Engagement plays until a side has no `active` ship** (p. 143; state N17, D6): there's no round limit, and scoring is standard victory points, holding the field included. |
| T55 | **Battlezone**: no celestial phenomena yet, so Fleet Engagement is fought on the plain table, the same 180 × 120 as Cruiser Clash. |
| T56 | **Re-rolls are decided up front** (§2.7): the transform says whether a failure is to be re-rolled. The outcome is the same as asking after the roll, and no new pending decision is needed. |
| T57 | **Ship options** are picked per ship when the game is made and applied to its profile (state N21). Each option once; options that replace the same weapon don't come together on today's ships. |
| T58 | **Fleet lists apply to points battles**, as an option (`fleetLists`), on by default in the app for new points games. Cruiser Clash keeps its own forces (state N27). |
| T59 | **Ratios** count `category`: one battlecruiser or heavy cruiser per **two** cruisers, rounding down; cruisers 0–12. A Dictator or Devastation is a cruiser. |
| T60 | **Commanders are bought with the fleet** and assigned to a ship in the config (fleets book, p. 11: "any time before the game"). An Admiral goes on any of his side's ships; the Warmaster on the most expensive; Lords on any other ships, one each. |
| T61 | **The Mark of Khorne's +1** on a Warmaster's ship is added to its boarding critical rolls (reducer §10.4), not its boarding total. |
| T62 | **The Mark of Nurgle** adds a hit to the ship's profile and stops boarding actions against it; teleport attacks still work (p. 232 says only "may not be boarded"). |
| T63 | **The Mark of Slaanesh** lowers every Leadership value the enemy ship uses: Command checks, target priority, disengage and ram tests. |
| T64 | **Targeting matrix**: one column shift left for the ship's weapons batteries, applied with the other shifts before the clamp (reducer §4.1). |
| T65 | **A fleet over 750 points** needs an Admiral (Gothic Sector); Chaos Incursion always needs its Warmaster. The 750 counts everything the side spent, commander included. |
| T66 | **Battlecruisers and heavy cruisers** are cruisers in every core rule: speed, turns, gunnery columns, rams, boarding. Their extra weapons (dorsal lances firing left, front and right) need no new rules. |
| T67 | **The Dauntless counts as a cruiser** for the fleet lists: Gothic Sector sells it in the 0–12 Cruisers entry, so it counts towards the twelve and towards every "per two (or three) cruisers" ratio. Its `category` stays `light_cruiser`, so a list that treats light cruisers differently can say so. |
| T68 | **Grand cruisers' ratio** (Chaos Incursion, p. 233): at most ⌊(cruisers + heavy cruisers) ÷ 3⌋. A heavy cruiser counts towards it and still uses its own ratio; the two ratios are checked separately. |
| T69 | **Grand and light cruisers are cruisers** in every core rule (state N20): the Repulsive's 10 hits and the Dauntless's 90° turns and 6 hits are profile values, and rams, catastrophic damage and Blast Markers already scale with starting hits. |
| T71 | **Battleships come with points battles**: Cruiser Clash stays cruisers only (p. 128), and its 185-point cap would keep them out anyway. |
| T72 | **The battleship ratio** (Gothic Sector p. 35, Chaos Incursion p. 233): at most ⌊(cruisers + battlecruisers) ÷ 3⌋ for the Imperial Navy, ⌊(cruisers + heavy cruisers) ÷ 3⌋ for Chaos. A light cruiser counts as a cruiser (T67); grand cruisers and other battleships don't count. Each ratio is checked on its own. |
| T73 | **Come to New Heading** is refused for a ship with the `noComeToNewHeading` trait (validator `declare_order` check 8). Every other order is open to battleships. |
| T74 | **The Emperor's Sharks** add the Shark assault boat to both launch bays' craft (Imperial Navy rules: "some ships may carry Shark assault boats at an additional cost"). They use the assault boat rules the Chaos Dreadclaws already use. |
| T75 | **The Gothic War escorts** are the six on the two lists. The Cobra's long-range detection gear waits (D34). |
| T76 | **Squadrons are named in the config** (p. 95: capital squadrons "declared before the game"; escorts "chosen from the fleet list" in squadrons). A name, not an id, so the forms and saves read naturally. Without fleet lists an escort may be a squadron of one. |
| T77 | **Escorts sit outside the ratios**: the lists count cruisers, heavy cruisers and battlecruisers for their larger hulls, never escorts. |
| T78 | **An escort squadron's Leadership** is one draw, at its first member in `ships` order; the others copy it, so the dice order stays one draw per ship or squadron. |
| T79 | **Squadron names** are free text, unique per owner; the engine never reads them. |
| T80 | **A squadron deploys as one placement** (p. 142: "ship or squadron"): its members go one after another, in one division, each stem within 15 cm of a member already down, before the other player places again. For filling divisions it counts once. |
| T81 | **The squadron's order is declared through any member in formation.** The check uses `commandCheckLd` with `squadronLd`; the −1 for Blast Markers applies if any member in formation has one in contact (p. 95). |
| T82 | **Squadron moves, ship by ship**: members in `squadronMove` move one at a time in any order, each with its own path and limits, before any other ship (state N37). A member that becomes a stray partway doesn't change who's in the move. |
| T83 | **Shooting at a squadron** (pp. 96–98): naming any member in formation targets the squadron, since a Leadership test can't pick a ship out of one. A member is **eligible** for hits if it's in range and arc of at least one weapon in the volley, and its aspect is no harder than `targetAspect` (its column is the same or further left). |
| T84 | **Shooting by a squadron** is opt-in per weapon, like combined batteries (T32): `withShips` names the squadron-mates' weapons that join. A member that can't reach the target fires separately, at another (p. 99). |
| T85 | **`targetAspect`** is the aspect the shooter fires at (p. 96). Omitted, it's the aspect of the nearest member in range and arc of the volley. The volley rolls on that aspect's column, with each firing ship's range and Blast Marker shifts measured to the nearest eligible member from that ship. |
| T86 | **One brace offer per volley** at a squadron, to its nearest eligible member; its answer braces the squadron (state N38). |
| T87 | **Allocating hits** (pp. 96–98): batteries' hitting dice are taken lowest first, each against the nearest eligible member it can hurt (roll ≥ that member's armour on the facing towards the nearest firing ship); lances' hits go nearest first. Each hit is resolved in full before the next: a shield, then a brace save, then damage with its critical check, so a capital ship's critical extra damage counts before hits pass on (p. 98). A member that's destroyed or a hulk takes no more; hits left with no eligible member are lost (p. 97). |
| T88 | **Different positions, one volley** (p. 99): each firing ship's batteries take that ship's column for the target; firepower is summed per column, each looked up on its own, and the dice added. An escort squadron on All Ahead Full, Come to New Heading or Burn Retros halves its total firepower, rounding up; capital ships halve their own (p. 99). |
| T89 | **Torpedoes and attack craft launch ship by ship**, as before; combining salvoes from ships in base contact waits (D33). |
| T90 | **Hit-and-Run against an escort** (p. 92): the D6 destroys it on 4+. A braced escort saves on 4+. |
| T91 | **Escorts in boarding**: an escort boards or is boarded like any ship, on its boarding value (its remaining hits); any critical it suffers destroys it (state N34), so it can win a boarding action and still be lost (p. 90). Escorts can't teleport (T13). |
| T92 | **Escorts and the End Phase**: with no criticals to keep, an escort never needs damage control. A destroyed escort's Blast Marker comes off like any other. |
| T70 | **The Dauntless's torpedoes** are an option at 0 points (p. 77, like the Vigilant and Havock), so it's offered in Cruiser Clash too. |
| T35 | **Rarity limits** count the side's whole fleet: "two per 750 points or part" allows two in any Cruiser Clash fleet (4 × 185 = 740). |
| T31 | **Launch bays** are weapons at a location (port, starboard): that side's armament critical disables them (p. 67), which lowers the fleet's limit too. |
| T40 | **The nova cannon fires with its own transform**, at a point: `aim` is where the template is placed (p. 63). It belongs to the direct-fire step, in any order with the ship's batteries and lances. |
| T41 | **Brace against a nova cannon** is offered before any of its dice, to every `active` ship the template could reach after the longest possible scatter, on both sides: the shell hits friends too. The enemy's ships are asked first. A ship that can't be reached is never asked (p. 63: "including ships it might hit due to scatter"). |
| T42 | **The scatter die** is a D6: 1–2 are its two "hit" faces, 3–6 scatter. The direction comes from **2D6** in 10° steps (36 table bearings, first die the 60° sector, second the 10° within it), measured on the table, not from the firer. Every die is a D6, so replays and scripted tests need nothing new. |
| T43 | **Placing the template:** its centre must be on the table and in the weapon's arc (like a target's stem), and its near edge 30–150 cm from the firer's stem. The same near-edge distance picks the scatter dice: "within 45 cm" is ≤ 45, "45–60 cm" is above 45 up to 60. |
| T44 | **Hulks block the nova cannon's line of fire** as they block direct fire (p. 71), except a hulk the template touches at its aim point: that's firing *at* it. Scatter isn't blocked. |
| T45 | **Ordnance under the template is removed whoever owns it**, CAP fighters included. T27 only stops CAP being targeted, and the nova cannon targets a point. |
| T46 | A nova cannon that touches nothing and lands with its centre **off the table** leaves no Blast Marker. |
| T47 | **Lock On and Reload Ordnance** do nothing for a nova cannon: there are no to-hit dice to re-roll, and it never needs reloading (p. 64). |
| T48 | **Ship options are classes** (D13): `lunar_nova` (+20 pts), `tyrant_long` (45 cm batteries, +10), `tyrant_nova` (+20), `tyrant_long_nova` (+30), `dominator` (190) and `dominator_long`, its original 45 cm batteries (−5, the *Hammer of Justice*). `dominator_long`, at 185 points, fits Cruiser Clash; the others are for points battles. |

## 7. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Is a ship that sails into its own torpedo salvo attacked? | Yes (T6). Overrun your own torpedoes and you have a bad time. |
| D2 | Can hulks be rammed? | Yes. `ramTargetId` accepts any enemy ship on the table, hulks included. |
| D3 | How is a boarding action declared? | With the `move` that makes contact (T8). It's one decision, made where the rule says ("when contact is made", p. 89), and the plotter can offer it when a path ends touching an enemy. |
| D4 | Can a hulk be boarded? | No (T9). |
| D5 | Can other ships board a grappled ship? | No (T9). It keeps every grapple a single fight, and it's rare with four cruisers a side. |
| D6 | Who decides how a group of attackers takes damage? | The attacker, up front, in `board.priority` (T16), the same way repairs and Blast Marker removals are ordered. No decision mid-fight. |
| D7 | Teleport attacks too? | Yes. They're in the same End Phase step (p. 88), under the same option (T15), and any Lunar or Murder can make them. |
| D8 | How do carriers fit Cruiser Clash's 185-point cap? | The book's own alternative, as an option: "allow one carrier each" (p. 129). George's call. |
| D9 | Combat Air Patrol in this slice? | Yes (George's call): escorting a carrier is core fighter play. |
| D10 | Massed turrets? | Yes, now, for torpedoes as well as attack craft (George's call). |
| D11 | Torpedo bombers, resilient craft, boarding torpedoes? | Not in this slice: neither carrier in the box takes them by default. Their rules (pp. 78, 84, 86) slot in as new roles and ordnance kinds later. |
| D13 | Ship options and refits? | A variant whose profile differs is its own catalogue class (`murder_lances`), with its own points and any rarity limit. Options that would take a cruiser over Cruiser Clash's 185 points (the Tyrant's 45 cm batteries, nova cannons) wait for fleet battles by points. They arrive with the nova cannon (T48). |
| D15 | "Remove the 185-point cap" on its own (p. 129)? | Not offered: a points battle does the same job and also frees the numbers. |
| D16 | Fleet commanders at 1,000 points (p. 129) and the fleet lists' ratios? | They came with battlecruisers and heavy cruisers, as George suggested (T58–T60, D24). |
| D14 | Combined batteries: automatic, or the player's choice? | The player's: `combineWith` names the batteries joining the volley, so a ship can still send its long-range battery at one target and its short-range one at another. The app offers the combined volley first. |
| D17 | Does the nova cannon hit friendly ships? | Yes. The book says "any target in base contact", and scatter is the risk you take. Their owner is offered a brace like anyone else (T41). |
| D18 | How is the scatter die rolled? | With D6s only (T42): the scatter die, then 2D6 for one of 36 directions. A continuous random bearing would be smoother, but every roll would stop being a plain die in the log and in scripted tests. |
| D19 | Which nova cannons now? | The cruisers' (T48): the Dominator, and the Lunar and Tyrant options. Battlecruisers and battleships that carry one (Mars, Mercury, Apocalypse, Victory) come with their own chunks. |
| D20 | Which scenarios, and how chosen? | Cruiser Clash and Fleet Engagement, picked in the new-game form (T49). |
| D21 | Secret formations? | The honour system (state N16, George's call): no hidden state in the engine or the server. |
| D22 | The set-up maps' exact dimensions? | Derived from the p. 143 diagrams' stated distances (state N15), for George to check against the book. |
| D23 | Fleet Engagement's length? | Until a side has no `active` ship, as the book says (T54). Players who want an end can disengage. |
| D24 | Which fleet lists? | The Gothic War pair, Gothic Sector and Chaos Incursion (George's call). Others slot in later as data. |
| D25 | Ship options: classes or per ship? | Per ship (George's call, T57). The option classes stay only for old saves. |
| D26 | Marks of Chaos now? | Yes, with the commanders (George's call). |
| D27 | Asking for a re-roll after a failure, or up front? | Up front (T56): same outcome, no extra round trip, and no new pending decision kind. |
| D28 | Which grand and light cruisers? | The Gothic War lists' own: the Repulsive and the Dauntless, as with the battlecruisers (D24). The other Imperial and Chaos grand and light cruisers (Vengeance, Exorcist, Avenger, Retaliator, Executor; Endeavour, Endurance, Defiant, Siluria) come with the fleet lists that carry them. |
| D30 | Which battleships? | The Gothic War lists' own: Emperor and Retribution; the Chaos battle barge, Despoiler and Desolator. The rest (Apocalypse, Victory, Oberon, Vanquisher; the Legion battle barges) come with their fleet lists. |
| D31 | The Chaos battle barge's other options? | Not yet: its Chaos Lord at +1 Leadership (+25), Chaos Space Marines (+35) and Chosen Terminators (+10) need the Chaos Space Marine rules (boarding and teleport bonuses), which come with the Black Crusade list. Its weapon refits are in (T57). |
| D32 | Capital ship squadrons too, or escorts only? | Both (George's call). Capital squadrons are declared in the config and use the same machinery. |
| D33 | Combined torpedo salvoes from squadron ships in base contact (p. 99)? | Later: their geometry (one salvo in every launcher's arc, measured from the furthest) is its own piece of work, and squadrons don't need it to fire their torpedoes (p. 79: "need not fire their torpedoes in a single salvo"). |
| D34 | The Cobra's long-range detection gear? | Later: a squadron-wide refit with conditions on the squadron's make-up, and a doubled Enemy Contacts bonus. It needs squadron options. |
| D35 | How strict is formation? | As written (George's call): ships may stray, and strays act alone until they're back (state N36). |
| D29 | Light cruisers in Cruiser Clash? | Yes (state N27): the Dauntless is sold as a cruiser and costs 110 points. Fielding four against four Lunars is the player's own lookout. |
| D12 | One wave entity, or one entity per marker? | One wave with a footprint (T17, state N8). Turrets fire once at a wave and a hit kills it all (p. 85), so the wave is the unit the rules care about. |

No open questions.
