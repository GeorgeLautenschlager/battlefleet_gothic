# @bfg/engine

The Battlefleet Gothic Remastered rules engine: pure TypeScript, no DOM or Node APIs ([ADR 0001](../docs/adr/0001-engine-language.md)). It implements the specs in [`game_state/`](../game_state/SPEC.md), [`transforms/`](../transforms/SPEC.md), [`validator/`](../validator/SPEC.md) and [`reducer/`](../reducer/SPEC.md).

## Status

| Piece | Spec | Code |
|---|---|---|
| Game state: types, dice, derived values, `actor`, invariants, `newGame` | [game_state](../game_state/SPEC.md), [transforms §5](../transforms/SPEC.md#5-creating-a-game) | `src/state/` ✅ |
| Deterministic maths (`dmath`) and basic geometry | [validator §2.1–2.4, §2.8](../validator/SPEC.md#2-geometry-helpers) | `src/math/`, `src/geometry/` ✅ |
| Swept contact, path walking, targeting | [validator §2.5–2.7](../validator/SPEC.md#25-swept-contact) | `src/geometry/` ✅ |
| Validator | [validator](../validator/SPEC.md) | `src/validator/` ✅ |
| Reducer: pipeline, work queue, setup, turn structure, game end, orders, Brace, repairs, BM removal | [reducer §1–2, §8.1, §10–12](../reducer/SPEC.md) | `src/reducer/` ✅ |
| Reducer: damage pipeline, direct fire, fires | [reducer §3–7](../reducer/SPEC.md#3-the-damage-pipeline) | `src/reducer/` ✅ |
| Reducer: movement, rams, hulks, torpedoes | [reducer §8–9](../reducer/SPEC.md#8-movement) | `src/reducer/` ✅ |
| Boarding actions, grapples, teleport attacks (`options.boarding`) | [transforms §4.6](../transforms/SPEC.md#46-end-phase), [reducer §10.4–10.5](../reducer/SPEC.md#104-boarding) | `src/rules/boarding.ts`, `src/reducer/boarding.ts`, `src/validator/boarding.ts` ✅ |
| Nova cannon (`fire_nova_cannon`): placement, brace offers, scatter, template hits; the nova cannon classes | [transforms §4.3](../transforms/SPEC.md#43-shooting), [reducer §4.4](../reducer/SPEC.md#44-nova-cannon) | `src/reducer/nova.ts`, `src/validator/shooting.ts`, `src/state/catalogue.ts` ✅ |
| Fleet lists (`options.fleetLists`), commanders, re-rolls (`reroll` on four transforms), the Marks of Chaos | [transforms §2.7, §5](../transforms/SPEC.md#27-fleet-commander-re-rolls), [state §7.4](../game_state/SPEC.md#74-fleet-commanders) | `src/rules/fleetLists.ts`, `src/reducer/reroll.ts`, `src/state/derived.ts` ✅ |
| Per-ship options (`ships[].options`), battlecruisers and heavy cruisers, the targeting matrix | [transforms §5](../transforms/SPEC.md#5-creating-a-game), [reducer §4.1](../reducer/SPEC.md#41-batteries) | `src/state/catalogue.ts` (`profileWithOptions`), `src/state/newGame.ts`, `src/reducer/gunnery.ts` ✅ |
| Grand and light cruisers: the Repulsive and the Dauntless, options that add a shield or a large base, the grand cruisers' ratio | [transforms §5](../transforms/SPEC.md#5-creating-a-game), T67–T70 | `src/state/catalogue.ts`, `src/rules/fleetLists.ts` ✅ |
| Battleships: Emperor, Retribution, the Chaos battle barge, Despoiler and Desolator; no Come to New Heading, the Emperor's +1 Leadership, exclusive option groups, the battleship ratio | [transforms §5](../transforms/SPEC.md#5-creating-a-game), T71–T74, [validator §4.2](../validator/SPEC.md#42-movement) | `src/state/catalogue.ts`, `src/state/derived.ts`, `src/validator/movement.ts`, `src/rules/fleetLists.ts` ✅ |
| Escorts and squadrons, step 2: the six Gothic War escorts, squadrons (escort and capital) in the config, shared escort Leadership, deploying as one placement, formation, squadron orders, moves, brace and disengaging, escort losses and victory points | [state §7.5](../game_state/SPEC.md#75-squadrons), [transforms §4.1–4.2, §5](../transforms/SPEC.md#5-creating-a-game), [reducer §3, §8](../reducer/SPEC.md#8-movement) | `src/reducer/squadrons.ts`, `src/state/derived.ts`, `src/reducer/damage.ts`, `src/validator/movement.ts`, `src/validator/other.ts` ✅ |
| Escorts and squadrons, step 3: shooting by and at squadrons: `fire.withShips`, `fire.targetAspect`, columns per firing ship, escort squadrons halving their total, one brace offer, hits lowest roll first to the nearest eligible member | [transforms §4.3, T83–T88](../transforms/SPEC.md#43-shooting), [validator §2.7](../validator/SPEC.md#27-lines-of-fire-and-targeting), [reducer §4.5](../reducer/SPEC.md#45-by-and-at-squadrons) | `src/geometry/targeting.ts`, `src/validator/shooting.ts`, `src/reducer/handlers/fire.ts`, `src/reducer/gunnery.ts` ✅ |
| Fleet Engagement (`scenario: "fleet_engagement"`): formations, the set-up roll-off, the four maps and their divisions, no round limit | [transforms §4.1, §5](../transforms/SPEC.md#41-setup), [state §4–§5](../game_state/SPEC.md#4-meta-scenario-table-players) | `src/rules/engagement.ts`, `src/reducer/handlers/setup.ts`, `src/validator/other.ts` ✅ |
| The Bait (`scenario: "the_bait"`, `attacker`): the bait and its reinforcements, reserves (`reserve` status), entry edges that open along the long edges, `arrive`, `end_step` in `move_ships` while reserves wait, reserves given up when nothing is left on the table | [state §4–§7, N47–N55](../game_state/SPEC.md#4-meta-scenario-table-players), [transforms §4.2, §5, T93–T99](../transforms/SPEC.md#42-movement), [validator §4.2](../validator/SPEC.md#42-movement) | `src/rules/reserves.ts`, `src/validator/reserves.ts`, `src/reducer/reserves.ts`, `src/reducer/steps.ts`, `src/state/newGame.ts` ✅ |
| The Raiders (`scenario: "raiders"`, `attacker`): the defender's facing (`choose_facing`), deployment 30 cm in from every edge and 20 cm apart, the surprise D6 and −1 Leadership, raiders in reserve who all arrive from any edge in their first turn | [state §4–§5, N56–N63](../game_state/SPEC.md#4-meta-scenario-table-players), [transforms §4.1, §5, T100–T106](../transforms/SPEC.md#41-setup), [validator §4.1–§4.2](../validator/SPEC.md#41-setup) | `src/rules/reserves.ts`, `src/state/derived.ts`, `src/reducer/handlers/setup.ts`, `src/validator/other.ts`, `src/validator/reserves.ts` ✅ |
| Planets (`planet` in the config): one template in the centre with its gravity well; lines of fire blocked (ships, ordnance, nova aims) unless an end is on the template; torpedoes and drifting hulks destroyed at its edge; `gravity_turn` path steps; high orbit (no minimum move in a well) | [state §4, §11, N64–N71](../game_state/SPEC.md#4-meta-scenario-table-players), [transforms §4.2, §5, T107–T113](../transforms/SPEC.md#42-movement), [validator §2.7, §4.2](../validator/SPEC.md#27-lines-of-fire-and-targeting) | `src/rules/planets.ts`, `src/geometry/targeting.ts`, `src/geometry/path.ts`, `src/validator/movement.ts`, `src/reducer/movement.ts`, `src/reducer/torpedoes.ts` ✅ |
| Attack craft, CAP, massed turrets; carriers (`options.carriers`) | [transforms §4.3–4.4](../transforms/SPEC.md#44-ordnance-phase), [reducer §9](../reducer/SPEC.md#9-ordnance) | `src/rules/craft.ts`, `src/reducer/craft.ts`, `src/reducer/turrets.ts`, `src/reducer/cap.ts`, `src/validator/craft.ts` ✅ |

## Layout

```
src/
  state/types.ts       every state type, mirroring game_state/SPEC.md
  state/derived.ts     §11 derived values, §12 actor, turn helpers
  state/invariants.ts  §13 invariants (+ plain-JSON and clock consistency)
  state/rng.ts         §10.3 mulberry32 dice
  state/newGame.ts     the newGame factory (transforms §5)
  state/catalogue.ts   ship profiles: every Cruiser Clash cruiser of the Imperial Navy (Lunar, Gothic, Tyrant, Dictator)
                       and Chaos (Murder and its lance variant, Carnage, Inferno, Slaughter, Devastation); traits and rarity limits
  state/json.ts        plain-JSON checks and cloning
  math/dmath.ts        fdlibm ports: sinDeg, cosDeg, asinDeg, atan2Deg
  geometry/basic.ts    bearings, quadrants, distance, contact, segments
  geometry/sweep.ts    swept contact: base vs circle, salvo vs circle/salvo, table exit
  geometry/path.ts     walkPath, Blast Markers along a path, exit distance
  geometry/targeting.ts  line of fire, canEngage, nearest target per weapon (V1)
  rules/move.ts        move parameters and the All Ahead Full end point, shared by validator and reducer
  transforms/types.ts  every transform, mirroring transforms/SPEC.md
  validator/           validate(state, transform): schema (G1), gates (G2–G6), per-transform checks, reason codes
  reducer/             reduce(state, transform): context (dice, ids, log), steps and turn boundaries, work queue, handlers
  reducer/damage.ts    inflict, criticals, catastrophic damage, explosions, hulk re-rolls, fires
  reducer/gunnery.ts   the Gunnery Table, column shifts, lances, Lock On, shots at ordnance
  reducer/blast.ts     Blast Marker placement: shield fans, explosion clusters, hulks
  reducer/movement.ts  moves and their events (table edge, rams, salvos, Blast Markers), disengaging, hulk drift
  reducer/torpedoes.ts launching, moving salvos, torpedo attacks
  reducer/craft.ts     attack craft: launch, flight, intercepts, dogfights, bombers, assault boats
  reducer/turrets.ts   turret dice, own and massed
  reducer/cap.ts       CAP riding with its ship, and released when the ship goes
  rules/craft.ts       wave helpers shared by validator, reducer and app (radius, speed, roles, canLaunchCraft)
test/                  vitest; spec-examples.test.ts runs the JSON in game_state/SPEC.md;
                       reduceWithDice (test seam) scripts the dice and checks every one is drawn;
                       full-game.test.ts has a dumb bot play whole games, checking every transform
```

## Working on it

```sh
npm ci
npm run check      # typecheck + lint + tests
npm test           # tests only
```

## Rules for engine code

- **The specs win.** If code and spec disagree, fix the spec first, then the code.
- **Plain JSON state.** No classes, `Date`, `Map`, `undefined`, `NaN` or `-0` in the state. `checkInvariants` checks this.
- **Deterministic maths.** No `Math.sin`, `cos`, `atan2`, `hypot`, `pow`/`**`, `random`, or the clock in `src/`. Use `dmath`. Lint enforces it, and `test/lint-rules.test.ts` checks that the lint does.
- **Pure functions.** Nothing in `src/` mutates its inputs or reads ambient state.
