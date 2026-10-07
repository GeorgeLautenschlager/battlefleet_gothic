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
- [ADR 0002](docs/adr/0002-browser-app.md): the app is **Vite + React + SVG** in `app/`. Every action goes through `validate` then `reduce`; undo stops at the last dice roll; saves are `{ config, transforms }`; deployed to GitHub Pages from `main`.
- [ADR 0003](docs/adr/0003-network-play.md): network play is **server-authoritative**. One Cloudflare Durable Object per game runs the engine and holds the secret seed; clients only `validate`. Designed in [`network/SPEC.md`](network/SPEC.md).
- [ADR 0004](docs/adr/0004-ai-opponent.md): the AI opponent is **MCTS over a tactic library**, cut off by an evaluation function, in a pure `ai/` package run in the player's browser (Web Workers; WebGPU later). It never reads the dice. Designed in [`docs/briefs/BRIEF-ai-opponent.md`](docs/briefs/BRIEF-ai-opponent.md).
- [ADR 0005](docs/adr/0005-campaigns.md): campaigns are a **second pure state machine** in `campaign/`, depending only on the engine. Battles are ordinary games built from campaign state and recorded by replaying their saves; maps are generated from a seed; online, one Durable Object per campaign. Designed in [`docs/briefs/BRIEF-campaign.md`](docs/briefs/BRIEF-campaign.md).

## Roadmap

- **Phase 0**: rulebook and fleets book extracted to markdown (`rules/`, `rules/fleets/`). Done.
- **Phase 1**: local browser, hot-seat (two players, one machine, honour system), **Cruiser Clash** scenario with one **Lunar** vs one **Murder**. Keep it as simple as possible.
  - Rules engine specs (state, transforms, validator, reducer): written.
  - Engine implementation in [`engine/`](engine/README.md) (`npm run check` there): game state, geometry, validator and reducer done: a full Lunar vs Murder game plays from `newGame` to `game_end`.
  - Browser app in [`app/`](app/README.md) (`npm run check` and `npm run e2e` there): new game, setup, table view, log, undo, saves, battle controls, movement plotter and shooting done: a whole game is playable in the UI. 
- **Network play** ([`network/SPEC.md`](network/SPEC.md)): done. Server in [`server/`](server/README.md) (`npm run check` there), live on Cloudflare; the app's online play (start screen, invite links, lobby, remote source, reconnect, end-of-game verification) in `app/src/online/`.
- **Original boxed fleets** (Imperial Navy and Chaos), in slices:
  1. Fleet composition, hot-seat: a fleet per side, 1–4 cruisers (Cruiser Clash's limits), mirror matches, picking which ship acts next. Done.
  2. Fleet composition online: lobby fleet picker, protocol 2. Done.
  3. Boarding actions, grapples and teleport attacks (pp. 89–92): specs (state v0.7, transforms v0.5, validator v0.4, reducer v0.4), engine and UI done; a rules option for hot-seat and online games, on by default.
  4. Attack craft (pp. 73–87), with the Dictator and Devastation as the first carriers: launch bays, fighters, bombers and assault boats, dogfights, Combat Air Patrol, massed turrets, and a "one carrier each" option over the 185-point cap (p. 129). Specs (state v0.8, transforms v0.6, validator v0.5, reducer v0.5), engine and UI done; a rules option for hot-seat and online games, off by default.
  5. The rest of the capital ships, in chunks:
     1. The remaining Cruiser Clash cruisers: Gothic and Tyrant; Carnage, Inferno, Slaughter and the Murder lance variant. A class per ship in the fleet forms, combined battery volleys (`fire.combineWith`, T32), class traits (improved thrusters, state N10) and rarity limits (T35). Done.
     2. Fleet battles by points (Cruiser Clash's p. 129 alternatives: a points limit a side, standard victory points). Specs (state v0.10, transforms v0.8, reducer v0.7), engine and UI done, hot-seat and online.
     3. Nova cannon, with the ship options that carry one (Dominator; Lunar and Tyrant options) and the Tyrant's 45 cm batteries. Specs (state v0.11, transforms v0.9, validator v0.7, reducer v0.8), engine and UI done, hot-seat and online.
     4. Scenario selection and Fleet Engagement (pp. 142–143): formations, the four set-up maps and their divisions, no round limit. Specs (state v0.12, transforms v0.10, validator v0.8, reducer v0.9), engine and UI done, hot-seat and online.
     5. Battlecruisers and heavy cruisers (Mars, Overlord; Styx, Hecate, Hades, Acheron), per-ship options, the Gothic War fleet lists (Gothic Sector, Chaos Incursion) with their ratios, fleet commanders and re-rolls, and the Marks of Chaos. Specs (state v0.13, transforms v0.11, validator v0.9, reducer v0.10) engine and UI done, hot-seat and online.
     6. Grand and light cruisers on the Gothic War lists: the Repulsive and the Dauntless, their options, and one grand cruiser per three cruisers or heavy cruisers. Specs (state v0.14, transforms v0.12), engine and UI done, hot-seat and online.
     7. Battleships on the Gothic War lists: Emperor and Retribution; the Chaos battle barge, Despoiler and Desolator. No Come to New Heading, the Emperor's +1 Leadership, exclusive options, one battleship per three cruisers. Specs (state v0.15, transforms v0.13, validator v0.10), engine and UI done, hot-seat and online.
  6. Squadrons and escorts, escort and capital (pp. 94–99): the six Gothic War escorts, squadron Leadership, deployment, orders, moves and formation (as written: strays act alone), disengaging, shooting by and at squadrons with nearest-first hit allocation, and escort victory points. Specs (state v0.16, transforms v0.14, validator v0.11, reducer v0.11). Step 2, escorts and squadron movement (composition, Leadership, deployment, orders, moves, brace, disengaging, escort losses, victory points), and step 3, squadron shooting (`fire.withShips`, `targetAspect`, nearest-first hit allocation): engine and UI done, hot-seat and online. Later: combined torpedo salvoes (D33), the Cobra's detection gear (D34).
  7. Scenarios (pp. 120–143), one at a time, ahead of campaigns:
     1. The Bait (p. 130): who is pursued, the bait and its reinforcements, and **reserves**, ships that arrive along an entry edge during the battle (built to serve the later scenarios that move on from a table edge). Specs (state v0.17, transforms v0.15, validator v0.12, reducer v0.12), engine and UI done, hot-seat and online.
     2. The Raiders (p. 131): the defender at anchor (facing, 30 cm from the edges, 20 cm apart), the surprise (−1 Leadership for D6 turns), and raiders who all move on from any edge in their first turn. Specs (state v0.18, transforms v0.16, validator v0.13, reducer v0.13), engine and UI done, hot-seat and online.
     3. Planets (pp. 112–113), ahead of Surprise Attack: one in the table centre as a game option; blocked lines of fire, torpedoes and drifting hulks destroyed, free gravity-well turns, high orbit. Low orbit later. Specs (state v0.19, transforms v0.17, validator v0.14, reducer v0.14), engine and UI done, hot-seat and online.
     4. Surprise Attack (p. 132): the planet by points, D3 units on full alert and the rest on standby (abeam of the planet, the first within 15 cm), Leadership tests to go on alert, and attackers who all move on from one edge. Planetary defences later. Specs (state v0.20, transforms v0.18, validator v0.15, reducer v0.15), engine and UI done, hot-seat and online.
     5. Blockade Run (p. 133): the blockaders in rolled thirds of the table, the runners at half the points along their edge, 6 turns, and the runners' points for ships off the far edge. Specs (state v0.21, transforms v0.19, validator v0.16, reducer v0.16), engine and UI done, hot-seat and online.
- **AI opponent** ([ADR 0004](docs/adr/0004-ai-opponent.md), [brief](docs/briefs/BRIEF-ai-opponent.md)): designed, brief in Draft with a proposed decomposition (depth-one search and arena first, then MCTS, then tuning). Not started.
- **Campaigns** ([ADR 0005](docs/adr/0005-campaigns.md), [brief](docs/briefs/BRIEF-campaign.md)): the rulebook campaign (pp. 144–160) for Imperial vs Chaos, procedural sub-sectors, against a person or the AI. Designed, brief in Draft. Needs first: the remaining scenarios, sub-plots, planetary defences, the celestial phenomena they use, and (for the AI side) the AI opponent through app integration. Not started.
