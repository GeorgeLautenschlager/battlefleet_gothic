# ADR 0002: The browser app

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** George Lautenschlager, Claude

## Context

The engine ([ADR 0001](0001-engine-language.md)) is finished: `validate` and `reduce` play a whole Cruiser Clash. Phase 1 needs a way for two people to play it, hot-seat, on one machine. Forces at play:

1. **The engine already knows the rules.** `validate` returns a reason code and a human message for anything illegal, and `reduce` writes a structured log. The UI shouldn't re-implement either.
2. **The table is small.** Two ships, a few Blast Markers, the odd torpedo salvo, on a 180 × 120 cm table.
3. **Dice are seeded.** Undoing a transform that rolled and trying something else would reveal the dice to come.
4. **An AI opponent comes later**, probably an LLM on WebGPU, choosing transforms like a player does.
5. **No dev box required.** Work happens in cloud sessions; the game should be playable from any browser.

## Decision

A separate `app/` package: **Vite + React + TypeScript**, importing `@bfg/engine` as TypeScript source (`file:../engine`).

- **The app state is a history:** the game config, the initial state, and each applied transform with the state it produced. Every transform goes through `validate` then `reduce`; rejections show the validator's message. No other state library.
- **Undo back to the last dice roll.** A transform that changed `rng.draws` can't be undone; anything since it can.
- **Saves are `{ config, transforms }`.** The engine is deterministic, so replaying them restores the game. Autosave to `localStorage`, plus JSON export and import (also how bug reports travel).
- **The table is SVG**, its viewBox in table centimetres with y flipped (the table's +y is up). Clicks and hit-testing come free; Canvas or WebGL can wait for big fleets.
- **Validator-driven interaction.** Ghosts (a ship being deployed, a path being plotted) call `validate` as the pointer moves and turn red with the reason when illegal.
- **The log is prose in one place** (`app/src/log/format.ts`), with a raw-data fallback for kinds it doesn't know.
- **A clean, flat look.** Dark tactical-plot palette, player colours (Imperial blue, Chaos red). Gothic dressing can come later.
- **Hosting: GitHub Pages**, deployed by CI from `main`. Relative asset paths, so the same build works locally.
- **Tests:** Vitest for app logic, Playwright for flows through the real UI.

Later, each player will be driven by a controller that, given a state, produces a transform: the human UI first, an AI later. The table and panels shouldn't care which.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| React | **Chosen** | The engine is a reducer; React re-rendering from immutable state fits it exactly. Deep ecosystem and agent fluency. |
| Svelte / Solid | Not chosen | Fine fits, smaller ecosystems; no compelling advantage here. |
| No framework | Not chosen | Hand-rolled re-rendering of panels and SVG for little gain. |
| Canvas 2D / PixiJS for the table | Deferred | Worth it at many dozens of objects; SVG is simpler at Phase 1's scale. |
| Full undo | Rejected | Lets a player see the dice before choosing. |

## Consequences

- The UI never decides legality; if a control lets you try something illegal, you get the engine's reason.
- A save from an older engine may not replay after a rules fix; `fromSave` refuses it rather than loading a different game.
- The Pages deploy needs the repository's Pages source set to "GitHub Actions" once.
