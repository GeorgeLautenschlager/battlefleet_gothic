# fleets_extract

Regenerates [`rules/fleets/`](../../rules/fleets/README.md) from `BFG-Remastered-Official-Fleets_WIP.pdf` (the *Battlefleet Gothic Remastered — Fleets* book). The book is a work in progress, so re-run this when a new version comes out.

## Usage

The PDF isn't in git: put it in the repo root (or pass `--pdf`).

```bash
python -m pip install -r tools/fleets_extract/requirements.txt
```

```bash
python tools/fleets_extract/build.py --report build/fleets-report
```

```bash
python tools/fleets_extract/check.py
```

- `build.py` writes every file in `rules/fleets/`, including its index `README.md`. It prints a per-page completeness check: each page's words are compared with the raw PDF text, using `pdftotext` if it's installed and PyMuPDF's plain text otherwise. Pages below 97% are listed; with v0.36 the only ones are pages whose diagram/map labels are deliberately skipped, plus pages where the raw text itself has broken words.
- `--report DIR` also writes `dropped.txt` (every ship background paragraph that was removed) and `coverage.json`. Skim `dropped.txt` after a new book version, so a rule paragraph doesn't get dropped as background.
- `check.py` fails if a profile or armament row is malformed, a ship heading has no profile, a paragraph starts mid-sentence (the sign of a column-order problem), or any link/anchor under `rules/` is broken.
- Debug a single page: `python tools/fleets_extract/convert.py <pdf> 303` prints its blocks.

Don't edit `rules/fleets/*.md` by hand: changes are lost on the next build. Put corrections in `config.py`.

## How it works

| File | Role |
|---|---|
| `convert.py` | One PDF page → `(kind, text)` blocks. Text comes from PyMuPDF spans. Heading levels come from the book's fonts (RedeyeSans: ≥28 pt page titles, ≥15.5 pt ship names, ≥11.5 pt section headings, ~10 pt SPECIAL/OPTIONS labels; Acumin = page numbers; HelveticaNeue = diagram labels). Tables come from `page.find_tables()`. |
| `tables.py` | Renders `find_tables()` rows. One bordered ship table holds the profile, armament rows, captions and SPECIAL/OPTIONS box. Merged cells come back as `None`, so columns are taken from the latest header row, and a header can carry over to a headerless table on the same page. |
| `build.py` | Runs every page in `config.PLAN`. Turns blocks into markdown (ship headings `## NAME — N pts *(p. X)*`, labels, fleet-list lines). Drops ship background prose, applies `FIXES`, writes the index README. |
| `config.py` | Everything book-specific: page ranges per output file, lore pages to skip, hand transcriptions (`OVERRIDES`), text corrections (`FIXES`), and keep/drop exceptions. |
| `check.py` | Output validation (see above). |

**Reading order.** Every text line and every table is an item. Large boxes drawn on the page (sidebars, shaded panels) are ordered as their own regions. Wide items (over 55% of the text width, or big banner titles) split the page into bands. Inside a band, items that overlap horizontally form columns, which are read left to right, but only if they also overlap vertically. PDF lines that straddle two columns are split at gaps over 18 pt. Paragraphs that continue in the next column, or around a table, are re-joined.

**Ship background.** On vessel pages, long plain paragraphs (25+ words) after the stat table are treated as background and dropped. Exceptions: `KEEP_PAGES` (rules pages within the vessel sections) and `KEEP_PREFIX` (specific paragraphs).

## Updating for a new book version

1. Check the new table of contents and adjust the page ranges in `config.PLAN`, plus the page-keyed sets (`LORE`, `KEEP_PAGES`, `CUT_FROM`, `OVERRIDES`). Set `BOOK_VERSION`.
2. Run `build.py --report …`. If a `FIXES` entry no longer matches, the build stops and names it: drop the entry if the book fixed the glitch, or update it.
3. Review the coverage list and `dropped.txt`, run `check.py`, and spot-check a few changed pages against the PDF. `convert.py <pdf> <page>` helps.

Pinned to PyMuPDF 1.28.2. Other versions may extract tables or spacing slightly differently. Don't import `pymupdf4llm` in the same process: it turns off PyMuPDF's quad corrections, which drops the spaces inside table cells.
