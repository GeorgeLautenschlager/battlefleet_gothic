# ADR 0005: Campaigns are a second state machine that replays battles

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** George Lautenschlager, Claude

## Context

The rulebook campaign (pp. 144–160) links battles: a sub-sector map, renown and ranks, fleets whose ships carry damage, experience, crew skills and refits from one battle to the next. Forces at play:

1. **Most of a campaign happens between battles,** in small decisions and dice rolls: initiative, orders, targets, repairs, appeals. It isn't a battle and doesn't belong in the battle engine.
2. **Some of it changes battles:** ships start damaged and with fixed Leadership, refits and crew skills alter rules, the commander's rank sets their Leadership and re-rolls. That does belong in the battle engine.
3. **A campaign runs for weeks,** asynchronously online, with battles as live games in between. The server is authoritative and holds the dice ([ADR 0003](0003-network-play.md)); compute stays on the players' machines.
4. **A campaign result must be trustworthy:** online, neither client should be able to report a battle's outcome it didn't earn.

## Decision

Full design: [`docs/briefs/BRIEF-campaign.md`](../briefs/BRIEF-campaign.md).

- **A second pure state machine.** A new package, `campaign/`, with its own `validate` and `reduce`, depending only on the engine. A campaign is `{ config, transforms }`, like a game.
- **Battles are ordinary games.** The campaign builds each battle's `GameConfig` from its state. It records the result with one transform that carries the battle's whole save; the campaign reducer replays the save with the engine and reads the outcome from the final state. No summary is trusted.
- **The battle engine gains campaign hooks, not campaign rules:** fixed Leadership, starting damage, refits and crew skills as traits, rank commanders with a flagship, and a `battleReport` of the final state.
- **Maps are generated** from a seed by the campaign package, deterministically.
- **Online: one Durable Object per campaign,** holding its seed and log, spawning a game room per battle and replaying it when it ends.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| **A separate campaign state machine that replays battles** | **Chosen** | Keeps the battle engine about battles; the campaign gets the same determinism, saves, undo and server model for free; replay makes results verifiable. |
| Campaign rules inside the battle engine | Rejected | Mixes weeks-long bookkeeping into a per-battle state; every game would carry the campaign. |
| Battles report a summary to the campaign | Rejected | Online, a client could claim a result; replay costs little (a battle replays in well under a second). |
| A campaign as a plain document edited by the UI | Rejected | No validation, no replay, no server authority; the AI would have no clean decision interface. |
| Hand-made maps only | Deferred | George chose procedural maps from day one; the map format allows hand-made ones later. |

## Consequences

- Two specs to keep in step: the campaign spec, and the engine specs' campaign hooks.
- The engine's `GameConfig` grows (register ships, rank commanders, sub-plots), with older configs still valid.
- Recording a battle costs a replay of it; online the server pays that once per battle.
- The AI gets a second decision surface, `campaignDecide`, alongside the tactical `decide`.
- Campaigns outlive games: the campaign object expires after 90 days of inactivity, not 30.
