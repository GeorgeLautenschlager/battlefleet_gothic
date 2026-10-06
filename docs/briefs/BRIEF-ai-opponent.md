# BRIEF: AI opponent

**Name:** AI opponent (tactical fleet AI, v1)
**Status:** Draft — 2026-10-06 (decomposition proposed, awaiting approval)
**Origin:** chat session, 2026-10-06 (George + Claude). Architecture recorded in [ADR 0004](../adr/0004-ai-opponent.md).

---

## One-liner

An opponent that fights an Imperial Navy or Chaos fleet competently in a local game, by searching (Monte Carlo Tree Search over a tactic library, cut off by an evaluation function) on the player's own hardware, optimised to be a strong, testable foundation for a campaign AI.

## Context & Problem

The rules engine now plays full Imperial vs Chaos fleet battles (capital ships, escorts, squadrons, ordnance, boarding, commanders, Fleet Engagement), hot-seat and online. Testing those rules needs a second player, and the long-term goal (a campaign with real challenge) needs one that fights well.

What exists:
- `engine/`: pure `validate(state, t)` and `reduce(state, t)`, JSON state, seeded dice; `actor(state)` says who must act next; every decision is a `Transform`.
- `engine/test/bot.ts`: a scripted bot that enumerates candidate transforms and takes the first legal one. It plays full games for tests but has no judgement.
- `app/`: a `GameSource` abstraction (local history or remote socket) that the UI drives.

Measured: cloning a 10-ship state about 0.1 ms; a test-bot game about 300 transforms in about 0.8 s, dominated by validating hundreds of candidates per decision. A good simulation policy should play a whole game in about 0.1–0.2 s, so 5 s buys dozens of full games per core, but hundreds to thousands of shallow ones.

## Goals

1. **G1.** A player can start a local game against the AI, for either side, with any options the fleet forms allow, and play it to the end.
2. **G2.** The AI makes every decision the rules ask of its side, including setup choices, deployment, orders, paths, fire, ordnance, braces (on the opponent's turn too), boarding, teleports, repairs and Blast Marker removal, without help.
3. **G3.** The AI never reads information a player wouldn't have: the RNG state or the opponent's secret formation.
4. **G4.** It plays within a time budget (5 s per phase to start) on the player's hardware, using all cores through Web Workers, and keeps the UI responsive.
5. **G5.** Its strength is measured, reproducibly, by an arena: the depth-one AI beats the test bot; MCTS beats depth one at the same budget.
6. **G6.** The design leaves clean seams for a learned evaluation (WebGPU) and for campaign-level decisions later.

## Non-Goals

- Campaign play: fleet building, strategic choices, keeping ships alive across battles. (Later; this brief is the tactical layer it will stand on.)
- Learned models, training pipelines, WebGPU. (Later; the seams are a goal, the models aren't.)
- An AI seat in online games. (Later; the design must not prevent it.)
- Difficulty levels beyond the time budget.
- Any change to the rules or the specs. Engine performance work is allowed only where it changes no behaviour.
- Natural-language explanations of the AI's play.

## Architecture / Approach

```
app (main thread)            ai/ (Web Workers, pure TS)                 engine/
───────────────────          ──────────────────────────                 ───────
AI driver ── state ──▶ pool ─▶ decide(state, seat, budget)
            ◀─ transform ──       │  tactic library → candidates ───▶ validate
                                  │  search (depth 1 │ MCTS) ─ sim ──▶ reduce (fresh dice)
                                  │  evaluation(state, seat) → [-1, 1]
                                  └─ root merge across workers
arena (Node / vitest) ── AI vs AI, AI vs bot, seeds × fleets ── reports
```

- **`ai/` package** (`@bfg/ai`): pure TypeScript like the engine (no DOM or Node APIs, deterministic maths per ADR 0001 where geometry is computed), depending only on `@bfg/engine`. It has its own `npm run check`.
- **`decide(state, seat, options) → Transform`**: the single entry point. `options` holds the budget (wall-clock ms, or an iteration count for tests), a search seed, and the search mode (`"depth1" | "mcts"`).
- **Tactic library (the policy):** per decision kind, a generator returns a short, ranked list of legal candidate transforms built from named tactics. Movement tactics produce concrete paths:
  - close to a range band with a broadside;
  - point the prow (lances, torpedoes, rams);
  - keep at long range;
  - fall back, or disengage;
  - follow the squadron;
  - board a target;
  - ram on All Ahead Full.

  Each comes with the special order it implies.
- **Evaluation function (the value):** `evaluate(state, seat) → [-1, 1]`, a squashed weighted sum of:
  - the victory point margin, counted as the scoring rules would at game end;
  - hull and shield state;
  - Blast Markers in contact;
  - expected damage each side can deal next turn (weapons bearing, range bands, gunnery columns);
  - ordnance threat;
  - table-edge and disengage risk;
  - commander and re-roll value.

  The weights are named, exported and unit-tested.
- **Search:**
  - **Depth one:** each candidate is simulated `k` times on fresh dice, to the next decision of the same seat (or the end of the phase), and scored. The best average wins.
  - **MCTS:** open-loop UCT. Nodes are decision points, edges are tactic-library candidates, and dice are resampled on every iteration. The opponent's nodes use the same tactic library. The search stops at a depth cutoff (the end of the opponent's next turn) and evaluates there.
  - **Workers:** each runs its own tree from the same root (root parallelism). The pool merges root visit counts and plays the most-visited move.
- **AI driver (app):** when `actor(state)` is an AI seat, it posts the state to the pool, applies the returned transform through the same `validate` → `reduce` path as a human's, and shows a "thinking" indicator. A developer panel shows the top candidates and their scores.
- **Arena:** a harness that plays AI vs AI and AI vs `test/bot.ts` over seeds, fleets and scenarios with iteration budgets, and reports win rate and VP margin. A small arena runs in CI.

## Decisions & Defaults

- **D1.** The AI lives in a new package `ai/` (`@bfg/ai`), pure TypeScript with no DOM or Node APIs, depending only on `@bfg/engine`; it has `npm run check` (typecheck, lint, test) like `engine/`.
- **D2.** The single entry point is `decide(state, seat, { budgetMs?, iterations?, seed, mode }) → Transform`; with `iterations` and a `seed` it is fully deterministic (tests and arena use this).
- **D3.** The AI only ever acts when `actor(state)` is its seat, or when the top `pending` decision belongs to its seat; it returns exactly one legal transform (one that `validate` accepts).
- **D4.** Every simulation replaces `state.rng` with an RNG state drawn from the search's own seed before reducing; the AI never reads `state.rng` for decisions. A test proves the AI's choice doesn't change when only `state.rng.state` changes.
- **D5.** In Fleet Engagement the AI never reads the opponent's `formation` from the state before choosing its own; it chooses by its own heuristic (default: a weighted random pick, seeded by the search seed).
- **D6.** Simulations use the real engine (`validate` and `reduce`), never a re-implementation of the rules.
- **D7.** Candidates come only from the tactic library; a candidate the library can't generate, the AI can't play. Each generator returns at most 12 candidates (configurable), legal by `validate`.
- **D8.** Movement tactics, v1: `broadside_at(range)` (15 and 30 cm bands), `prow_on(target)`, `keep_long`, `fall_back`, `disengage`, `hold_formation` (squadron members), `board(target)`, `ram(target)`. Each picks its special order (or none) and yields a path the validator accepts. Where a tactic can't produce a legal path, it yields nothing.
- **D9.** Shooting tactics, v1: for each ready weapon (and combined volley or squadron volley the engine allows), targets ranked by expected damage × target value; torpedoes aimed by leading the target's current heading; attack craft as bombers at the best target, fighters on CAP over the most threatened friendly ship or intercepting incoming ordnance.
- **D10.** Other decisions, v1:
  - **Brace:** brace when the expected incoming damage is at least a threshold weight of the ship's remaining hits; the threshold is in the weights.
  - **Boarding:** board when the expected boarding margin is positive.
  - **Teleports:** whenever legal.
  - **Repairs:** worst critical first.
  - **Blast Marker removal:** markers in contact with its own ships first.
  - **Deployment:** spread across the zone or divisions, facing the enemy, squadrons in formation.
  - **Set-up and first-turn choices:** by evaluation.
  - **Roll steps:** immediately.
- **D11.** `evaluate(state, seat)` returns a number in [-1, 1], positive good for `seat`, built from named, exported weights; a game already ended evaluates to +1, -1 or 0 by its result.
- **D12.** Depth-one search simulates each candidate `k = 4` times by default, each on fresh dice, until the next decision of the same seat or the end of the current phase, whichever comes first, and picks the best mean evaluation.
- **D13.** MCTS is open-loop UCT: nodes keyed by the sequence of transforms taken, dice resampled each iteration, the exploration constant `c = 1.4` (tunable), the cutoff at the end of the opponent's next player turn, the move played being the root child with the most visits.
- **D14.** Inside MCTS, the opponent is modelled by the same tactic library and search (self-play); no separate opponent model.
- **D15.** A **phase** (movement, shooting, ordnance, end) gets the time budget: 5 s by default. Decisions in the phase share it in proportion to the number still to come. A decision with a single legal candidate, or a `roll_*` step, is answered at once and uses none of it. Brace answers on the opponent's turn get at most 0.5 s.
- **D16.** The worker pool has `max(1, navigator.hardwareConcurrency − 1)` workers; each runs an independent search from the same root with its own seed; the pool sums root visit counts (MCTS) or candidate means weighted by samples (depth one).
- **D17.** The app's new-game form gets a "Player 2 (or Player 1) is the AI" choice for local games; the AI seat's fleet is built in the same form as a human's.
- **D18.** The AI driver applies the AI's transform through the existing local `GameSource`, after a minimum display delay of 300 ms, so moves are visible; undo still works and stops at the last dice roll as for humans.
- **D19.** A developer panel (behind a toggle) shows, for the AI's last decision, the top five candidates with their tactic name, visits or samples, and mean evaluation.
- **D20.** The arena is a vitest/CLI harness in `ai/` that plays games over seeds × fleets × scenarios with iteration budgets and reports win rate and mean VP margin per pairing; CI runs a smoke arena of at most 2 minutes.
- **D21.** Engine performance work for the AI is allowed only with no change to behaviour: every engine test still passes unchanged, and the full-game seeds produce identical logs before and after.
- **D22.** Milestone order: depth-one AI playable end to end first (with the arena), then MCTS, then tuning. Each milestone is shippable on its own.

## Open Questions

- **Q1.** Is the 5 s budget per phase or per decision? — *proposed default:* per phase, shared across its decisions (D15), so a whole turn takes about 10–20 s.
- **Q2.** Should the AI be selectable for either seat in v1, or only Player 2? — *proposed default:* either seat (D17).
- **Q3.** Does the arena's strength bar for MCTS need a number? — *proposed default:* at equal iteration budgets, MCTS beats depth one in at least 60% of 100 games across the standard arena fleets; depth one beats the test bot in at least 90%.
- **Q4.** Which fleets and scenarios make up the standard arena? — *proposed default:* Cruiser Clash 2v2 and 4v4; a 1,000-point battle with fleet lists (capital ships and an escort squadron a side); a 1,500-point Fleet Engagement; each played from both sides.
- **Q5.** Should the AI use fleet commander re-rolls? — *proposed default:* yes, by the same rule as the app's switch: re-roll every failed check while re-rolls last.
- **Q6.** Should AI moves animate, beyond the 300 ms delay? — *proposed default:* no; the existing table rendering updates as transforms apply.
- **Q7.** Does the AI need to handle saves loaded mid-game? — *proposed default:* yes, it acts from any state where `actor` is its seat, so a loaded save just continues.

## Acceptance Criteria

1. **(G1)** An e2e test starts a local game with the AI as Player 2 in each scenario, and the game reaches `game_end` with no human input after the human's own moves (the human side driven by the test bot).
2. **(G2)** Over the standard arena, the AI never returns a transform `validate` rejects, and never stalls (every decision returns within its budget + 10%).
3. **(G3)** A unit test shows `decide` returns the same transform when only `state.rng` differs; another shows the formation choice is the same whatever the opponent's formation in the state.
4. **(G4)** With `budgetMs` set, a phase's decisions together take no more than 5.5 s on a 4-core reference machine; the UI thread never blocks for more than 50 ms while the AI thinks.
5. **(G5)** The arena report shows depth one beating the test bot and MCTS beating depth one by the Q3 margins, reproducibly from fixed seeds.
6. **(G6)** `evaluate` and the tactic library are separate modules behind interfaces that a learned model could implement; the brief's parking lot lists the next steps.

## Proposed decomposition (awaiting approval)

1. **`ai/` scaffold and the entry point.** Package, `decide` signature, RNG replacement (D4), formation hygiene (D5), trivial decisions (roll steps, single candidates). Tests for D3–D5.
2. **Evaluation function v1.** `evaluate` with named weights (D11) and unit tests on hand-built positions (ahead or behind on VPs, broadside vs prow-on threat, shields down).
3. **Tactic library v1, movement and orders** (D8), with tests that every tactic yields only validator-accepted transforms across a set of positions.
4. **Tactic library v1, everything else** (D9, D10): shooting, volleys, torpedoes, attack craft, brace, boarding, teleports, repairs, Blast Markers, deployment, set-up choices.
5. **Depth-one search and the arena** (D12, D20). CI smoke arena; depth one beats the test bot (Q3).
6. **App integration.** Worker pool (D16), AI driver (D17, D18), new-game choice, thinking indicator, developer panel (D19), e2e (Acceptance 1).
7. **MCTS** (D13–D15) with root parallelism; arena shows it beats depth one (Q3).
8. **Performance and tuning.** Engine hot paths under D21; weight tuning from arena runs; budget checks (Acceptance 4).

## Out of Scope (parking lot)

- Learned value and policy networks on WebGPU, trained from arena self-play (the evaluation and tactic interfaces are the seams).
- Campaign AI: fleet building, battle choice, preserving ships, using the campaign rules.
- An AI seat in online games: a browser running the AI as a client of the room.
- Difficulty levels (budget, noise, deliberately weaker tactics).
- Opponent modelling that learns a particular human's habits.
- Progressive widening or continuous path optimisation inside the search, if the fixed tactic library proves too coarse.
