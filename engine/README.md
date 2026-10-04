# @bfg/engine

The Battlefleet Gothic Remastered rules engine: pure TypeScript, no DOM or Node APIs ([ADR 0001](../docs/adr/0001-engine-language.md)). It implements the specs in [`game_state/`](../game_state/SPEC.md), [`transforms/`](../transforms/SPEC.md), [`validator/`](../validator/SPEC.md) and [`reducer/`](../reducer/SPEC.md).

## Status

| Piece | Spec | Code |
|---|---|---|
| Game state: types, dice, derived values, `actor`, invariants, `newGame` | [game_state](../game_state/SPEC.md), [transforms §5](../transforms/SPEC.md#5-creating-a-game) | `src/state/` ✅ |
| Deterministic maths (`dmath`) and basic geometry | [validator §2.1–2.4, §2.8](../validator/SPEC.md#2-geometry-helpers) | `src/math/`, `src/geometry/` ✅ |
| Swept contact, path walking, targeting | [validator §2.5–2.7](../validator/SPEC.md#25-swept-contact) | — |
| Validator | [validator](../validator/SPEC.md) | — |
| Reducer | [reducer](../reducer/SPEC.md) | — |

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
  geometry/            constants, bearings, quadrants, distance, contact
test/                  vitest; spec-examples.test.ts runs the JSON in game_state/SPEC.md
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
