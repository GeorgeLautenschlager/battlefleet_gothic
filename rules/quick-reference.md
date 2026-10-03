# Quick Reference

All tables in one place. Each section links to the chapter with the full rules.

## Turn sequence ([02](02-turn-sequence.md))
1. **Movement**: remove last turn's order markers (except Brace For Impact!). For each ship/squadron: optional Command check for a special order → move. **First failed Command check ends special orders for the turn** (Brace still allowed).
2. **Shooting**: direct fire ship by ship; **launch ordnance** at end of phase.
3. **Ordnance**: **both players** move ordnance (phasing player first); resolve contacts.
4. **End**: boarding / Hit-and-Run → damage control (both players) → phasing player removes D6 Blast Markers (not those touching ships).

## Dice conventions ([01](01-fundamentals.md))
- D3 = D6 ÷ 2 rounded up. A test is passed on **roll ≤ Ld**; **11–12 always fails**; Ld max **10**. Only one re-roll per test.

## Starting Leadership (D6)
| 1 | 2–3 | 4–5 | 6 |
|---|---|---|---|
| Ld 6 | Ld 7 | Ld 8 | Ld 9 |

## Command check (2D6 ≤ Ld)
- **−1** Blast Markers in base contact. **+1** any enemy ship on special orders. (Modifiers only for Command checks, not other Ld tests.)

## Special orders ([01](01-fundamentals.md#special-orders-pp-4647))
| Order | Speed | Turns | Guns | Ordnance | Effect |
|---|---|---|---|---|---|
| All Ahead Full | +4D6 cm, must move full | 0 | ½ (no NC) | Full | Needed to ram |
| Come To New Heading | ½–full | 2 | ½ (no NC) | Full | Second turn |
| Burn Retros | 0–½ | 1 | ½ (no NC) | Full | Turn without moving first |
| Lock On | ½–full | 0 | Full | Full | Re-roll misses (lances, batteries) |
| Reload Ordnance | ½–full | 1 | Full | Full | Reload torpedoes / attack craft |
| Brace For Impact! | ½–full | 1 | ½ (no NC) | ½ | 4+ save vs damage; no orders next turn; any time before hit roll |

Halving rounds **up**. NC = Nova Cannon.

## Movement ([03](03-movement.md))
- Min move **½ speed** (unless Burn Retros). Moving < 5 cm → targeted as **Defences**.
- Move before turning: battleship **15 cm**, cruiser **10 cm**, escort **0**.
- Moving through BMs: **−5 cm** (once). 0-shield ship through BMs: 1 damage on a 6.
- **Ram** (All Ahead Full only): Ld test **3D6** vs smaller type, **2D6** same type, **1D6** larger (Defence > Battleship > Cruiser > Escort). Rammer: D6 per starting hit vs target armour. Rammed: ½ starting hits (side/rear) or full (head-on/defence) vs rammer's front armour. Ignores shields.
- **Disengage** Ld test at end of move: +1 per BM within 5 cm; +3 phenomena within 15 cm; −1 per enemy ship/ordnance within 15 cm.

## Shooting ([04](04-shooting.md))
- Target the **nearest** enemy unless you pass a **2D6 Ld test**.
- **Lances**: D6 per Str, **4+** hits regardless of armour; unaffected by column shifts.
- **Batteries**: Gunnery Table → dice; each die **≥ armour** hits.
- **Column shifts**: ≤ 15 cm **left**; > 30 cm **right**; through/in contact with BMs **right**.

### Gunnery Table
Columns: **A** Defences · **B** Capital closing · **C** Capital moving away / Escort closing · **D** Capital abeam / Escort moving away · **E** Escort abeam / Ordnance

| FP | A | B | C | D | E |
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

FP > 20: look up 20 + remainder and add. Aspect: the target's quadrant (bearing compass on the **target**) facing the firer — front = closing, rear = moving away, side = abeam.

## Damage ([05](05-damage.md))
- **Shields**: each absorbs 1 hit from batteries/lances/nova cannon per turn; place a BM per absorbed hit; shields = 0 effective once BMs in contact ≥ shields. Torpedoes, bombers and rams ignore shields.
- **Crippled** at ½ hits lost: halve shields, turrets, weapons, ordnance; −5 cm speed; no nova cannon.
- **Critical**: each hull hit, D6 = **6** → roll 2D6 below. Escorts that take a critical are destroyed.

### Critical Hits (2D6)
| 2D6 | Extra | Result |
|---:|---|---|
| 2 | +0 | Dorsal armament can't fire |
| 3 | +0 | Starboard armament can't fire |
| 4 | +0 | Port armament can't fire |
| 5 | +0 | Prow armament can't fire |
| 6 | +1 | Engine Room: no turns |
| 7 | +0 | Fire!: 1 damage each End Phase unless repaired |
| 8 | +1 | Thrusters: −10 cm speed |
| 9 | +0 | Bridge Smashed: −3 Ld (no repair) |
| 10 | +0 | Shields Collapse: shields 0 (no repair) |
| 11 | +D3 | Hull Breach |
| 12 | +D6 | Bulkhead Collapse |

Can't apply → use next highest.

### Catastrophic Damage (capital ship at 0 hits, 2D6)
| 2D6 | BMs | Result |
|---:|---|---|
| 2–6 | 1 | Drifting Hulk: drifts 4D6 cm/turn, BM after each move |
| 7–8 | 1 | Blazing Hulk: drifts 4D6 cm, BM, roll again after each move |
| 9–11 | ½ start hits | Plasma Drive Overload: lance Str ½ start hits vs all within 3D6 cm |
| 12 | start hits | Warp Drive Implosion: lance Str = start hits vs all within 3D6 cm |

## Ordnance ([06](06-ordnance.md))
- **Torpedoes**: straight line, full speed every Ordnance Phase; D6 per Str vs armour (facing hit); −1 Str per hit; ignores shields; hits friends too. Premature detonation: BM (6), shot and hit, touching torpedo/fighter marker.
- **Turrets**: D6 each, **4+** = −1 torpedo Str or kill 1 attack craft. Turrets fire vs torpedoes **or** attack craft each phase, not both. Mass up to +3 from ships in base contact.
- **Fighters**: remove themselves + enemy ordnance on contact; no effect on ships; CAP.
- **Bombers**: D6 − target turrets attacks each, vs **lowest** armour; ignore shields.
- **Assault boats**: Hit-and-Run each.
- Shooting ordnance: column E, **6s** to hit (lances too).
- Ordnance through BMs: removed on **6** (once per move).
- Reload needed after any launch.

## End Phase ([07](07-end-phase.md))
- **Repairs**: 1D6 per remaining hit (½ with BMs in contact); each **6** fixes one critical/fire.
- **Boarding**: D6 + modifiers; loser takes damage = difference; criticals per results table.
- **Hit-and-Run**: D6: 1 fails, 2–6 = that result on the Critical table (escorts destroyed on 4+).

## Victory points ([11](11-scenarios.md#victory-points-pp-122123))
Destroyed: full value · Crippled capital: 25% · Disengaged: 25% if crippled else 10% · Escorts only if whole squadron destroyed · Holding the field: 50% of each hulk.

**Cruiser Clash** scoring (instead of VPs): 1 per damage point inflicted, +1 per crippled enemy, or +3 per destroyed enemy (not both). 8 turns each.
