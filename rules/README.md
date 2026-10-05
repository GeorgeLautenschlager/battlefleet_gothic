# Battlefleet Gothic Remastered — Rules Reference (Markdown)

A structured markdown extraction of **`BFG-Remastered-Official-Rulebook-v1-10.pdf`** (repo root), a fan compilation by Simon Saier of the 2007 BFG rulebook, the 2010 Compendium, and the 2021–2024 FAQs. It is meant for humans and coding agents building the digital game.

- **Page references** like `(p. 62)` are the book's printed page numbers. They match the PDF page index.
- The text has been **condensed and restructured** (lists and tables instead of prose), but rule content is kept faithful. Flavour text, quotes and lore are omitted.
- Where the book is ambiguous or contradicts itself, it's flagged in [Interpretations & known issues](#interpretations--known-issues) below. When in doubt, check the PDF page cited.
- **Fleet lists, ship profiles and points costs** aren't in the rulebook. They come from the separate *BFG Remastered Fleets* book (WIP v0.36), which is extracted into [`fleets/`](fleets/README.md). That README has the per-faction file map, every fleet list, and an index of all 173 ships with points.

## File map

| File | Contents | Book pages |
|---|---|---|
| [quick-reference.md](quick-reference.md) | **All core tables on one page**: turn sequence, special orders, Gunnery Table, criticals, catastrophic damage, ordnance summary | — |
| [01-fundamentals.md](01-fundamentals.md) | Scale, measuring, dice, bearing compass, set-up, ship types, data sheets, base sizes, Leadership, special orders, Command checks | 36–49 |
| [02-turn-sequence.md](02-turn-sequence.md) | Turn structure, first turn, ending the battle | 50–51 |
| [03-movement.md](03-movement.md) | Moving, minimum move, turning, ramming, disengaging, stacking | 52–57 |
| [04-shooting.md](04-shooting.md) | Range, fire arcs, target priority, lances, weapons batteries, **Gunnery Table**, column shifts, splitting fire, nova cannon | 58–64 |
| [05-damage.md](05-damage.md) | Hits, crippling, Brace For Impact!, **critical hits**, Blast Markers, shields, **catastrophic damage**, hulks | 65–71 |
| [06-ordnance.md](06-ordnance.md) | Launching/reloading, ordnance limits, movement, turrets, torpedoes, boarding torpedoes, fighters/CAP, bombers, assault boats, waves, resilient craft | 72–87 |
| [07-end-phase.md](07-end-phase.md) | Damage control, Blast Marker removal, boarding actions, Hit-and-Run, teleport attacks | 88–92 |
| [08-squadrons.md](08-squadrons.md) | Squadron orders, composition, formation, shooting at/by squadrons, hit allocation | 94–99 |
| [09-planetary-defences.md](09-planetary-defences.md) | Satellites, ground units, defence Leadership, defences critical table | 100–101 |
| [10-battlefield.md](10-battlefield.md) | Table size, placing phenomena, battlezone generators, gas clouds, asteroids, warp rifts, planets, moons, sunward, flares, radiation, low orbit | 102–116 |
| [11-scenarios.md](11-scenarios.md) | Choosing scenarios, attack ratings, **victory points**, pre-battle sequence, **all 10 scenarios (incl. Cruiser Clash)**, sub-plots | 118–143 |
| [12-campaigns.md](12-campaigns.md) | Campaign system: systems, renown, promotions, experience, repairs, appeals, refits, crew skills | 144–160 |
| [13-narrative-campaigns.md](13-narrative-campaigns.md) | Third Armageddon War (3 scenarios) and 13th Black Crusade (7 scenarios) | 161–199 |
| [14-designer-notes.md](14-designer-notes.md) | Andy Chambers' clarifications (arcs, halted ships, BMs, torpedo facing…) | 200–201 |
| [ships-lunar-murder.md](ships-lunar-murder.md) | **Lunar** and **Murder** cruiser profiles + derived values + the book's worked examples | 43 |
| [fleets/](fleets/README.md) | **From the Fleets book**: special rules and fleet lists for all 12 factions, every ship profile with points/options, planetary defences, refits, special torpedoes, points index | Fleets pp. 10–535 |

Omitted: lore (pp. 10–35, 162–176, 182–189), art-only pages, and the sub-sector map images (pp. 161, 177, 190).

## Phase 1 scope: Cruiser Clash, one Lunar vs one Murder

Rules needed for a minimal hot-seat game (no terrain, no squadrons, no attack craft):

| Topic | Where |
|---|---|
| Scenario set-up, deployment zones, 8 turns, scoring | [11-scenarios.md › Cruiser Clash](11-scenarios.md#scenario-one-cruiser-clash-p-128--introductory-scenario) |
| Ship stats | [ships-lunar-murder.md](ships-lunar-murder.md) |
| Rolling Leadership, special orders, Command checks | [01-fundamentals.md](01-fundamentals.md) |
| Turn phases | [02-turn-sequence.md](02-turn-sequence.md) |
| Movement, turning, min move, (optional) ramming, disengaging, table edge | [03-movement.md](03-movement.md) |
| Fire arcs, target aspect, lances, batteries, Gunnery Table | [04-shooting.md](04-shooting.md) |
| Shields, Blast Markers, criticals, crippling, catastrophic damage, hulks | [05-damage.md](05-damage.md) |
| Torpedoes (Lunar prow), turrets, reload | [06-ordnance.md](06-ordnance.md) (Torpedoes, Turrets sections) |
| Damage control, BM removal, boarding actions and teleport attacks | [07-end-phase.md](07-end-phase.md) |
| Designer rulings on arcs/halted ships/BM timing/torpedo facing | [14-designer-notes.md](14-designer-notes.md) |

Not needed for Phase 1: squadrons, attack craft, nova cannon, planetary defences, celestial phenomena, campaigns.

## Glossary

| Term | Meaning |
|---|---|
| **Capital ship** | Battleship or cruiser (anything not an escort). |
| **Hits / damage points** | Same thing: the ship's hull points. |
| **Crippled** | Has lost ≥ half its starting hits. Halved stats, −5 cm speed. |
| **Hulk** | Capital ship reduced to 0 hits that didn't explode (drifting or blazing). |
| **Stem** | Centre of the flying base. All range/move measurements are stem-to-stem. |
| **Base** | Small 32 mm or large 60 mm circle; anything touching the base affects the ship. |
| **Fire arc** | Front / left (port) / right (starboard) / rear 90° quadrant from the firer. |
| **Aspect** | Which of the *target's* quadrants faces the firer: closing (front), moving away (rear), abeam (side). |
| **Blast Marker (BM)** | Counter placed for shield hits, explosions, etc. Slows movement, blocks shields, shifts gunnery, removes ordnance on a 6. |
| **Column shift** | Moving left (more dice) or right (fewer dice) on the Gunnery Table. |
| **Command check** | 2D6 ≤ Ld test to go on special orders; one failure stops further orders that turn. |
| **Leadership test** | Any other Ld test (ram, target priority, asteroid navigation…); no modifiers, and allowed even after a failed Command check. |
| **Ordnance** | Torpedoes and attack craft, moved as markers in the Ordnance Phase. |
| **Wave / salvo** | Group of attack craft markers / a torpedo marker with a Strength. |
| **CAP** | Combat Air Patrol: fighters escorting a ship. |
| **Defences column** | Leftmost Gunnery Table column; used for defences and ships that moved < 5 cm. |
| **Holding the field** | Your fleet is the only one left on the table at game end. |

## Interpretations & known issues

Inconsistencies and gaps found while extracting. Implementers should pick a ruling, and the code should record which one it chose.

1. **Boarding results table header** (p. 90) reads "Winners/Losers", but the worked example (Heavy Fighting: loser 4+, winner 5+) and "Overwhelmed: Auto/None" show the first value is the **loser's**. [07-end-phase.md](07-end-phase.md) reads it as Loser/Winner.
2. **Escort squadron "crippled"** for VPs: p. 57 says at least half destroyed *rounding down*; p. 123 says half *rounding up*.
3. **Ringed planets**: the battlezone footnote (p. 108) says rings on 4+; the Ringed Planets section (p. 113) says 5–6.
4. **Torpedo timing**: ordnance is "launched at the end of the Shooting Phase" but "moves and attacks during the Ordnance Phase". The launch rule also says to place the marker "at the end of its movement in the turn of launch". Most likely reading: in the launch turn's Ordnance Phase the salvo moves its full speed from the launcher. Ordnance moves in **both** players' Ordnance Phases (p. 201).
5. **Halving when crippled**: the book says "halves" without stating rounding for crippling, while special orders say "rounding up". Assume **round up** throughout. Lunar and Murder values divide evenly anyway.
6. **Cruiser Clash map** gives zone width (90 cm) and separation (60 cm) only. Table size and zone depth aren't specified. Suggested: 180 × 120 cm table, zones 30 cm deep and centred.
7. **Teleport attacks**: the text allows ships "on Lock On or Reload Ordnance". Read here as also allowing ships on no special orders.
8. **"Cannot split fire at a single target"** (p. 63): read as "no splitting one battery into several shots at the same target".
9. **Pelucidar** (p. 180) refers to a deployment map that is missing in v1.10. Its set-up text duplicates The Raiders'.
10. **Leadership tests have "no modifiers"** (p. 49), yet disengaging (p. 56), radiation bursts and Bridge Smashed modify Ld. Read p. 49 as: the Command-check modifiers (Under Fire / Enemy Contacts) don't apply to other tests. Explicit modifiers and changes to the Ld characteristic still do.
11. **Shields and multiple shooting**: shields absorb hits "in a single Shooting Phase" until BMs in contact equal shield strength, and stay down until the ship moves away from the BMs. In practice, **shield capacity = shields − BMs currently in base contact**.

## Searching tips for agents

- Every chapter keeps the book's section names as headings, so `grep -n "^#" rules/*.md` gives a full outline.
- Key terms are bolded consistently (e.g. **Brace For Impact!**, **All Ahead Full**, **Blast Marker**). Grep for the exact capitalised name.
- For exact wording, extract the page text from the PDF (e.g. `pdftotext -f 62 -l 62 -layout BFG-Remastered-Official-Rulebook-v1-10.pdf -`).
