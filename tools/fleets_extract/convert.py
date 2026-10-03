"""Convert one PDF page of the BFG Remastered Fleets book into a list of (kind, text) blocks.

- Text: PyMuPDF spans; heading levels come from the book's fonts (RedeyeSans sizes).
- Tables: page.find_tables(), rendered by tables.render and placed by position.
- Reading order: every text line and table is an item. Large drawn boxes (sidebars, shaded
  panels) are ordered as separate regions. Wide items split the page into horizontal bands;
  narrow items inside a band are grouped into columns and read column by column.

Block kinds: h2, h3, h3s (ship names / kickers / faction labels), h4, label (SPECIAL, OPTIONS,
FLEET LISTS), boldline, item (entry with a dot-leader cost), para, table, diagram.
"""
import re
import pymupdf
from tables import render, LAST_HDR

FACTION_LABEL_SET = {"IMPERIAL NAVY", "SPACE MARINES", "ADEPTUS MECHANICUS", "INQUISITION", "INQUISTION",
    "ROGUE TRADERS", "CHAOS", "ELDAR", "DARK ELDAR", "ORKS", "NECRON", "TYRANID", "TAU", "TAU KOR’VATTRA",
    "TAU KOR’OR’VESH", "DEMIURG", "NICASSAR", "KROOT", "HIGH ORBIT DEFENCES", "LOW ORBIT DEFENCES",
    "ADDITIONAL VESSELS"}

# dot leaders between an entry and its cost: 4+ dots anywhere, or 1-3 dots right before a points value
LEADER = re.compile(r"\s*[.…]{4,}\s*|(?<=[)\w*])\s*\.{1,3}\s*(?=[+\-]?\d+\s?(?:pts|points)\b)")


def real_tables(page):
    out = []
    for t in page.find_tables().tables:
        rows = t.extract()
        if max((len(r) for r in rows), default=0) >= 2 and sum(1 for r in rows if any(c for c in r)) >= 2:
            out.append(t)
    return out


def ysort(items, tol=2.0):
    """Top-to-bottom; items within `tol` points of the same height form one row, read left-to-right."""
    items = sorted(items, key=lambda it: it[0].y0)
    out = []; row = []
    for it in items:
        if row and it[0].y0 - row[0][0].y0 > tol:
            out.extend(sorted(row, key=lambda x: x[0].x0)); row = []
        row.append(it)
    out.extend(sorted(row, key=lambda x: x[0].x0))
    return out


def _big_title(pl):
    # large Redeye headings sit on full-width banners even when their text is short
    if not (isinstance(pl, tuple) and pl and pl[0] == "line"):
        return False
    spans = [s for s in pl[1][1] if s["text"].strip()]
    return bool(spans) and all(s["font"].startswith("Redeye") and s["size"] >= 15 for s in spans)


def order_items(items):
    """items: list of (rect, payload). Bands separated by wide items, columns inside bands."""
    if not items:
        return []
    base = [r for r, pl in items if not (isinstance(pl, tuple) and pl and pl[0] == "group")] or [r for r, _ in items]
    span = max(max(r.x1 for r in base) - min(r.x0 for r in base), 1)
    result = []; band = []

    def flush_band():
        if not band:
            return
        cols = []   # cluster by horizontal overlap
        for r, pl in sorted(band, key=lambda it: it[0].x0):
            for c in cols:
                if r.x0 < max(x.x1 for x, _ in c) - 5 and r.x1 > min(x.x0 for x, _ in c) + 5:
                    c.append((r, pl)); break
            else:
                cols.append([(r, pl)])
        cols.sort(key=lambda c: min(x.x0 for x, _ in c))
        # only real columns (groups that overlap vertically) are read column by column
        yr = [(min(x.y0 for x, _ in c), max(x.y1 for x, _ in c)) for c in cols]
        if any(a[0] < b[1] - 2 and b[0] < a[1] - 2 for i, a in enumerate(yr) for b in yr[i + 1:]):
            for c in cols:
                result.extend(ysort(c))
        else:
            result.extend(ysort(list(band)))
        band.clear()

    for r, pl in ysort(items):
        if (r.x1 - r.x0) > 0.55 * span or _big_title(pl):
            flush_band(); result.append((r, pl))
        else:
            band.append((r, pl))
    flush_band()
    return result


def span_kind(s):
    f = s["font"]; size = s["size"]
    bold = bool(s["flags"] & 16) or "Bold" in f
    ital = bool(s["flags"] & 2) or "It" in f
    if f.startswith("Acumin"): return "pagenum"
    if f.startswith("Helvetica"): return "diagram"
    if f.startswith("Redeye"):
        if size >= 28: return "h2"
        if size >= 20: return "h3"
        if size >= 15.5: return "h3s"   # ship names / kickers / faction labels
        if size >= 11.5: return "h4"
        if size >= 7: return "label"
        return "labelsmall"
    if size >= 24 and len(s["text"].strip()) <= 2: return "dropcap"
    return "boldtext" if bold else ("italic" if ital else "text")


def merge_touching(lines):
    """Merge fragments on the same baseline that touch (e.g. entry + dot leader + cost)."""
    lines.sort(key=lambda x: (round(x[0].y0, 0), x[0].x0))
    merged = []
    for lb, spans in lines:
        if merged and abs(merged[-1][0].y0 - lb.y0) < 2.5 and merged[-1][0].x1 - 2 <= lb.x0 <= merged[-1][0].x1 + 4:
            sep = {"text": " ", "font": spans[0]["font"], "size": spans[0]["size"], "flags": spans[0]["flags"]}
            merged[-1] = (merged[-1][0] | lb, merged[-1][1] + [sep] + spans)
        else:
            merged.append((lb, spans))
    return merged


def fmt_line(spans, state):
    """Return (kind, text) for one line, or None."""
    kinds = [span_kind(s) for s in spans if s["text"].strip()]
    if not kinds or all(k == "pagenum" for k in kinds): return None
    if all(k == "diagram" for k in kinds): return ("diagram", "")
    parts = []
    for s in spans:
        k = span_kind(s); t = s["text"]
        if k in ("pagenum", "diagram"): continue
        if k == "dropcap":
            state["dropcap"] = t.strip(); continue
        if state.get("dropcap") and t.strip():
            t = state.pop("dropcap") + t.lstrip()
        if k == "boldtext" and t.strip():
            lead = len(t) - len(t.lstrip()); trail = len(t) - len(t.rstrip())
            t = t[:lead] + "**" + t.strip() + "**" + (t[len(t) - trail:] if trail else "")
        parts.append(t)
    text = "".join(parts).replace(" ", " ").replace(" ", " ").replace("\t", " ")
    text = text.replace("****", "").replace("** **", " ")
    had_leader = bool(LEADER.search(text))
    text = re.sub(r"[ ]{2,}", " ", LEADER.sub(" — ", text)).strip()
    main = [k for k in kinds if k not in ("pagenum", "diagram", "dropcap")]
    if not main: return None
    head = None
    for hk in ("h2", "h3", "h3s", "h4"):
        if all(k in (hk, "labelsmall") for k in main): head = hk
    if head: return (head, text.replace("**", ""))
    if all(k in ("label", "labelsmall") for k in main): return ("label", text.replace("**", ""))
    if had_leader: return ("item", text.replace("**", ""))
    if all(k == "boldtext" for k in main) and len(text) < 90: return ("boldline", text.replace("**", ""))
    return ("para", text)


def page_items(page):
    tables = real_tables(page)
    trects = [pymupdf.Rect(t.bbox) for t in tables]
    raw = []; has_diagram = False
    for b in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for l in b.get("lines", []):
            seg = []; prev = None
            for s in l["spans"]:
                if not s["text"].strip() and s["text"] != " ": continue
                if s["font"].startswith("Acumin"): continue          # page numbers
                if s["font"].startswith("Helvetica"):                # labels inside diagrams/maps
                    has_diagram = True; continue
                sb = pymupdf.Rect(s["bbox"]); c = pymupdf.Point((sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2)
                if any(t.contains(c) for t in trects): continue
                # a PDF line can straddle two columns: split it at large horizontal gaps
                if prev is not None and sb.x0 - prev.x1 > 18 and s["text"].strip():
                    raw.append(seg); seg = []
                seg.append(s); prev = sb
            if seg: raw.append(seg)
    lines = []
    for spans in raw:
        if not any(s["text"].strip() for s in spans): continue
        lb = pymupdf.Rect(spans[0]["bbox"])
        for s in spans[1:]: lb |= pymupdf.Rect(s["bbox"])
        lines.append((lb, spans))
    items = [(lb, ("line", (lb, spans))) for lb, spans in merge_touching(lines)]
    items += [(tr, ("table", t)) for t, tr in zip(tables, trects)]

    # drawn boxes are separate regions, ordered on their own and placed in the flow as one block
    W = page.rect.width; A = page.rect.get_area()
    cand = [pymupdf.Rect(dr["rect"]) for dr in page.get_drawings()]
    cand = [r for r in cand if r.width > 0.5 * W and r.height > 30 and r.get_area() < 0.8 * A]
    boxes = []
    for r in sorted(cand, key=lambda r: -r.get_area()):
        if not any(b.contains(r) or (b & r).get_area() > 0.5 * r.get_area() for b in boxes):
            boxes.append(r)
    grouped = {i: [] for i in range(len(boxes))}; rest = []
    for it in items:
        r = it[0]; c = pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
        hit = [i for i, b in enumerate(boxes) if b.contains(c)]
        (grouped[hit[0]] if hit else rest).append(it)
    for i, b in enumerate(boxes):
        if grouped[i]:
            rest.append((b, ("group", order_items(grouped[i]))))
    ordered = []
    for r, pl in order_items(rest):
        if pl[0] == "group": ordered.extend(pl[1])
        else: ordered.append((r, pl))
    if has_diagram:
        ordered.append((page.rect, ("diagram", None)))
    return ordered


def page_to_blocks(doc, p):
    """Blocks for 1-based page number p."""
    ordered = page_items(doc[p - 1])
    LAST_HDR["hdr"] = None
    blocks = []; state = {}; para = []; last = None

    def flush():
        nonlocal para
        if para: blocks.append(("para", " ".join(para)))
        para = []

    for r, (typ, payload) in ordered:
        if typ == "table":
            flush(); last = None
            blocks.append(("table", render(payload.extract(), p).strip())); continue
        if typ == "diagram":
            flush(); blocks.append(("diagram", "")); continue
        lb, spans = payload
        if last is not None and (lb.y0 < last.y0 - 2 or abs(lb.x0 - last.x0) > 120):
            flush(); last = None   # jumped to a new column / region
        res = fmt_line(spans, state)
        if res is None: continue
        kind, text = res
        if kind == "diagram":
            if not blocks or blocks[-1] != ("diagram", ""):
                flush(); blocks.append(("diagram", ""))
            last = lb; continue
        if kind == "boldline" and para and not para[-1].rstrip("*").endswith((".", ":", "!", "?", ")")) \
                and (lb.y0 - last.y1) < 0.8 * max(lb.height, 1) and not re.match(r"^\d", text):
            para.append(f"**{text}**"); last = lb; continue   # bold run continuing a paragraph
        if kind != "para":
            flush(); blocks.append((kind, text)); last = lb; continue
        if (last is None or (lb.y0 - last.y1) > 0.8 * max(lb.height, 1) or text.startswith(("•", "- "))
                or re.match(r"^\*\*[^*]+\*\*", text) and not para or re.match(r"^\d+(\.|\))\s", text)):
            flush()
        if para and para[-1].endswith("­"):
            para[-1] = para[-1][:-1] + text
        elif para and re.search(r"[A-Za-z]-$", para[-1]) and re.match(r"^[a-z]", text):
            para[-1] = para[-1] + text
        else:
            para.append(text)
        last = lb
    flush()

    out = []
    for k, t in blocks:
        # ship header split into name + cost (they sit far apart on the same baseline)
        if out and k in ("h2", "h3", "h3s", "para", "boldline") and out[-1][0] in ("h2", "h3", "h3s") \
                and re.match(r"^(BASE:\s*)?\d+\s*PTS\b|^PTS:", t.replace("**", "").strip()):
            out[-1] = (out[-1][0], out[-1][1] + " " + t.replace("**", "").strip()); continue
        cont = k == "para" and re.match(r"^[a-z(]", t)
        # paragraph continued in the next column
        if cont and out and out[-1][0] == "para" and not re.search(r"[.!?:]\**$", out[-1][1].strip()):
            out[-1] = ("para", out[-1][1] + " " + t); continue
        # bold lead-in phrase on its own line, sentence continues on the next line
        if cont and out and out[-1][0] == "boldline":
            out[-1] = ("para", f"**{out[-1][1]}** " + t); continue
        # a table beside the text interrupted the sentence: join the text, keep the table after it
        if cont and len(out) >= 2 and out[-1][0] == "table" and out[-2][0] == "para" \
                and not re.search(r"[.!?:]\**$", out[-2][1].strip()):
            tbl = out.pop(); out[-1] = ("para", out[-1][1] + " " + t); out.append(tbl); continue
        if k == "para":
            t = re.sub(r"^•\s*", "- ", t)
            if t.startswith("- "): t = re.sub(r"\s*•\s+", "\n- ", t)
            t = t.replace("­", "")
        out.append((k, t))
    return out


if __name__ == "__main__":   # debug: python convert.py <pdf> <page> [<page> ...]
    import sys
    d = pymupdf.open(sys.argv[1])
    for a in sys.argv[2:]:
        print(f"===== p{a}")
        for k, t in page_to_blocks(d, int(a)):
            print(f"[{k}] {t}")
