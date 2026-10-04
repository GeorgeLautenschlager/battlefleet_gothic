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
| Reducer: movement, rams, hulks, torpedoes | [reducer §8–9](../reducer/SPEC.md#8-movement) | — |

## Layout

```
src/
  state/types.ts       every state type, mirroring game_state/SPEC.md
  state/derived.ts     §11 derived values, §12 actor, turn helpers
  state/invariants.ts  §13 invariants (+ plain-JSON and clock consistency)
  state/rng.ts         §10.3 mulberry32 dice
  state/newGame.ts     the newGame factory (transforms §5)
  state/catalogue.ts   ship profiles (Phase 1: Lunar, Murder)
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
test/                  vitest; spec-examples.test.ts runs the JSON in game_state/SPEC.md;
                       reduceWithDice (test seam) scripts the dice and checks every one is drawn
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
