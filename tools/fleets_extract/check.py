"""Sanity checks for the generated fleet markdown (and links across rules/).

    python tools/fleets_extract/check.py [--fleets DIR] [--rules DIR]

Exits non-zero if any check fails:
- every ship profile row has 6 cells and every armament row 4 non-empty name/arc cells
- every "## NAME — N pts" heading is followed by a profile table (known exceptions listed below)
- no paragraph starts with a lowercase letter (a sign of broken column order / split sentences)
- every relative markdown link and #anchor under rules/ resolves
"""
import argparse, glob, os, re, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
# entries that legitimately have no profile table of their own
NO_PROFILE_OK = ("ORBITAL MINE", "MINEFIELD", "AUXILIARY VESSELS", "VENERABLE BATTLE BARGE", "RAPID STRIKE VESSELS")


def slug(h):
    return re.sub(r"[^\w\- ]", "", h.strip().lower()).replace(" ", "-")


def check_fleets(d):
    errors = []; nprof = narm = 0
    for f in sorted(glob.glob(os.path.join(d, "**", "*.md"), recursive=True)):
        rel = os.path.relpath(f, d)
        txt = open(f, encoding="utf-8").read(); lines = txt.split("\n"); page = None
        for i, l in enumerate(lines):
            m = re.match(r"<!-- p\. (\d+) -->", l)
            if m: page = m.group(1)
            if l.startswith("| Type/Hits"):
                nprof += 1
                cells = [c.strip() for c in lines[i + 2].strip("|").split("|")]
                if len(cells) != 6 or not re.search(r"/\s*\d", cells[0]):
                    errors.append(f"{rel} p{page}: bad profile row: {lines[i + 2][:100]}")
            if l.startswith("| Armament"):
                j = i + 2
                while j < len(lines) and lines[j].startswith("|"):
                    narm += 1
                    cells = [c.strip() for c in lines[j].strip("|").split("|")]
                    if len(cells) != 4 or not cells[0] or not cells[3]:
                        errors.append(f"{rel} p{page}: bad armament row: {lines[j][:100]}")
                    j += 1
            if l and re.match(r"^[a-z]", l) and not (i > 0 and lines[i - 1].startswith("<!--")):
                errors.append(f"{rel} p{page}: paragraph starts mid-sentence: {l[:80]}")
        for sec in re.split(r"(?m)^(?=## )", txt):
            head = sec.split("\n")[0]
            if sec.startswith("## ") and "pts" in head and "| Type/Hits" not in sec \
                    and not head[3:].startswith(NO_PROFILE_OK):
                errors.append(f"{rel}: ship heading without profile: {head}")
    return errors, nprof, narm


def check_links(root):
    files = [os.path.normpath(f) for f in glob.glob(os.path.join(root, "**", "*.md"), recursive=True)]
    anchors = {}
    for f in files:
        seen = {}; s_ = set()
        for h in re.findall(r"^#+ (.*)$", open(f, encoding="utf-8").read(), re.M):
            s = slug(h); n = seen.get(s, 0); seen[s] = n + 1
            s_.add(s if n == 0 else f"{s}-{n}")
        anchors[f] = s_
    errors = []; total = 0
    for f in files:
        for target in re.findall(r"\]\(([^)]+)\)", open(f, encoding="utf-8").read()):
            if target.startswith(("http:", "https:", "mailto:")): continue
            total += 1
            file, _, anc = target.partition("#")
            tf = os.path.normpath(os.path.join(os.path.dirname(f), file)) if file else f
            if os.path.isdir(tf): tf = os.path.join(tf, "README.md")
            if not os.path.exists(tf):
                errors.append(f"{os.path.relpath(f, root)}: missing file {target}")
            elif tf in anchors and anc and anc not in anchors[tf]:
                errors.append(f"{os.path.relpath(f, root)}: bad anchor {target}")
    return errors, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fleets", default=os.path.join(REPO, "rules", "fleets"))
    ap.add_argument("--rules", default=os.path.join(REPO, "rules"))
    a = ap.parse_args()
    e1, nprof, narm = check_fleets(a.fleets)
    e2, nlinks = check_links(a.rules)
    for e in e1 + e2: print(e)
    print(f"profiles {nprof}, armament rows {narm}, links {nlinks}: {len(e1) + len(e2)} problem(s)")
    sys.exit(1 if e1 or e2 else 0)


if __name__ == "__main__":
    main()
