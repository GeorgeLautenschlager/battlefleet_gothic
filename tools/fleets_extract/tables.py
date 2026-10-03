"""Render PyMuPDF `Table.extract()` rows as markdown.

Ship pages use one bordered table holding several logical tables (profile row, armament rows,
captions such as "Choose one prow weapon...", and a SPECIAL/OPTIONS box). Merged cells come
back as `None`, so column positions are taken from the most recent header row.
"""
import re

# Header row carried over to a following headerless table on the same page
# (e.g. an armament header that ends one table while its rows continue in the next).
# convert.page_to_blocks resets it for every page.
LAST_HDR = {"hdr": None}

HDR_WORDS = re.compile(
    r"^(d6|2d6|d3|d66|d6 roll|2d6 roll|d6\+turn roll|roll|result|results?|renown|title|notes?|score|effect|"
    r"condition|modifier|upgrade|cost|points|pts|ld|ld bonus|leadership|weapon|weapons|type|name|sub-plot|skill|"
    r"refit|engine refit|ship refit|weapons refit|extra damage|damage|range|strength|speed|turn|turn number)$", re.I)

SPECIAL_RE = re.compile(r"^(SPECIAL RULES|SPECIAL|OPTIONS|NOTES?|UPGRADES?)\b:?\s*(.*)$", re.S)


def norm(s):
    if s is None:
        return None
    s = s.replace(" ", " ").replace(" ", " ").replace("\t", " ")
    return re.sub(r"[ ]+", " ", s).strip()


def is_header(row):
    cells = [c for c in row if c]
    if len(cells) < 2:
        return False
    if all(c.upper() == c and not re.search(r"\d", c) for c in cells):
        return True
    return all(len(c) <= 25 for c in cells) and \
        sum(1 for c in cells if HDR_WORDS.match(c.strip())) >= max(1, len(cells) - 1)


def cell_md(c):
    c = c.replace("\n", " ")
    if "•" in c:
        c = "<br>".join("• " + x.strip() for x in c.split("•") if x.strip())
    return c.replace("|", "\\|")


def render(rows, page=None):
    rows = [[norm(c) for c in r] for r in rows]
    out = []; idx = None; hdr = None; buf = []

    def flush():
        nonlocal buf
        if buf:
            n = len(hdr) if hdr else max(len(b) for b in buf)
            head = hdr or (LAST_HDR["hdr"] if LAST_HDR["hdr"] and len(LAST_HDR["hdr"]) == n else [" "] * n)
            out.append(""); out.append("| " + " | ".join(head) + " |"); out.append("|" + "---|" * n)
            for b in buf:
                out.append("| " + " | ".join(cell_md(x) for x in b) + " |")
        buf = []

    for r in rows:
        nonnull = [(i, c) for i, c in enumerate(r) if c not in (None, "")]
        if not nonnull:
            continue
        # a single cell spanning the row: caption, or SPECIAL/OPTIONS box
        if len(nonnull) == 1 and len(r) >= 2 and \
                (sum(1 for c in r if c is not None) == 1 or SPECIAL_RE.match(nonnull[0][1])):
            flush(); out.append("")
            t = nonnull[0][1]
            m = SPECIAL_RE.match(t)
            if m:
                body = m.group(2).replace("\n", " ")
                out.append(f"**{m.group(1).title()}:**")
                for it in (x.strip() for x in re.split(r"\s*•\s*", body)):
                    if it:
                        out.append(f"- {it}")
            else:
                t1 = t.replace("\n", " ")
                out.append(f"**{t1}**" if t1.upper() == t1 and len(t1) < 80 else t1)
            out.append("")   # keep hdr/idx: rows after a spanning caption still use the same columns
            continue
        if is_header(r):
            flush()
            idx = [i for i, c in enumerate(r) if c not in (None, "")]
            hdr = [r[i].title() if r[i].isupper() else r[i] for i in idx]
            continue
        if idx:
            vals = []
            for k, i in enumerate(idx):
                end = idx[k + 1] if k + 1 < len(idx) else len(r)
                vals.append(next((r[j] for j in range(i, end) if j < len(r) and r[j]), ""))
            buf.append(vals)
        else:
            buf.append([c or "" for c in r if c is not None])
    if hdr:
        LAST_HDR["hdr"] = hdr   # rows may continue in the next table on the page
    flush()
    return "\n".join(out)
