# BRIEF: Campaigns

**Name:** Campaigns (the rulebook campaign system, v1)
**Status:** Draft — 2026-10-06 (decomposition proposed, awaiting approval)
**Origin:** chat session, 2026-10-06 (George + Claude). Architecture recorded in [ADR 0005](../adr/0005-campaigns.md).

---

## One-liner

The rulebook's campaign (pp. 144–160): a procedurally generated sub-sector fought over by an Imperial and a Chaos commander. Battles are ordinary games built from each fleet's register and fed back into the campaign, which tracks renown, ranks, experience, crew skills, refits, repairs and appeals. Play it against another person, hot-seat or online, or against the AI.

## Context & Problem

The battle engine plays any Imperial vs Chaos fleet battle; the [AI brief](BRIEF-ai-opponent.md) gives it an opponent. What's missing is the thing that makes battles matter: a fleet that persists, captains who learn, losses that hurt next week, and a map to fight over. The long-term goal of the AI work is a campaign against an AI that offers a challenge; this brief is that campaign.

The rules are in [`rules/12-campaigns.md`](../../rules/12-campaigns.md) (pp. 144–160) and the sub-plots in [`rules/11-scenarios.md`](../../rules/11-scenarios.md#sub-plots-pp-124127) (pp. 124–127). They split cleanly in two:

- **Between battles:** the map, renown and ranks, the build-up (initiative, orders, scenario, location, size), the aftermath (spoils, renown, promotions, experience, repairs and withdrawals, appeals and refits), and the fleet register. This is bookkeeping and small dice rolls: a state machine of its own.
- **In battles:** ships that start from their register entry (their own Leadership, damage carried over, crew skills, refits), a commander whose rank sets their Leadership, re-rolls and Marks, and sub-plots. These are changes to the battle engine.

**Prerequisites (outside this brief, done inline first):**

- **P1.** The remaining scenarios (Two to Nine), with the Raids and Battles tables (p. 120).
- **P2.** Sub-plots (pp. 124–127), mandatory in campaigns. They change battles and track objectives in-game, so they belong with the scenarios.
- **P3.** Planetary defences (pp. 100–101), for Planetary Assault and Exterminatus.
- **P4.** Celestial phenomena, as far as the scenarios and the Navigational Hazards sub-plot need them.
- **P5.** For the AI side: the AI opponent brief through its app integration (its decomposition steps 1–6, depth one in the app).

## Goals

1. **G1.** A player can create a campaign, build a 2,000-point fleet register, and play it to a configured end, either hot-seat against a person, online against a person, or locally against the AI.
2. **G2.** The rulebook campaign is implemented in full for Imperial Navy and Chaos:
   - the map: systems, types and warp routes;
   - renown and ranks;
   - the build-up and attacks along warp routes;
   - fleet-size modifiers;
   - spoils;
   - experience and crew skills;
   - crippled and destroyed ships;
   - repairs and withdrawals;
   - appeals (reinforcements and refits), with all 18 refits and 6 crew skills working in battle;
   - sub-plots and their renown.
3. **G3.** Sub-sectors are generated procedurally from a seed: always connected, readable, and fair enough to start from. A map can be previewed and re-rolled before the campaign begins.
4. **G4.** Battles are ordinary games: built from campaign state, played in the existing table UI (hot-seat, online, or against the AI), and recorded back into the campaign by replaying them, so the campaign trusts no client's summary.
5. **G5.** The campaign is deterministic and replayable: a campaign is `{ config, transforms }`, like a game, and online the server holds its dice.
6. **G6.** The AI can play a whole campaign: its campaign decisions (where to attack, what to field, how to spend repairs, appeals and experience) and its battles.
7. **G7.** The campaign's end is configurable: most renown after a number of battles (the default), first to five systems, or total control.

## Non-Goals

- Factions beyond Imperial Navy and Chaos: Orks, Eldar, pirate bases, attacking pirate bases, the Mechanicus, Ork and Eldar rank tables.
- More than two players in a campaign (the state allows it later; D3).
- The narrative campaigns (Third Armageddon War, 13th Black Crusade).
- Physical-hobby rules: fleet trials, "must own the models", inactivity penalties, the real-time deadline.
- Allies ("Other" appeals) until a fleet list with allies exists (Q5).
- A strategic search for the campaign AI. v1's campaign decisions are utility-based; battles use the ADR 0004 search.
- Hand-drawn maps, including the Gothic Sector map on p. 161. The map format allows them later.

## Architecture / Approach

```
campaign/ (pure TS, @bfg/campaign)                 engine/ (@bfg/engine)
──────────────────────────────────                 ─────────────────────
CampaignState ─ validate / reduce ◀─ CampaignTransform
  map (generated from a seed)
  players: commander, renown, rank, register       battleConfig(campaign, battle) ─▶ GameConfig
  turn: build-up → battle → aftermath              record_battle { save } ─ replay ─▶ battleReport(final state)
  log, rng

app/                                    server/
────                                    ───────
Campaign UI: setup, map, register,      CampaignDO (one per campaign): seed, transforms,
build-up, aftermath, history            async turns; spawns a GameDO per battle,
battle = the existing table UI          receives its result, replays it
ai/: campaign decisions (utility) + tactical search in battles (ADR 0004)
```

- **`campaign/` package** (`@bfg/campaign`): pure TypeScript with no DOM or Node APIs. It follows ADR 0001's deterministic maths, depends only on `@bfg/engine`, and has `npm run check`. Its spec, `campaign/SPEC.md`, works like the engine's four: state, transforms, validator checks, reducer algorithms, rulings.
- **Campaign state machine:** `validate(campaign, t)` and `reduce(campaign, t)` drive every step. The setup steps are generate map, build registers and pick starting systems. Each campaign turn then runs:
  - **build-up:** roll initiative, roll orders, choose raid or battle, roll the scenario, choose the location, choose the size, pick forces, roll sub-plots;
  - **battle:** record the result;
  - **aftermath:** spoils, renown, promotions, experience choices, repairs, withdrawals, declare and roll appeals, refits.

  Step-advancing and actor rules mirror the engine: `actor(campaign)` says who decides next.
- **Battles as games:** `battleConfig(campaign)` turns the current battle into a `GameConfig`. The config holds:
  - the scenario;
  - the forces picked from the registers, with their Leadership, carried damage, skills, refits and points;
  - the commanders from rank;
  - the sub-plots;
  - a seed drawn from the campaign's RNG.

  A battle ends with `record_battle { save }`, carrying the battle's whole `{ config, transforms }`. The campaign reducer replays it with the engine, checks it matches `battleConfig`, and reads the outcome through a new engine function, `battleReport(state)`. The report gives the winner, the VPs, each ship's fate and remaining damage, the hulks captured and the sub-plot results.
- **Engine hooks:** spec changes (state, transforms, reducer) that let a `GameConfig` say:
  - a ship's Leadership is fixed (not rolled);
  - it starts with damage;
  - it has crew skills and refits, implemented as traits;
  - a commander comes from rank, with a flagship;
  - a ship was added after the campaign began (−1 Ld).

  Plus `battleReport`.
- **Map generator:** `generateSubsector(seed, params)` returns systems and warp routes:
  - systems: names, types and positions;
  - warp routes: a connected graph with bounded degree.

  It is deterministic, so client and server agree. The UI draws it in SVG.
- **Online:** a `CampaignDO` per campaign holds the seed and the transform log. It sends redacted states, like `GameDO`, and lets each player act when it's their turn, days apart if they like. For a battle it creates a `GameDO` from `battleConfig`. When that game ends, it records the result by replaying the revealed save.
- **AI:** in `ai/`, a `campaignDecide(campaign, seat)` makes every campaign decision by utility (D24). Battles use `decide` from ADR 0004. A local campaign against the AI is the first AI campaign; an online AI seat stays out of scope (AI brief parking lot).

## Decisions & Defaults

### Structure

- **D1.** The campaign is a new package `campaign/` (`@bfg/campaign`), pure TypeScript with no DOM or Node APIs and no platform trig (ADR 0001), depending only on `@bfg/engine`, with `npm run check`. Its spec is `campaign/SPEC.md`, versioned and with rulings and decisions like the engine's specs.
- **D2.** A campaign is `{ config, transforms }`: `config` holds the players, factions, map seed and parameters, end condition and campaign seed; replaying the transforms gives the state. Saves and the online log use this shape.
- **D3.** v1 campaigns have exactly two players, one Imperial Navy and one Chaos. The state holds `players` as a list so more can be added later.
- **D4.** A battle's seed is drawn from the campaign's RNG when the battle's forces are fixed. Locally the campaign seed is visible (honour system, as hot-seat games); online the `CampaignDO` holds it and redacts it, as `GameDO` does (network spec §5).
- **D5.** `record_battle { save }` is the only way a battle enters the campaign. The reducer replays `save` with the engine, rejects it unless its config equals `battleConfig` for the current battle and it ended (`game_end`), and takes the outcome from `battleReport(final state)` alone.

### Setup

- **D6.** The map comes from `generateSubsector(seed, { systems, blackstone })`. The defaults:
  - 12 systems (8 to 20 allowed), at least 8 cm apart in map units;
  - routes from the relative neighbourhood graph of the positions, plus extra routes until every system has at least 2 routes, never more than 4;
  - always one connected graph;
  - types drawn from a weighted table (uninhabited 3, agri 2, mining 2, civilised 2, hive 1, forge 1, penal 1);
  - generated Gothic-style names, unique per map;
  - `blackstone`, off by default, marks one system as holding a Blackstone Fortress.
- **D7.** Before the campaign starts, the creator can preview the map and re-roll its seed; the seed that's accepted goes in the config.
- **D8.** Each player builds a 2,000-point register from their faction's Gothic War fleet list, with its ratios and rarity limits. The campaign commander replaces the list's bought fleet commander: no Admiral or Warmaster is bought. Chaos Lords are bought as ship options, as now.
- **D9.** Starting systems: a D6 roll-off decides the picking order (p. 147); each player picks one system; the second pick must be at least 3 warp jumps from the first where the map allows (else the farthest available).
- **D10.** Each commander starts with 1 renown, the rank for it, and a flagship chosen from their register.

### Build-up

- **D11.** Initiative is a D6 roll-off, +1 to the player with fewer systems; the higher total attacks; ties re-roll. (Attack ratings are equal for Imperial and Chaos, so they're not used.)
- **D12.** Orders are a D6: 1–2 raid (500–750 points), 3–6 battle (750–1,500). A player with 21+ renown may choose instead; if both have 21+, a D6 roll-off decides who chooses.
- **D13.** The scenario is rolled on the Raids or Battles table (p. 120) for the order.
- **D14.** The attacker chooses the location: a system joined by a warp route to one they control, or any system if they control none. An uninhabited location reduces the defender's points by 100.
- **D15.** The attacker sets the battle's size within the order's limits, in steps of 50. Each side's limit is then reduced:
  - by 10 points per system that side holds over its opponent;
  - for the defender, by 100 more at an uninhabited location.
- **D16.** Each player picks their force from their register within their limit. Withdrawn ships can't be picked. The force follows the scenario's restrictions; fleet list ratios aren't checked again for the force.
- **D17.** Each player rolls a sub-plot (P2) once forces are fixed. Each player sees their own sub-plot; the opponent's stays hidden until it's revealed in play or the battle ends.

### Battles

- **D18.** In a campaign battle:
  - a ship's Leadership is its register Leadership, never rolled;
  - it starts with its register damage, and is crippled from the start if that damage is at least half its hits;
  - a ship that starts crippled gives no crippling VPs in that battle;
  - its points value includes +10% (rounded up) per refit.
- **D19.** The commander's Leadership, re-rolls and Marks come from their rank (p. 153). They are aboard their flagship, and their re-rolls and abilities work only while the flagship is in the battle. If the flagship is destroyed, the commander survives but has no further effect that battle, and their player picks a new flagship afterwards.
- **D20.** A hulk counts as captured (+1 renown each, p. 152) when it is an enemy capital ship hulk and the capturing player holds the field (p. 123) at the battle's end.
- **D21.** The winner is decided by the scenario's victory conditions; a battle with no winner (equal VPs, where the scenario allows) is a draw: neither side gains or loses the win or loss renown, and no system changes hands.

### Aftermath

- **D22.** The aftermath steps follow pp. 151–156 in order:
  1. **Spoils:** a winning attacker in a battle claims the system if it's adjacent to one they hold and it was the loser's or neutral. A winning raider counts it as theirs for this turn's repairs.
  2. **Renown:** adjusted by the p. 152 tables and the sub-plots; it never drops below 1.
  3. **Rank:** follows renown, up or down. A Chaos commander picks a Mark when a rank grants one; losing a rank loses the most recent Mark.
  4. **Experience:**
     - **Uncrippled survivors** roll 2D6 against Leadership. On a higher roll their player chooses +1 Ld (max 10) or a crew skill roll; Ld 6–7 must take Ld.
     - **Crippled ships** lose 1 Ld (min 6).
     - **Destroyed ships** are replaced by a renamed ship at Ld 6, with no skills or refits.
     - **Escort squadrons** count as crippled at 50% losses and destroyed when wiped out.
  5. **Repairs:** each system the player holds gives points by type and renown (p. 155). The player allocates them to damage, or to replacing lost escorts at 1 point each. All criticals are repaired.
  6. **Withdrawals:** a withdrawn ship misses the next battle and returns at full hits.
  7. **Appeals:** the count comes from renown. The player declares them all first, no type more than twice, then rolls each.
- **D23.** The appeals:
  - **Reinforcements (2+):** one capital ship or up to five escorts from the fleet list. The register must still meet the list's ratios. New ships take −1 Ld (p. 147).
  - **Refits (4+):** the player chooses a capital ship and rolls a D6 for the table (ship, engine or weapons), then rolls on it, re-rolling duplicates.
  - **Other appeals:** not offered in v1 (Q5).

### AI and online

- **D24.** The AI's campaign decisions in v1 are utility-based and live in `ai/` as `campaignDecide(campaign, seat)`:
  - **Location:** the target that maximises (system value × chance of winning), with the chance estimated from the force strengths.
  - **Size:** the largest the AI can field well.
  - **Force:** the strongest force under the limit, keeping badly damaged ships back.
  - **Experience:** +1 Ld below 8, else a skill.
  - **Repairs:** the most valuable ships first.
  - **Withdrawal:** a ship with over half its hits gone that isn't needed.
  - **Appeals:** reinforcements while the register is under its starting points, else refits.

  The weights are named and exported. In battle the AI is ADR 0004's `decide`.
- **D25.** Online, a `CampaignDO` per campaign holds the config, the seed and the transforms, and sends redacted states. Turns are asynchronous; there is no clock.
  - **Creating a battle:** when one is due, the `CampaignDO` creates a `GameDO` from `battleConfig` and gives both players their seat tokens.
  - **Recording the result:** when the game ends, the `GameDO` notifies the `CampaignDO`, which fetches the revealed save and applies `record_battle`.
  - **Expiry:** campaigns expire after 90 days of inactivity.
- **D26.** The campaign has its own protocol (`network/SPEC.md` gains a campaign section); game rooms and their protocol are unchanged apart from the end-of-game notice.
- **D27.** The end condition is set at creation:
  - **Most renown after N battles** (the default, N = 10). Ties go to the player with more systems, then a draw.
  - **First to hold five systems.**
  - **Total control of the map.**

### UI and testing

- **D28.** The app's start screen gains *New campaign* and *My campaigns*. A campaign's home view shows:
  - the sub-sector map (SVG: systems by type, warp routes, control colours, the battle location);
  - each commander's renown, rank and next rank;
  - the active step and who it waits on;
  - the register (ships, Ld, damage, skills, refits, history);
  - the campaign log.

  Build-up and aftermath steps are panels on this view. A battle opens in the existing table UI with a campaign banner and returns to the map when it ends.
- **D29.** Testing:
  - unit tests for every campaign transform and ruling;
  - property tests for the generator: connected, degree 2–4, minimum spacing, deterministic per seed;
  - a CI campaign of 10 battles played by the engine's test bot (or the AI) to the end condition;
  - an e2e test that creates a local campaign, plays one battle and completes the aftermath in the UI.

## Open Questions

- **Q1.** Should a ship that starts a battle crippled (from carried damage) give crippling VPs? — *proposed default:* no (D18): it was crippled in an earlier battle.
- **Q2.** Who sets the battle's size: the attacker, or an offer and counter-offer? — *proposed default:* the attacker, within the limits (D15). It's simple, AI-friendly, and the limits already constrain it.
- **Q3.** Does the battle force have to meet the fleet list ratios, or only the register? — *proposed default:* only the register (D16). Battle forces are drawn from it, and requiring ratios at every size would often leave no legal force.
- **Q4.** Should a hidden sub-plot stay secret online, given the honour system locally? — *proposed default:* yes: the `CampaignDO` and `GameDO` redact the opponent's sub-plot until it's revealed (D17). Locally the same UI hides it, on the honour system.
- **Q5.** "Other" appeals (allies) need allied fleet lists we don't have. Drop them, or hold the slot? — *proposed default:* not offered in v1; added with the first allied list.
- **Q6.** Map size and route density defaults? — *proposed default:* 12 systems, 2–4 routes each (D6); revisit after a few generated maps.
- **Q7.** What does a raid's spoils mean for an online asynchronous turn? — *proposed default:* as D22: the raided system counts as the raider's for that turn's repairs only.
- **Q8.** Campaign length default? — *proposed default:* 10 battles (D27).

## Acceptance Criteria

1. **(G1)** An e2e test creates a local hot-seat campaign, builds both registers, plays one battle (driven by the test bot) and completes the aftermath; another does the same against the AI.
2. **(G2)** Every rule in pp. 144–160 within the non-goals' limits has a campaign spec entry and a test; each of the 18 refits and 6 crew skills has an engine test showing its effect in battle.
3. **(G3)** Property tests over 1,000 seeds: every generated map is connected, every system has 2–4 routes, systems are at least 8 cm apart, names are unique, and the same seed gives the same map.
4. **(G4)** `record_battle` rejects a save whose config differs from `battleConfig` or that hasn't ended, and a campaign test shows a battle's outcome (VPs, ship fates, damage) moving into the registers exactly.
5. **(G5)** Replaying a campaign's `{ config, transforms }` reproduces its state; online, the server's state and a client's replay of the revealed campaign match (as games do, network W5).
6. **(G6)** A CI test plays a 10-battle campaign AI vs AI (iteration budgets) to its end condition with no invalid transform.
7. **(G7)** Each end condition ends a test campaign at the right moment, with the right winner.

## Proposed decomposition (awaiting approval)

Prerequisites P1–P5 first (outside this brief).

1. **Specs.**
   - `campaign/SPEC.md`: state, transforms, checks, algorithms, rulings.
   - Engine spec changes for campaign battles: register ships, rank commanders and flagships, the refits and crew skills as traits, `battleReport`.
   - The campaign section of `network/SPEC.md`.
2. **Engine: campaign battles.** Fixed Ld, starting damage, the −1 Ld for new ships, refit points, rank commanders and flagships, `battleReport` (D18–D21).
3. **Engine: refits and crew skills,** all 24, as traits with tests.
4. **`campaign/`: state, map generator, setup.** Registers, starting systems, commanders (D1–D10).
5. **`campaign/`: build-up and battles.** Initiative, orders, scenario, location, size, forces, sub-plots, `battleConfig`, `record_battle` (D11–D17, D5).
6. **`campaign/`: aftermath and the end.** Spoils, renown, ranks and Marks, experience, repairs, withdrawals, appeals, refits, end conditions (D22, D23, D27), and the bot-played CI campaign.
7. **App: local campaigns.** Start screen, setup and map preview, campaign home, register, build-up and aftermath panels, battles in the table UI, saves (D28), e2e.
8. **AI: campaign decisions.** `campaignDecide` (D24), the AI side in local campaigns, and the AI-vs-AI CI campaign.
9. **Server and online campaigns.** `CampaignDO`, campaign protocol, battles as `GameDO`s with end-of-game notice, the app's online campaign flow (D25, D26).

## Out of Scope (parking lot)

- Orks, Eldar and their pirate bases; Mechanicus ranks; other factions as their fleet lists arrive.
- Three- and four-player campaigns: challenges, alliances, loyalist/rebel splits.
- Narrative campaigns (Armageddon, Black Crusade) as scripted scenario chains.
- Hand-drawn maps, including the Gothic Sector (p. 161), in the generator's format.
- Allies appeals.
- A strategic search for the campaign AI, and an online AI seat.
- Campaign-wide statistics and a fleet history view.
