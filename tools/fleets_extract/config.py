"""Book-specific configuration for the Fleets book (WIP v0.36, 536 pages).

Page numbers are 1-based PDF page indices, which match the book's printed page numbers.
When a new version of the book comes out, page numbers will shift: re-check PLAN, LORE and
the other page-keyed settings against the new table of contents.
"""

BOOK_VERSION = "WIP v0.36"


def R(a, b):
    return list(range(a, b + 1))


# (output path, title, pages, vessel_mode). vessel_mode drops ship background prose (see build.py).
PLAN = [
    ("general.md", "Fleet Lists — General Rules", R(10, 23), False),
    ("imperial-navy/rules.md", "Imperial Navy — Special Rules & Fleet Lists", R(24, 51), False),
    ("imperial-navy/vessels.md", "Imperial Navy — Vessels", R(52, 85), True),
    ("space-marines/rules.md", "Space Marines — Special Rules & Fleet Lists", R(86, 101), False),
    ("space-marines/vessels.md", "Space Marines — Vessels", R(102, 111), True),
    ("adeptus-mechanicus/rules.md", "Adeptus Mechanicus — Special Rules & Fleet List", R(112, 125), False),
    ("adeptus-mechanicus/vessels.md", "Adeptus Mechanicus — Vessels", R(126, 127), True),
    ("inquisition/rules.md", "Inquisition — Special Rules & Fleet Lists", R(128, 146), False),
    ("inquisition/vessels.md", "Inquisition — Vessels", R(147, 151), True),
    ("rogue-traders/rules.md", "Rogue Traders — Special Rules & Fleet Lists", R(152, 179), False),
    ("rogue-traders/vessels.md", "Rogue Traders — Vessels", R(180, 197), True),
    ("rogue-traders/scenarios.md", "Rogue Traders — Scenarios", R(198, 211), False),
    ("chaos/rules.md", "Chaos — Special Rules & Fleet Lists", R(212, 251), False),
    ("chaos/vessels.md", "Chaos — Vessels", R(252, 289), True),
    ("eldar/rules.md", "Eldar — Special Rules, Scenario & Fleet Lists", R(290, 319), False),
    ("eldar/vessels.md", "Eldar — Vessels", R(320, 337), True),
    ("dark-eldar/rules.md", "Dark Eldar — Special Rules & Fleet List", R(338, 351), False),
    ("dark-eldar/vessels.md", "Dark Eldar — Vessels", R(352, 353), True),
    ("orks/rules.md", "Orks — Special Rules & Fleet Lists", R(354, 373), False),
    ("orks/vessels.md", "Orks — Vessels", R(374, 393), True),
    ("necrons/rules.md", "Necrons — Special Rules & Fleet List", R(394, 404), False),
    ("necrons/vessels.md", "Necrons — Vessels", R(405, 409), True),
    ("tyranids/rules.md", "Tyranids — Special Rules & Fleet Lists", R(410, 431), False),
    ("tyranids/vessels.md", "Tyranids — Vessels", R(432, 437), True),
    ("tau/rules.md", "Tau — Special Rules & Fleet Lists", R(438, 457), False),
    ("tau/vessels.md", "Tau — Vessels & Orbitals", R(458, 481), True),
    ("tau/allies.md", "Tau Allies — Demiurg, Nicassar & Kroot", R(482, 495), True),
    ("planetary-defences.md", "Planetary Defences", R(496, 517), True),
    ("additional-vessels.md", "Additional Vessels", R(518, 524), True),
    ("points-index.md", "Points Index", R(528, 535), False),
]

# Pages skipped entirely: front matter, art, faction histories, dossiers, story pages, back cover.
LORE = set(R(1, 9) + R(24, 31) + R(42, 47) + R(86, 93) + R(112, 117) + R(128, 137) + R(152, 173)
           + R(212, 221) + [223, 230] + R(290, 301) + R(338, 341) + R(354, 357) + R(394, 399)
           + R(410, 415) + R(438, 449) + [453] + R(496, 497) + R(518, 519) + R(525, 527) + [536])
# background-only continuation pages inside the vessel sections
LORE |= {127, 149, 183, 185, 193, 257, 259, 261, 265, 285, 403, 433, 459, 461, 463, 469, 471}

# Drop everything on a page from the paragraph starting with this text (lore after a rules note).
CUT_FROM = {256: "Horus Lupercal"}

# Vessel-mode pages whose prose after the stat table is rules, not background (space hulks, Ramilies...).
KEEP_PAGES = {197, 287, 288, 390, 391, 393, 501, 502, 503, 504, 505}

# Paragraphs on ship pages that look like background but carry rules.
KEEP_PREFIX = ("Iconoclast destroyers can be used", "Citadel Commerce Vessels outwardly",
               "Despite technological advances in etherdrive", "In addition, Torture class cruisers")

# Pages replaced by a hand transcription (layouts the converter can't express).
OVERRIDES = {
    417: """#### DOES THE SHIP MEET THIS CONDITION?

*(Flowchart transcribed by hand. Check the conditions in order: if NO, go on to the next one; at the first YES, the ship or squadron takes that action.)*

| # | Condition | If YES |
|---|---|---|
| 1 | Normal movement will take the ship(s) into a gas/dust cloud, asteroid field, planetary rings, minefield, warp rift or other dangerous celestial phenomena? | **Burn Retros.** A turn must be made away from the celestial phenomena. |
| 2 | Nearest enemy is in front fire arc and less than 15 cm away? *You can opt to skip this condition if the ship is armed with bio-plasma.* | No special order. Must move into contact and initiate a boarding action if possible. |
| 3 | Nearest enemy is in front fire arc and more than 90 cm away? | **All Ahead Full** (+2D6 cm instead of +4D6 cm). |
| 4 | Nearest enemy is within rear fire arc? *This condition only applies to escort ships.* | **Come to New Heading.** |
| 5 | Enemy is in front fire arc and within range/fire arc of operational bio-weapon? | **Lock On.** |
| 6 | Ordnance needs reloading? | **Reload Ordnance.** |
| 7 | None of the above conditions apply? | No special order. If there is a planet on the table, the ship/squadron must end its movement closer to it if possible. Otherwise move at half speed straight ahead. |""",
}

# (file, old, new) corrections for layout glitches in the source PDF. build.py fails if `old` is missing.
FIXES = [
    ("tau/rules.md", "## COMMERCE PROTECTION FLEET LIS\n", "## COMMERCE PROTECTION FLEET LIST\n"),
    ("tau/rules.md", "<!-- p. 457 -->\n## ST\n", "<!-- p. 457 -->\n"),
]

LABELS = {"SPECIAL": "**Special:**", "OPTIONS": "**Options:**", "NOTES": "**Notes:**", "NOTE": "**Note:**",
          "SPECIAL RULES": "**Special rules:**", "UPGRADES": "**Upgrades:**"}
