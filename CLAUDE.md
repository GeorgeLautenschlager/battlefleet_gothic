# Battlefleet Gothic (digital)

A browser implementation of *Battlefleet Gothic Remastered* (community ruleset v1.10).

## Rules reference

- The source rulebook is `BFG-Remastered-Official-Rulebook-v1-10.pdf` (202 pages). **Don't read the PDF first.** Use the markdown extraction in [`rules/`](rules/README.md).
- Start at `rules/README.md` (file map, glossary, Phase 1 scope, and a list of known ambiguities/interpretations). `rules/quick-reference.md` has every core table on one page.
- Page numbers cited in `rules/*.md` are the book's printed page numbers. They match the PDF page index, so `pdftotext -f N -l N -layout <pdf> -` gives the exact original wording.
- Ship profiles/points for fleets other than the Lunar and Murder example cruisers are **not** in this rulebook (they're in the separate *Remastered Fleets* book).

## Roadmap

- **Phase 0**: rules extracted to markdown (`rules/`). Done.
- **Phase 1**: local browser, hot-seat (two players, one machine, honour system), **Cruiser Clash** scenario with one **Lunar** vs one **Murder**. Keep it as simple as possible.
