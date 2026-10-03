# 04 — The Shooting Phase (pp. 58–64)

Attacks are of two sorts:
- **Direct fire**: weapons batteries, lances, nova cannon — resolved immediately.
- **Ordnance**: torpedoes and attack craft — *launched* in the Shooting Phase, resolved when they reach the target in a later Ordnance Phase. See [06-ordnance.md](06-ordnance.md).

## Direct Fire (p. 59)

A ship needs at least some weapons within range and fire arc of an enemy. Fire ships one at a time:

1. Choose a ship to fire.
2. Check it has targets within range.
3. Check it has weapons within fire arc of the target.
4. Resolve firing.
5. Choose another ship.

### Range
- Measure **stem to stem**. Weapons out of range may not fire.

### Fire Arcs
- Arcs: **front, left, right, rear** (90° quadrants via the bearing compass — see [01-fundamentals.md](01-fundamentals.md#the-bearing-compass-p-40)).
- A weapon must have the target inside its arc to fire.
- Some weapons fire into several arcs (e.g. **dorsal** mounts fire left/front/right); some fire all round.
- **Area-effect** weapons don't aim at a target and affect all around the firer.
- If the line of fire lies exactly **on the line between two arcs**, the **shooting player chooses** which arc applies (for both the attacker's weapon arc and the defender's aspect).

### Multiple Targets (p. 60)
- Usually only some weapons bear on the closest enemy. Other weapons may fire at other targets, **provided the closest enemy is shot at as a priority**.

## Target Priority (p. 60)

- A ship normally targets the **nearest enemy ship or squadron**.
- It may fire at any target it likes if it first passes a **Leadership test on 2D6**.

## Direct Firing: Lances (p. 60)

- Roll **1D6 per point of lance Strength**. Each **4, 5 or 6 hits, regardless of the target's Armour**, causing 1 damage point.
- Ships with multiple lances in a given arc may split their Strength between targets, but must still pass a leadership check to fire on any target other than the closest.
- *Example:* Agrippa's lances (Str 2) → roll 2D6, a hit for each 4+.
- Lances are **not affected by Blast Marker column shifts** (no gunnery table), though shields still absorb hits.

## Direct Firing: Weapons Batteries (p. 61)

1. Look up the battery's **Firepower**.
2. Determine the target's **type** and **aspect** (orientation): trace the line of fire to the target's base and use the bearing compass on the target to see which quadrant faces the firer:
   - Target's **front** faces firer → **Closing**
   - Target's **rear** faces firer → **Moving away**
   - Target's **side** faces firer → **Abeam** (hardest to hit)
3. Cross-reference Firepower with the target column on the **Gunnery Table** (apply column shifts) to get the number of dice.
4. Roll; each die **≥ target's Armour value** (for the facing hit) scores 1 hit (1 damage point, unless absorbed by shields).

Rules notes:
- A ship/squadron firing several gunnery-based weapons may fire them simultaneously; calculate gunnery-table dice **separately for each type** of gunnery weapon. So you don't suffer column shifts from Blast Markers created by other members of the same squadron in the same Shooting Phase. The shooter chooses the order of hits (e.g. let batteries strip shields before bombardment cannons hit).
- A battery weapon that "always counts targets as closing" still uses the far-left (Defences) column when targeting defences, applying modifiers.
- Firepower > 20 (squadrons): look up 20 and the remainder separately and add (e.g. FP 32 = 20 + 12).

### Gunnery Modifiers (p. 62)

Applied as **column shifts**. A good modifier moves **one column left** (more dice); a bad one moves **one column right** (fewer dice). You cannot shift beyond the far-left or far-right column. Even "always closing" batteries are affected.

| Condition | Shift |
|---|---|
| Target **within 15 cm** | One column **left** |
| Target **more than 30 cm** away | One column **right** |
| Target **behind intervening Blast Markers** (line of fire passes through BMs, or firer/target in base contact with BMs — see p. 69) | One column **right** |

*Example:* Unclean (FP 10) fires at closing Agrippa → 7D6. Within 15 cm → 9D6. Over 30 cm → 5D6.

### Gunnery Table (p. 62)

The columns are ordered left → right from easiest to hardest. Each column serves several target/aspect combinations:

| Column | Targets using this column |
|---|---|
| **A** | Defences (Special*) |
| **B** | Capital ship — Closing |
| **C** | Capital ship — Moving away; Escort — Closing |
| **D** | Capital ship — Abeam; Escort — Moving away |
| **E** | Escort — Abeam; Ordnance (Special*) |

| Firepower | A | B | C | D | E |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 1 | 0 | 0 |
| 2 | 2 | 1 | 1 | 1 | 0 |
| 3 | 3 | 2 | 2 | 1 | 1 |
| 4 | 4 | 3 | 2 | 1 | 1 |
| 5 | 5 | 4 | 3 | 2 | 1 |
| 6 | 5 | 4 | 3 | 2 | 1 |
| 7 | 6 | 5 | 4 | 2 | 1 |
| 8 | 7 | 6 | 4 | 3 | 2 |
| 9 | 8 | 6 | 5 | 3 | 2 |
| 10 | 9 | 7 | 5 | 4 | 2 |
| 11 | 10 | 8 | 6 | 4 | 2 |
| 12 | 11 | 8 | 6 | 4 | 2 |
| 13 | 12 | 9 | 7 | 5 | 3 |
| 14 | 13 | 10 | 7 | 5 | 3 |
| 15 | 14 | 11 | 8 | 5 | 3 |
| 16 | 14 | 11 | 8 | 6 | 3 |
| 17 | 15 | 12 | 9 | 6 | 3 |
| 18 | 16 | 13 | 9 | 6 | 4 |
| 19 | 17 | 13 | 10 | 7 | 4 |
| 20 | 18 | 14 | 10 | 7 | 4 |

Notes:
- "Capital ships" = cruisers and battleships.
- \* **Defences** (ground-based defences, satellites, and ships that moved < 5 cm) and **ordnance** targets are not affected by orientation.
- Firepower > 20: look up 20 and the remainder separately and add them.

## Splitting Fire (p. 63)

- A ship may split the firepower of its batteries or lances between several enemy vessels, **but only after halving** the weaponry for special orders, crippling, etc.
- Rulebook text: *"You cannot split weapons battery or lance fire of any type at a single target!"* (Interpretation: splitting means dividing among **different** targets; you can't divide a battery into several smaller shots at the **same** target to game the Gunnery Table.)
- Must still pass a leadership check to fire at any target besides the closest.

## Special Order: Lock On (p. 63)

- **Re-roll any missed dice to hit** for lances and weapons batteries in the Shooting Phase.
- The ship **may not turn** in its Movement Phase.

## Nova Cannon (pp. 63–64)

- Template: **5 cm outer diameter**, centre hole **1.2 cm** diameter.
- Place the template anywhere so that its edge is **between 30 and 150 cm** from the firer, in its fire arc (usually prow). It need not be centred on an enemy; it may touch several ships.
- Check range and scatter: within **45 cm** → scatter die + **1D6** cm; **45–60 cm** → **2D6** cm; **beyond 60 cm** → **3D6** cm. Move the template that far in the scatter direction. A "hit" on the scatter die → template stays put.
- After the attacker designates the target, the defender must decide whether to **brace** any ships/squadrons **before** the weapon is fired (including ships it might hit due to scatter).
- **Any target in base contact with the template** after moving takes **1 hit**. **Any target in contact with the centre hole** takes **D6 hits**, regardless of Armour. Ordnance touching the template is removed. If it touches no target, replace the template with a single **Blast Marker**.
- Line-of-sight weapon: **cannot fire through** planets, moons, asteroid fields etc. (but can fire *at* them — a direct hit places D6 Blast Markers in contact with the planet/field edge).
- **Unaffected** by Lock On or Reload Ordnance.
- Cannot be fired by ships on All Ahead Full, Burn Retros, Come To New Heading, or Brace For Impact!, or by crippled ships.
- Holofields (Eldar etc.) save against the shell hit itself (both the centre-hole hit and the single edge hit); if saved, the effect is negated and a Blast Marker is placed. Bracing saves against damage normally.

## Area Effects and Special Weapons (p. 64)

- Area-effect weapons (e.g. Necron Nightmare Field, Star Pulse Generator) don't aim at a target; they are **not blocked** by line-of-sight obstructions (hulks, minefields, celestial phenomena) and **cannot be saved by holofields**.
- Chaos Marks that affect nearby ships by area, and catastrophic events (Warp Drive Implosion, Solar Flares, etc.) are also not affected by line-of-sight obstructions.
- Exterminatus vessels (scenarios) replace their standard prow weapon with an Exterminatus one; ships with no prow weapons (e.g. Vengeance grand cruisers) cannot be Exterminatus vessels.
- Armageddon Gun vs Holofields: as for Nova Cannon.

## Special Orders and Firing (p. 64)

- Ships on **All Ahead Full, Burn Retros or Come To New Heading** **halve** weapons battery Firepower and lance Strength (**rounding up**). Nova cannon may not fire at all. Ordnance is unaffected.
- **Brace For Impact!** also halves armament and ordnance (see [05-damage.md](05-damage.md)).
