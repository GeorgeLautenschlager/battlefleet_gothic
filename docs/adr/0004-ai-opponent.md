# ADR 0004: An AI opponent that searches in the player's browser

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** George Lautenschlager, Claude

## Context

The rules engine covers Imperial Navy vs Chaos fleet battles. Testing them needs an opponent that's always available, and the long-term goal is a campaign against an AI that fights a fleet well. Forces at play:

1. **The engine is a perfect simulator.** `validate` and `reduce` are pure functions over a JSON state with seeded dice ([ADR 0001](0001-engine-language.md)). Cloning a 10-ship state takes about 0.1 ms, and a test-bot game of about 300 transforms takes about 0.8 s, most of it spent validating candidate moves.
2. **The game is two-player, zero-sum, with no hidden information** (bar the honour-system formations), **but heavy dice, continuous moves and many decisions per turn.** Exhaustive search (minimax, alpha-beta) blows up; sampling-based search doesn't.
3. **Compute belongs on the players' machines.** The server coordinates and holds the dice ([ADR 0003](0003-network-play.md)); it shouldn't think. Browsers have Web Workers today and WebGPU for later learned models.
4. **The RNG seed is in a local game's state.** Anything that simulates must not read it, or it would know the future dice.

## Decision

Full design: [`docs/briefs/BRIEF-ai-opponent.md`](../briefs/BRIEF-ai-opponent.md).

- **Monte Carlo Tree Search over a tactic library**, cut off at a fixed depth by a hand-written evaluation function. The tactic library turns each decision into a short list of sensible candidates (e.g. "close to 15 cm and show a broadside"); the search simulates them with the real engine, on freshly sampled dice, and keeps the best.
- **Depth one first.** A one-step lookahead (each candidate simulated a few times and scored) is the first milestone, the arena baseline the tree search must beat, and the fallback on slow devices. It's the same code with the tree switched off.
- **In the browser.** A new package, `ai/`, as pure as the engine (no DOM or Node APIs), runs in a pool of Web Workers with one search tree per worker, merged at the root. The server never runs it.
- **Never read the dice.** Every simulation replaces the RNG state with one the search owns.
- **An arena.** AI vs AI and AI vs test bot, over seeds and fleets, measures strength in CI.
- **Later, WebGPU:** a value (and perhaps policy) network trained on arena self-play replaces or blends with the hand-written evaluation.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| **MCTS over tactics, depth-limited, in Web Workers** | **Chosen** | Copes with dice and huge move spaces by sampling; any-time, so a time budget is natural; parallelises across cores; the same evaluation function later becomes a learned one. |
| One-step lookahead (utility AI) only | Kept as milestone one | Most of its parts are MCTS's parts. On its own it can't see a turn ahead. |
| Minimax / expectiminimax | Rejected | Branching factor and chance nodes make it impractical beyond a ply. |
| Scripted rules (like `test/bot.ts`) | Rejected as the opponent | Predictable and exploitable; stays as a fuzzer and arena sparring partner. |
| Learned policy and value from the start (AlphaZero-style) | Deferred | Needs a training pipeline and data first. The arena produces that data. |
| Server-side AI | Rejected | Puts compute on the server, against the project's grain. |

## Consequences

- The AI's strength depends on the device; a time budget, not a fixed iteration count, sets its pace (5 s per phase to start).
- The tactic library limits what the AI can think of: a move it can't generate, it can't find. Widening it is ongoing work.
- Engine speed becomes a feature: optimising `validate` and `reduce` (without changing rules) directly strengthens the AI.
- Arena runs in CI need iteration budgets, not wall-clock ones, to stay deterministic.
