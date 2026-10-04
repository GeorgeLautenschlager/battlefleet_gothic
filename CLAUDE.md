# Battlefleet Gothic (digital)

A browser implementation of *Battlefleet Gothic Remastered* (community ruleset v1.10).

## Rules reference

- The source rulebook is `BFG-Remastered-Official-Rulebook-v1-10.pdf` (202 pages). **Don't read the PDF first.** Use the markdown extraction in [`rules/`](rules/README.md).
- Start at `rules/README.md` (file map, glossary, Phase 1 scope, and a list of known ambiguities/interpretations). `rules/quick-reference.md` has every core table on one page.
- Page numbers cited in `rules/*.md` are the book's printed page numbers. They match the PDF page index, so `pdftotext -f N -l N -layout <pdf> -` gives the exact original wording.
- Fleet lists, ship profiles and points come from the separate `BFG-Remastered-Official-Fleets_WIP.pdf` (WIP v0.36, 536 pages), extracted to [`rules/fleets/`](rules/fleets/README.md). Its README indexes every fleet list and all 173 ships. Page refs in `rules/fleets/` are that book's pages.
- `rules/fleets/` is **generated** by [`tools/fleets_extract`](tools/fleets_extract/README.md) (`build.py`, then `check.py`). Don't hand-edit it: put corrections in `tools/fleets_extract/config.py` and rebuild.
- Neither PDF is committed to git. Both stay untracked in the repo root.

## Rules engine specs

The engine is a pure state machine: `validate(state, transform)` → ok / reason, `reduce(state, transform)` → next state. It's fully specified in four docs. Read them before writing engine code; they win over your memory of the rules.

| Spec | What it defines |
|---|---|
| [`game_state/SPEC.md`](game_state/SPEC.md) | The JSON game state: conventions (cm, aviation-style bearings, `playerTurn` clock), ships, orders, criticals, Blast Markers, torpedoes, RNG, log, work queue, derived values, invariants |
| [`transforms/SPEC.md`](transforms/SPEC.md) | Every transform: payload, when it's legal, effect summary, dice draw order; automatic step advancement and turn boundaries |
| [`validator/SPEC.md`](validator/SPEC.md) | Check order, reason codes, and the shared geometry helpers (bearings, arcs, swept contact, path walking, nearest target) |
| [`reducer/SPEC.md`](reducer/SPEC.md) | Algorithms: work queue, dice, damage pipeline, gunnery, BM placement, criticals, catastrophic damage, movement/rams, torpedoes, End Phase, log entries |

- Each spec ends with its **rulings** (e.g. `R6`, `V1`, `T4`, `N7`) and **decisions** (`D1`…). These are settled. Don't re-litigate them in code; change the spec first.
- Rule interpretations from extraction (`rules/README.md` › Interpretations) are referenced as `R#n`.
- If code and spec disagree, the spec is right until it's updated.

## Architecture decisions

Recorded in [`docs/adr/`](docs/adr/). Current:

- [ADR 0001](docs/adr/0001-engine-language.md): the engine is **TypeScript**, a standalone package with no DOM or Node APIs. Engine code must not call platform trig (`Math.sin`, `atan2`, `hypot`, `pow`, …); use the deterministic `dmath` module ([validator §2.8](validator/SPEC.md#28-deterministic-maths)).

## Roadmap

- **Phase 0**: rulebook and fleets book extracted to markdown (`rules/`, `rules/fleets/`). Done.
- **Phase 1**: local browser, hot-seat (two players, one machine, honour system), **Cruiser Clash** scenario with one **Lunar** vs one **Murder**. Keep it as simple as possible.
  - Rules engine specs (state, transforms, validator, reducer): written. Implementation next.
