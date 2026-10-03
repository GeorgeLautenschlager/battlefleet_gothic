"""Build rules/fleets/*.md from the BFG Remastered Fleets PDF.

    python tools/fleets_extract/build.py [--pdf PATH] [--out DIR] [--report DIR]

Defaults: PDF and output paths relative to the repo root. --report writes dropped.txt (ship
background paragraphs that were removed) and coverage.json (pages whose words don't fully
match the raw PDF text) for review. Run check.py afterwards.
"""
import argparse, json, os, re, shutil, subprocess, sys
from collections import Counter

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from convert import page_to_blocks, FACTION_LABEL_SET
from config import (BOOK_VERSION, PLAN, LORE, CUT_FROM, KEEP_PAGES, KEEP_PREFIX, OVERRIDES, FIXES, LABELS)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def words(t):
    return Counter(re.findall(r"[a-z]{3,}", t.lower().replace("’", "'")))


def raw_text(pdf, doc, p):
    """Independent text for the completeness check: pdftotext if installed, else PyMuPDF plain text."""
    if shutil.which("pdftotext"):
        r = subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(p), "-l", str(p), pdf, "-"],
                           capture_output=True)
        return r.stdout.decode("utf-8", "replace")
    return doc[p - 1].get_text()


def process(doc, p, vessel, ctx):
    if p in OVERRIDES:
        return OVERRIDES[p]
    blocks = page_to_blocks(doc, p)
    rw = words(raw_text(ctx["pdf"], doc, p)); mw = words(" ".join(t for _, t in blocks))
    tot = sum(rw.values())
    if tot >= 15:
        cov = 1 - sum((rw - mw).values()) / tot
        if cov < 0.97:
            ctx["coverage"].append((p, round(cov, 3), tot, sorted((rw - mw).items(), key=lambda x: -x[1])[:12]))
    cut = CUT_FROM.get(p); cutting = False
    res = []; seen_table = False; has_ship = False; diagram_noted = False; pending_fleetlists = False
    for kind, text in blocks:
        if kind == "table":
            seen_table = True; res.append(text); continue
        if kind == "diagram":
            if not diagram_noted:
                res.append(f"*(A diagram/map on p. {p} is not transcribed.)*"); diagram_noted = True
            continue
        if kind == "h3s" or (kind in ("h2", "h3") and re.search(r"\bPTS\b|PTS:", text)):
            if text.upper() in FACTION_LABEL_SET: continue
            m = re.match(r"^(.*?)\s*(BASE:\s*)?(\d+\s*PTS|PTS:)\s*(.*)$", text)
            if m and m.group(1).strip():
                pts = m.group(3).replace("PTS:", "pts:").replace("PTS", "pts")
                rest = m.group(4).strip().lower()
                line = f"## {m.group(1).strip()} — {pts}{' (base)' if m.group(2) else ''}{(' ' + rest) if rest else ''}  *(p. {p})*"
                has_ship = True
                # reading order sometimes puts the stat table before the ship's name
                if seen_table and not any(r.startswith("## ") and "pts" in r for r in res):
                    res.insert(0, line)
                else:
                    res.append(line)
                continue
            res.append(f"### {text}"); continue
        if kind == "h2": res.append(f"## {text}"); continue
        if kind == "h3": res.append(f"### {text}"); continue
        if kind == "h4": res.append(f"#### {text}"); continue
        if kind == "label":
            u = text.strip().upper()
            if u.startswith("FLEET LISTS"):
                rest = text.strip()[len("FLEET LISTS"):].strip()
                if rest: res.append(f"*Fleet lists:* {rest}")
                else: pending_fleetlists = True
                continue
            res.append(LABELS.get(u, f"**{text.strip()}**")); continue
        if kind == "boldline": res.append(f"**{text}**"); continue
        if kind == "item": res.append(f"- {text}"); continue
        # para
        if cut and text.startswith(cut): cutting = True
        if cutting: continue
        if text.startswith("FLEET LISTS"):
            res.append("*Fleet lists:* " + text[len("FLEET LISTS"):].strip()); continue
        if pending_fleetlists:
            res.append("*Fleet lists:* " + text); pending_fleetlists = False; continue
        if re.match(r"^\*\*Famous Ships", text) and res and res[0].startswith("## ") and len(res) > 1 and res[1].startswith("|"):
            res.insert(1, text); continue
        plain = not re.match(r"^(\*\*|#|- |\*|\||\d+[.)] )", text)
        # ship background: long prose after the stat table on a ship page
        if vessel and has_ship and seen_table and plain and p not in KEEP_PAGES \
                and len(text.split()) >= 25 and not text.startswith(KEEP_PREFIX):
            ctx["dropped"].append(f"[DROP p{p}] {text}"); continue
        res.append(text)
    return "\n\n".join(res)


def postprocess(path, txt):
    # sentence split across a page break: "...the Nova\n\n<!-- p. 304 -->\ncannon is..."
    txt = re.sub(r"([a-z,;\-–])\n\n(<!-- p\. \d+ -->)\n([a-z(])", r"\1 \2 \3", txt)
    txt = re.sub(r"(?m)^(- .*)\n\n(?=- )", r"\1\n", txt)   # tighten lists
    # two-line label "Famous Ships of / the Gothic War:" gets split around the names
    txt = re.sub(r"\*\*Famous Ships of\*\*\n\n(.*?) ?\*\*the Gothic War:\*\* ?(.*)",
                 lambda m: "**Famous Ships of the Gothic War:** " + (m.group(1) + " " + m.group(2)).strip(), txt)
    if path != "points-index.md":   # titles wrapped onto two lines -> one heading
        txt = re.sub(r"(?m)^(#{2,4}) ([^\n]+)\n\n\1 ([^\n]+)$", r"\1 \2 \3", txt)
    for fpath, old, new in FIXES:
        if fpath == path:
            if old not in txt:
                raise SystemExit(f"FIXES entry no longer matches {path}: {old!r} (check config.FIXES)")
            txt = txt.replace(old, new)
    if path == "points-index.md":
        def fix_tbl(m):
            rows = m.group(0).strip().split("\n")[2:]
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
            cells = [c for c in cells if c and c[0] and not re.fullmatch(r"\d{1,3}", c[0])]
            if not cells: return ""
            title = cells[0][0] if (len(cells[0]) < 2 or not cells[0][1]) else None
            body = cells[1:] if title else cells
            out = (f"### {title}\n\n" if title else "") + "| Ship | Points |\n|---|---|\n"
            out += "\n".join(f"| {c[0].rstrip('.')} | {c[1] if len(c) > 1 else ''} |" for c in body)
            return out + "\n"
        txt = re.sub(r"(?m)^\|   \|   \|\n\|---\|---\|\n(?:^\|.*\|\n?)+", fix_tbl, txt)
        # category names that came out as plain lines -> headings
        txt = re.sub(r"(?m)^(?![#|<*\s-])([A-Z][^\n|]{2,60})$", r"### \1", txt)
    return re.sub(r"\n{3,}", "\n\n", txt)


# ---------------------------------------------------------------- index README

def slug(h):
    return re.sub(r"[^\w\- ]", "", h.strip().lower()).replace(" ", "-")


FACTIONS = {"imperial-navy": "Imperial Navy", "space-marines": "Space Marines", "adeptus-mechanicus": "Adeptus Mechanicus",
            "inquisition": "Inquisition", "rogue-traders": "Rogue Traders", "chaos": "Chaos", "eldar": "Eldar (Craftworld & Corsair)",
            "dark-eldar": "Dark Eldar", "orks": "Orks", "necrons": "Necrons", "tyranids": "Tyranids", "tau": "Tau"}


def faction_of(f):
    if f.startswith("tau/allies"): return "Tau allies"
    if "/" in f: return FACTIONS[f.split("/")[0]]
    return {"planetary-defences.md": "Planetary defences", "additional-vessels.md": "Additional vessels"}.get(f, f)


def page_range(path):
    for p, _, pages, _ in PLAN:
        if p == path: return f"{pages[0]}–{pages[-1]}"
    return ""


def write_index(out_dir, coverage, n_pages):
    ships = []; lists = []
    for path, _, _, _ in PLAN:
        if path == "points-index.md": continue
        seen = {}
        for l in open(os.path.join(out_dir, path), encoding="utf-8"):
            m = re.match(r"^(#{2,4}) (.+?)\s*$", l)
            if not m: continue
            h = m.group(2); s = slug(h); n = seen.get(s, 0); seen[s] = n + 1
            anchor = s if n == 0 else f"{s}-{n}"
            if len(m.group(1)) != 2: continue
            mm = re.match(r"^(.*?) — (.*?)\s+\*\(p\. (\d+)\)\*$", h)
            if mm:
                ships.append((mm.group(1), mm.group(2), path, anchor, mm.group(3)))
            elif path != "general.md" and re.search(r"FLEET LIST|FLEETS LIST|FLEET$|PLAGUEFLEET|PLEASUREFLEET|CLANZ|WOLF PACKS", h):
                lists.append((h, path, anchor))
    listnote = {"eldar-corsairs-fleet-list": "Eldar Corsairs (Gothic Sector)",
                "eldar-corsairs-fleet-list-1": "Eldar Corsairs (later Gothic War)"}
    def faction_pages(key):   # first to last page of the faction's files (excluding Tau allies)
        pages = [pg for p, _, pp, _ in PLAN if p.startswith(key + "/") and p != "tau/allies.md" for pg in pp]
        return f"{min(pages)}–{max(pages)}"
    faction_rows = "\n".join(
        f"| {name} | [rules]({key}/rules.md) | [vessels]({key}/vessels.md) | {faction_pages(key)} |"
        for key, name in FACTIONS.items())
    o = [f"""# Fleet Lists & Ship Profiles — Index

A markdown extraction of **`BFG-Remastered-Official-Fleets_WIP.pdf`** (*Battlefleet Gothic Remastered — Fleets*, **{BOOK_VERSION}**, {n_pages} pages; fan compilation by Simon Saier et al.). It complements the core rules in [`../`](../README.md).

Generated by [`tools/fleets_extract`](../../tools/fleets_extract/README.md). **Don't edit these files by hand**: change `config.py` and rebuild.

- **Page refs**: `(pg. 53)` (written by the book) and `*(p. 53)*` / `<!-- p. 53 -->` (added here) are this book's page numbers, which match the PDF page index.
- **What's included**: all special rules, fleet lists, refits, scenarios, and every ship/defence profile with points, options and special rules. Tables (profiles, weapons, D6 charts) are reproduced cell for cell.
- **What's omitted**: faction histories and other lore pages, the background paragraphs on ship pages, artwork, and the content of diagrams/maps (a note marks where one appears).
- **WIP source**: the book is a work in progress. Placeholders like `pg [???]` and typos (e.g. the Rogue Trader Endeavour's turns "90" on p. 181) are reproduced as printed.

## How the files are organised

| File | Contents | Book pages |
|---|---|---|
| [general.md](general.md) | Using fleet lists, points values, forming up the fleet, squadrons, reserves, allies matrix, refits, special torpedoes, torpedo bombers, orbital mines | {page_range('general.md')} |
| `<faction>/rules.md` | Faction special rules, campaign rules, and all of that faction's fleet lists | |
| `<faction>/vessels.md` | Every ship of that faction: points, profile, armament, special rules, options, which fleet lists use it | |
| [rogue-traders/scenarios.md](rogue-traders/scenarios.md) | Six Rogue Trader scenarios | {page_range('rogue-traders/scenarios.md')} |
| [tau/allies.md](tau/allies.md) | Demiurg, Nicassar and Kroot rules, Xenos fleet list and vessels | {page_range('tau/allies.md')} |
| [planetary-defences.md](planetary-defences.md) | High/low orbit defences: star forts, Blackstone Fortresses, stations, platforms, mines, monitors, silos | {page_range('planetary-defences.md')} |
| [additional-vessels.md](additional-vessels.md) | Escort carriers, Q-ships, armed freighters, heavy transports (usable by most fleets) | {page_range('additional-vessels.md')} |
| [points-index.md](points-index.md) | The book's one-page-per-faction points summary | {page_range('points-index.md')} |

| Faction | Rules & fleet lists | Vessels | Book pages |
|---|---|---|---|
{faction_rows}

## Ship entry format

Every ship is a `##` heading of the form `## NAME — N pts  *(p. X)*`, followed by:

1. `**Famous Ships:**` (when given)
2. A profile table: `Type/Hits | Speed | Turns | Shields | Armour | Turrets`
3. An armament table: `Armament | Range/Speed | Firepower/Str | Fire Arc`
4. `**Special:**`, `**Options:**` and `**Notes:**` bullet lists
5. `*Fleet lists:*` — the fleet lists (with page numbers) that can field it

Some entries carry several profiles (Tau configurations, Tyranid weapon choices, Eldar dragonship options). Tyranid costs are base costs plus chosen weapons. To list every ship heading: `grep -rn "^## .* pts" rules/fleets`.

## Fleet lists

| Fleet list | File |
|---|---|"""]
    for h, f, a in lists:
        o.append(f"| [{listnote.get(a, h.title().replace(chr(39) + 'S', chr(39) + 's'))}]({f}#{a}) | {faction_of(f)} |")
    o.append("| [Rogue Traders (basic list)](rogue-traders/rules.md#rogue-traders) | Rogue Traders |")
    o.append(f"\n## Ship index\n\nAll {len(ships)} entries with a points value, grouped by file, in book order.\n")
    cur = None
    for name, pts, f, a, p in ships:
        if f != cur:
            cur = f; o.append(f"\n### {faction_of(f)} — [{f}]({f})\n\n| Ship | Points | Page |\n|---|---|---|")
        nice = name.title().replace("’S", "’s").replace("'S", "'s")
        o.append(f"| [{nice}]({f}#{a}) | {pts} | {p} |")
    o.append(f"""
## Extraction notes

- Built by `tools/fleets_extract/build.py`; verified by `tools/fleets_extract/check.py` (profile/armament row shapes, mid-sentence paragraph fragments, links).
- At build time every page's words are compared with the raw PDF text. {len(coverage)} pages are below 97%, essentially all because their diagram/map labels are deliberately not transcribed.
- Hand transcriptions and source corrections live in `config.py` (`OVERRIDES`, `FIXES`), e.g. the Tyranid flowchart on p. 417.
""")
    open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8").write("\n".join(o) + "\n")
    return len(ships), len(lists)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", default=os.path.join(REPO, "BFG-Remastered-Official-Fleets_WIP.pdf"))
    ap.add_argument("--out", default=os.path.join(REPO, "rules", "fleets"))
    ap.add_argument("--report", help="directory for dropped.txt and coverage.json")
    a = ap.parse_args()
    doc = pymupdf.open(a.pdf)
    ctx = {"pdf": a.pdf, "coverage": [], "dropped": []}
    for path, title, pages, vessel in PLAN:
        keep = [p for p in pages if p not in LORE]
        parts = [f"# {title}\n\n*Source: BFG Remastered Fleets ({BOOK_VERSION}), pp. {pages[0]}–{pages[-1]}. "
                 f"Page refs like (pg. 53) / (p. 53) are this book's page numbers. Lore and ship background text omitted.*\n"]
        for p in keep:
            body = process(doc, p, vessel, ctx)
            if body.strip():
                parts.append(f"<!-- p. {p} -->\n{body}")
        fp = os.path.join(a.out, path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        with open(fp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(postprocess(path, "\n\n".join(parts)) + "\n")
        print(f"{path:34} {len(keep):3} pages")
    n_ships, n_lists = write_index(a.out, ctx["coverage"], len(doc))
    print(f"index: {n_ships} ships, {n_lists} fleet lists")
    print(f"dropped background paragraphs: {len(ctx['dropped'])}; pages below 97% coverage: {len(ctx['coverage'])}")
    for c in ctx["coverage"]:
        print("  ", c[:3], [w for w, _ in c[3][:6]])
    if a.report:
        os.makedirs(a.report, exist_ok=True)
        open(os.path.join(a.report, "dropped.txt"), "w", encoding="utf-8").write("\n\n".join(ctx["dropped"]) + "\n")
        json.dump(ctx["coverage"], open(os.path.join(a.report, "coverage.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
