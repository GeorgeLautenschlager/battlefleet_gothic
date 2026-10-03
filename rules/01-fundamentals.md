# 01 — Fundamentals (pp. 38–49)

Source: *Battlefleet Gothic Remastered Rulebook v1.10* (fan compilation by Simon Saier of the 2007 rulebook + 2010 Compendium + FAQ 2021–2024). Page numbers refer to the PDF's printed page numbers (they match the PDF page index).

## What you will need (p. 38)

- Two or more players, models for ships, a firm level playing surface.
- Celestial objects (planets, moons, asteroid fields, dust clouds) as terrain.
- A measuring device in **centimetres**. *All distances in the rules are in cm.*
- Ordinary six-sided dice (D6), pen and paper to track damage.

## First Principles (p. 39)

### Scale
- Ship models are not to scale with planets. A ship **occupies the point in space shown by the stem of its base**.
- **Movement** is measured from the stem of the ship's base.
- **Firing range** is measured stem-to-stem (firer's stem to target's stem).
- The base represents very close range around the ship. **If something affects an area** (torpedo markers, asteroid field boundaries, etc.), **a ship is affected if its base is touched**, or if it moves so that its base contacts the hazard.

### 3D or not 3D?
- The game is played on a flat (2D) table. Ships can move and fire past each other without risk (they are assumed to be at different heights).

## Dice Rolls (p. 40)

- All dice are D6. `D6+1`, `D6-2`: roll and modify.
- `2D6`, `3D6`: roll that many and sum.
- `D6×5`: roll and multiply (5–30).
- Combinations e.g. `2D6+5` (7–17), `3D6-3` (0–15).
- **D3**: roll a D6 and halve, rounding up (1–2 → 1, 3–4 → 2, 5–6 → 3).
- **Re-rolls**: pick up the dice and roll again; the second result stands even if worse. **No single Special Order or other leadership test can be re-rolled more than once**, regardless of the source of the re-roll.

## The Bearing Compass (p. 40)

A circular template with a centre hole, used for two purposes:

1. **Fire arcs** of your own ship: place the hole over the centre of the ship's flying stand with the arrows along the ship's length. This divides space into four **90° quadrants**: front, rear, left, right.
2. **Target aspect**: place the compass over the *target* the same way. The quadrant of the target that faces the firer gives the target's aspect (closing / moving away / abeam) for the Gunnery Table.

## Set-Up (p. 41)

- **Game turn** = both players' turns. A game lasting 8 turns has 16 player turns.
- **Pre-measurement**: You *may* pre-measure movement and range unless all players agree not to.
- **Secrecy of fleet lists**: not normally secret. May be kept secret if both players agree, but must be written down; if one player asks to see the opponent's list, both reveal immediately.
- **Secrecy of sub-plots**: normally rolled openly. Same secrecy option as fleet lists; must be revealed at the end of the game.

## Ship Types (p. 42)

Three types:

- **Battleships** — largest; absorb huge damage; slow and ponderous.
- **Cruisers** — the workhorses; manoeuvrable, well-armed.
- **Escorts** — commonest; fast, lightly armed, agile. Used in squadrons.

**Capital ships** = battleships + cruisers (collective term used throughout the rules).

## Ship Data Sheets (pp. 43–44)

Each ship has a profile. The rulebook's own worked examples are the **Lunar** and **Murder** cruisers (see [ships-lunar-murder.md](ships-lunar-murder.md) for the full profiles).

| Characteristic | Meaning |
|---|---|
| **Name** | Ships deserve names (escorts maybe not). |
| **Class** | The ship's design class (e.g. Lunar, Murder). Same type can differ greatly by class. |
| **Leadership (Ld)** | Crew/captain quality. Randomly generated in one-off games (see Starting Leadership). Can change in campaigns. |
| **Type/Hits** | Type = battleship / cruiser / escort. **Hits** = damage points (same thing) the hull can take before becoming a wreck. 8 is average for a cruiser. |
| **Speed** | How far (cm) the ship moves in one turn. |
| **Turns** | Maximum angle of a turn (usually 45° or 90°). Ships normally turn once per move. |
| **Shields** | Number of hits the shields can absorb per turn before collapsing. |
| **Armour** | The D6 score needed (equal or higher) to hit/damage the ship with batteries etc. May differ by facing (e.g. `6+ front / 5+` = 6+ against shots from its front, 5+ elsewhere). |
| **Turrets** | Small quick-firing guns that shoot down incoming torpedoes and attack craft. |
| **Armament** | Main weapons and location. |
| **Range/Speed** | Max range in cm for direct-fire weapons; for ordnance (torpedoes, attack craft) this is the ordnance's **speed** instead. |
| **Firepower/Strength** | Weapon effectiveness. Weapons batteries have **Firepower**; lances and torpedoes have **Strength**. |
| **Fire Arc** | Direction(s) the weapon can fire: Front, Left, Right, Rear (or combos like Left/Front/Right). Few ships have rear weapons. |

### Base Size (p. 44)

- Two base sizes: **small (32 mm diameter)** and **large (60 mm diameter)**.
- Any ship or defence with **3+ shields OR more than 10 Hits must use a large base**.
- Any capital ship *may* elect to use a large base and then counts as having **Tractor Fields** for free (no effect other than making ramming/boarding easier due to the bigger base, in exchange for being a larger ordnance target).

## Leadership (p. 45)

Leadership represents captain and crew quality. Ships test against it to use special orders (and for some other actions).

### Starting Leadership Values (one-off games)

Roll a D6 per ship before the game:

| D6 | Leadership |
|---|---|
| 1 | Untried (Ld 6) |
| 2–3 | Experienced (Ld 7) |
| 4–5 | Veteran (Ld 8) |
| 6 | Crack (Ld 9) |

- **Escorts** roll once per squadron; the whole squadron shares the value.
- **Each capital ship rolls individually**, even if it is in a squadron.

## Special Orders (pp. 46–47)

There are **six** special orders. A ship or squadron can only ever be on **one** special order at a time. Special orders (except Brace For Impact!) are declared in the Movement Phase: choose the ship/squadron, declare the order, roll the Command check (Leadership), **then** move it.

| Order | Speed | Turns | Armament (direct fire) | Ordnance | Effect |
|---|---|---|---|---|---|
| **All Ahead Full** | Cruising speed **+4D6 cm** (one roll for whole squadron); **must move the full distance** | **None** | Half effect; **no Nova Cannon** | Full | Extra speed. Required to attempt to **ram**. |
| **Come To New Heading** | Half to full cruising speed | **Up to two** | Half effect; no Nova Cannon | Full | Extra turn. Normal restrictions apply to the second turn: e.g. a cruiser that moves 10 cm before turning must move at least 10 cm more before turning again. |
| **Burn Retros** | **Zero to half** cruising speed | Up to one | Half effect; no Nova Cannon | Full | Slow down/hold position. **Can make a single turn without moving forward first.** |
| **Lock On** | Half to full cruising speed | **None** | Full | Full | **Re-roll (missed) hit rolls for lances and weapons batteries** in the Shooting Phase. |
| **Reload Ordnance** | Half to full cruising speed | Up to one | Full | Full | All ordnance is reloaded. (Ships start the game with ordnance loaded; after firing/launching they must reload before using it again.) |
| **Brace For Impact!** | Half to full cruising speed | Up to one | Half effect; no Nova Cannon | **Half** | **4+ save on a D6 against any damage.** Cannot use any special orders at all in its next turn. |

### Brace For Impact! details (p. 47; expanded on p. 66)

- Can be declared **at ANY time** a ship faces taking damage, **before the to-hit roll is made** (including vs. ramming, being rammed, asteroid field damage).
- Protects against critical damage from any kind of **Hit & Run** attack.
- Does **NOT** protect against critical damage caused by hits that were not saved normally, nor any damage in a **boarding action** (including critical damage).
- The ship stays on Brace For Impact! **until the end of its next turn**, replacing any other special order it is on.
- If a ship **fails** the command check to brace, it cannot try again until the ship, squadron or ordnance wave currently attacking has completed its attacks.
- See [05-damage.md](05-damage.md#brace-for-impact--full-rules-p-66) for the full rules text.

## Taking Command Checks (p. 48)

- To put a ship on special orders it must pass a **Command check**: roll **2D6**; if **≤ Ld**, it passes and goes onto special orders. Then move the ship/squadron before declaring the next special order. Place a special order marker/die next to the model as a reminder.
- A ship or defence can never be on more than one special order at a time (unless its special rules say so, e.g. Ramilies Star Fort).
- All orders except Brace For Impact! must be checked in the Movement Phase **before moving** the ship.
- Each ship or squadron may attempt a Special Order **until all are under special orders or a Command check fails**.
- **If a Command check fails**, the ship does not go on special orders **and no further Command checks for special orders may be made by that fleet that turn.** (Brace For Impact! can still be declared.)
- Free command checks (e.g. Elite Command Crew, Orks on All Ahead Full) must be used before a special order is failed. After a failure, no more special orders may be declared except Brace For Impact!.
- **Only one re-roll** can be spent on a vessel/squadron per leadership check.

### Command check modifiers

- Leadership can never be modified above **10**.
- A roll of **11 or 12 always fails** unless specifically stated otherwise.

| Modifier | Condition |
|---|---|
| **−1 Under Fire** | The ship has **Blast Markers in contact with its base**. |
| **+1 Enemy Contacts** | **Any enemy ships are on special orders.** |

*Example:* Agrippa (Ld 7) wants All Ahead Full. The Chaos cruiser Unclean used Lock On last turn, so Agrippa gets +1 (Ld 8). Rolls 2+6 = 8 → passes.

### Other Leadership Tests (p. 49)

- Some actions require a Leadership test that is not a Command check: e.g. **ramming**, **safely navigating an asteroid field**, **targeting a ship other than the closest**.
- Roll the indicated number of dice; pass if total **≤ Ld**.
- Leadership tests **can be taken even if a Command check for special orders failed earlier in the turn**.
- **No modifiers apply** to leadership tests — the Under Fire / Enemy Contacts modifiers are unique to Command checks for special orders.
