# BRIEF: BFG Rules Reference

**Name:** BFG Rules Reference
**Status:** Draft
**Origin:** chat session, 2026-10-03 (George + Claude)

---

## One-liner

Turn the Phase 1 slice of the Battlefleet Gothic Remastered rulebook (v1.10) into
a set of small, citable markdown files under `docs/rules/`, so any agent can look
up an exact rule instead of half-remembering one.

## Context & Problem

We're building a browser version of Battlefleet Gothic from the community
Remastered rules. Phase 1 is a hotseat 1v1 cruiser duel: Lunar vs Murder.

The only source is a ~200-page, 19.6 MB PDF (`BFG-Remastered-Official-Rulebook-v1-10.pdf`,
by Simon Saier). Most of it is artwork and lore. Agents can't load it efficiently,
and text extraction mangles its tables. Without a clean reference, every agent
working on the game will make up rules from training data, and the engine will
end up built on folklore.

A first extraction attempt through the Google Drive connector got about the first
75 pages as text, with flattened tables and no scenarios. The PDF is too large for
the connector to download. This brief assumes a local environment with direct
filesystem access to the PDF.

The repo is **public**. The rulebook text and art belong to Games Workshop, and the
book itself says "for personal use only". So we must not commit the PDF or
verbatim text.

## Goals

1. An agent can answer any Phase 1 rules question by loading `docs/rules/README.md`
   plus at most two chapter files.
2. Every rule a 1v1 cruiser duel needs (Cruiser Clash, Lunar vs Murder) is
   present, with a stable rule ID and a page reference.
3. Every in-scope table has been verified against a rendered image of its page,
   not just against extracted text.
4. Nothing committed contains the PDF or verbatim rulebook prose.
5. When a new rulebook version ships, extraction can be repeated with committed
   tooling.

## Non-Goals

- Game code of any kind. That's the next brief.
- The full book. Lore, campaigns, the Armageddon and Black Crusade material, and
  out-of-scope rules (see D10) are not extracted.
- Ship profiles from the separate Remastered Fleets book.
- Machine-readable data files (JSON/YAML). The engine will get typed constants
  later that cite rule IDs. The markdown stays the only source of truth.
- Resolving rules ambiguities. Log them (D12), don't adjudicate.
- Layout polish, images or diagrams.

## Architecture / Approach

```
docs/rules/
  README.md               # index: one line per file, source version, page-number convention, ID scheme
  glossary.md             # game terms → one-line definition + rule ID
  AMBIGUITIES.md          # unclear/contradictory rules found during extraction
  01-fundamentals.md      # scale, dice, bearing compass, set-up, ship types, data sheets (pp.36–44)
  02-leadership.md        # starting Ld, command checks, special orders (pp.45–49)
  03-turn.md              # first turn, ending the battle, turn sequence (pp.50–51)
  04-movement.md          # moves, turning, AAF/ramming, disengaging, overlapping (pp.52–57)
  05-shooting.md          # range, arcs, target priority, lances, batteries, gunnery table (pp.58–62)
  06-damage.md            # taking hits, shields, crits, blast markers, crippled, catastrophic (pp.65–71)
  07-ordnance.md          # launching/moving/attacking with ordnance, torpedoes, turrets (pp.72–78)
  08-end-phase.md         # damage control, blast marker removal (p.88)
  scenarios/
    general.md            # choosing scenarios, attackers/defenders, victory points (pp.120–123)
    cruiser-clash.md      # Scenario One (pp.128–129)
  ships/
    lunar.md              # Agrippa example data sheet (p.43)
    murder.md             # Unclean example data sheet (p.43)
tools/rules/
  extract.sh              # pdftotext for a page range → gitignored cache
  render-page.sh          # pdftoppm a page → PNG for table verification
  check.py                # number-diff + verbatim-shingle check (source range vs md file); --ids checks ID uniqueness
```

Pipeline for each chapter:

1. **Extract.** `extract.sh` puts raw text for the page range into `.cache/rules-raw/`
   (gitignored).
2. **Rewrite.** Turn the raw text into terse, structured markdown per D2–D9.
3. **Verify tables.** Render every page that has a table with `render-page.sh`,
   read the values off the image, and mark the table as verified (D7).
4. **Mechanical check.** Run `check.py <first> <last> <md-file>`. It reports
   (a) numbers in the source that are missing from the markdown and (b) any
   12-word run shared with the source. Explain or fix every hit.
5. **Review.** Put the check report in the PR description.

## Decisions & Defaults

- **D1.** The source of truth is *Battlefleet Gothic Remastered Rulebook v1.10*
  (Simon Saier). Every file in `docs/rules/` starts with the line
  `Source: BFG Remastered Rulebook v1.10`.
- **D2.** Rewrite, don't transcribe. Restate every rule in our own terse,
  spec-like words. Quote the book only when exact wording decides a ruling, keep
  the quote to one sentence or less, and cite its page. The repo is public and
  the text is GW's.
- **D3.** Never commit the PDF or raw extracted text. Raw text goes in
  `.cache/rules-raw/`, which is gitignored along with `*.pdf`. Scripts find the
  PDF through the `BFG_RULEBOOK_PDF` environment variable.
- **D4.** Use exactly the file layout in *Architecture / Approach*. If a chapter
  file grows past ~16 KB (~4k tokens), split it into `NN-name-a.md` / `NN-name-b.md`
  and list both in the README.
- **D5.** Every `##` and `###` heading carries a bracketed rule ID:
  `### Gunnery table [shoot.gunnery-table]`. IDs are lower-kebab with a chapter
  prefix: `fund`, `ld`, `turn`, `move`, `shoot`, `dmg`, `ord`, `end`, `scen`,
  `ship`. IDs must be unique across `docs/rules/`. Once merged, an ID never
  changes. If a heading is renamed, the old ID stays as an alias in the glossary.
- **D6.** Put the page reference `(p.N)` right after the ID, using the book's
  **printed** page numbers, not PDF page indices. Record the printed-to-PDF
  offset in `README.md`.
- **D7.** Write tables as markdown tables. Check every value against a rendered
  image of the page, then add `<!-- verified: page image p.N -->` directly under
  the table. A table without that comment counts as unverified and fails review.
- **D8.** Keep the book's worked examples as `> **Example [id]:**` blockquotes,
  with every number, die roll and ship name exactly as printed. They'll become
  test fixtures.
- **D9.** Drop lore, fiction, in-universe quotes, art captions and flavour text.
  Keep a designer note only if it changes or clarifies how a rule is played, as
  a `> **Note:**` blockquote.
- **D10.** Extract only these: pp.36–62 (The Rules through Weapons Batteries),
  pp.65–78 (Damage through Torpedoes, including Turrets), p.88 (Damage Control,
  Blast Marker Removal), pp.120–123 (scenario general rules, Victory Points) and
  pp.128–129 (Cruiser Clash). Anything skipped inside those ranges (Nova Cannon,
  Area Effects, Boarding Torpedoes, Attack Craft, Squadrons, Boarding Actions,
  Hit-and-Run) gets a stub heading with an ID, its page range and the line
  `_Not extracted — outside Phase 1 scope._`
- **D11.** Phase 1 ship profiles are the example data sheets on p.43: *Agrippa*
  (Lunar class) and *Unclean* (Murder class), each at Leadership 7 as printed.
  Don't consult the Fleets book.
- **D12.** Don't silently resolve an unclear or contradictory rule. Add it to
  `docs/rules/AMBIGUITIES.md` with an `amb-NNN` ID, the rule ID(s), the page,
  each possible reading and a proposed reading. Write the rule file using the
  proposed reading and mark it `(see amb-NNN)`.
- **D13.** Use the book's game terms exactly as printed, with the same
  capitalization and punctuation (Weapons Battery, Lance, Blast Marker,
  Brace for Impact!, All Ahead Full, Lock On, Burn Retros, Come to New Heading,
  Reload Ordnance), even though the surrounding prose is rewritten.
- **D14.** Keep units in cm and degrees, as the book uses them. No conversions.
- **D15.** The `tools/rules/` scripts are POSIX shell and Python 3 standard
  library only, plus poppler (`pdftotext`, `pdftoppm`). No pip dependencies.
- **D16.** Add a `CLAUDE.md` at the repo root that says rules live in
  `docs/rules/` (start at `README.md`), that code, tests and briefs cite rule
  IDs, and that any rule not found there gets logged as an ambiguity, never
  invented.

## Open Questions

- **Q1.** Rewritten (repo stays public) or verbatim (repo goes private)?
  — *proposed default:* rewritten, public (D2).
- **Q2.** Is the D10 scope cut right? It skips attack craft, boarding and
  squadrons now, at the cost of a second extraction pass later.
  — *proposed default:* yes, as written.
- **Q3.** The book mentions FAQ runs (2021–22 and 2023–24, maintained by Roy
  "horizon" Amkreutz) where its wording differs from the original sources. Do
  we pull those in? — *proposed default:* no. v1.10 as printed is authoritative,
  and any conflict we hear about goes in `AMBIGUITIES.md`.
- **Q4.** If Cruiser Clash's set-up calls for celestial phenomena or battlezone
  generation (pp.102–117), do we extract those rules? — *proposed default:* no.
  Add a stub with ID and pages, and decide what to play on in the game brief.

## Acceptance Criteria

1. `docs/rules/README.md` lists every rules file with a one-line summary, the
   source version, the printed-to-PDF page offset and the ID convention.
2. Every `##`/`###` heading in `docs/rules/**/*.md` carries an ID and a page
   reference. A grep for headings missing `[` comes back empty.
3. Rule IDs are unique across `docs/rules/`. `check.py --ids` exits 0.
4. The Gunnery Table, Critical Hits Table, Catastrophic Damage Table, Starting
   Leadership table and both data sheets each carry a D7 verification comment,
   and the reviewer's spot-check of ≥3 values per table against the page image
   passes.
5. The ship files match this independent extraction from the Drive text:
   - **Lunar:** Cruiser/8, Speed 20 cm, Turns 45°, Shields 2, Armour 6+ front / 5+,
     Turrets 2. Port and Starboard Lance Battery 30 cm, Str 2, Left/Right.
     Port and Starboard Weapons Battery 30 cm, FP 6, Left/Right. Prow Torpedoes
     speed 30 cm, Str 6, Front.
   - **Murder:** Cruiser/8, Speed 25 cm, Turns 45°, Shields 2, Armour 5+,
     Turrets 2. Port and Starboard Weapons Battery 45 cm, FP 10, Left/Right.
     Prow Lance Battery 60 cm, Str 2, Front.

   If the page image disagrees with these values, the page image wins. Log the
   disagreement in the PR.
6. The ramming worked example (*Agrippa* rams *Unclean*: 8D6 vs Armour 5 rolling
   1,2,3,3,4,5,5,6 for 3 damage; *Unclean* returns 4D6 vs Armour 6 rolling
   3,3,5,6 for 1 damage) appears as a D8 example block with all numbers intact.
7. Every PR description includes the `check.py` report, and every unmatched
   number or verbatim-shingle hit in it is explained.
8. `git ls-files` shows no `.pdf` and nothing under `.cache/`. `.gitignore`
   covers both.
9. `CLAUDE.md` exists and contains the D16 pointer.

## Out of Scope (parking lot)

- Extracting attack craft, boarding, squadrons, celestial phenomena and the
  remaining scenarios once a later phase needs them.
- The Remastered Fleets book (full ship lists, fleet rules, points).
- Typed TS rule constants generated from the markdown.
- An agent skill or MCP tool for "look up a rule by ID". Grep is fine for now.
- Diffing v1.10 against a future rulebook version.

---

## Proposed Decomposition

Brief: `BRIEF-rules-reference.md`. One issue = one PR = one reviewable decision.

### Issue 1 — Conventions, tooling and exemplar chapter (deps: none)

**Scope:** Set up the scaffolding and prove the conventions on the hardest
chapter. Shooting has a table, worked examples and dense modifiers, so it
exercises everything.

**Deliverable:** `.gitignore` entries; `tools/rules/{extract.sh,render-page.sh,check.py}`;
`docs/rules/README.md` (complete conventions, index rows for Shooting only);
`docs/rules/glossary.md` and `AMBIGUITIES.md` (seeded from Shooting);
`docs/rules/05-shooting.md`; `CLAUDE.md`.

**Acceptance:** AC 1–4 and 7–9 hold for everything delivered. `check.py` runs
against `05-shooting.md` and its report is in the PR.

**Relevant D&D:** D1–D9, D12–D16.

### Issue 2 — Core rules: fundamentals, leadership, turn, movement (deps: #1)

**Scope:** Extract pp.36–57.

**Deliverable:** `01-fundamentals.md`, `02-leadership.md`, `03-turn.md`,
`04-movement.md`, plus new README index rows and glossary entries for each.

**Acceptance:** AC 2–4 and 7 for these files, and AC 6 (the ramming example
lives in `04-movement.md`).

**Relevant D&D:** D1–D10, D12–D14.

### Issue 3 — Damage, ordnance, end phase (deps: #1)

**Scope:** Extract pp.65–78 and p.88, with stubs for excluded subsections per D10.

**Deliverable:** `06-damage.md`, `07-ordnance.md`, `08-end-phase.md`, plus
README rows and glossary entries.

**Acceptance:** AC 2–4 and 7 for these files. The Critical Hits and
Catastrophic Damage tables are verified per D7.

**Relevant D&D:** D1–D10, D12–D14.

### Issue 4 — Scenario and ships (deps: #1)

**Scope:** Extract the scenario general rules, Cruiser Clash and the two
example data sheets, then finalize the index.

**Deliverable:** `scenarios/general.md`, `scenarios/cruiser-clash.md`,
`ships/lunar.md`, `ships/murder.md`, and a README index covering all files.

**Acceptance:** AC 1–5 and 7. The README lists every file in `docs/rules/`.

**Relevant D&D:** D1–D14, and the Q4 default.
