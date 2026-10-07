/** Surprise Attack's free defences (p. 132, transform T157–T162): the defender spends D6 × 10 points per 500 on planetary defences. */
import { useState } from "react";
import { CATALOGUE, type GameState, type PlayerId, type Transform } from "@bfg/engine";
import { Act } from "../controls/Act";
import { DEFENCE_CLASSES, MAX_MINEFIELDS, MINE_POINTS, MINEFIELD_POINTS } from "../game/config";
import { playerName } from "../players";

/** The choose_defences transform for these counts: names the game hasn't used, escorts in squadrons of up to six per class. */
export function shoppingList(state: GameState, player: PlayerId, counts: Record<string, number>, orbitalMines: number, minefields: number): Transform {
  const taken = new Set(state.ships.map((s) => s.name));
  // A squadron name the player hasn't used (the fleet may already have its "System ships").
  const squads = new Set((state.squadrons ?? []).filter((sq) => sq.owner === player).map((sq) => sq.name));
  const squadronName = (base: string): string => {
    let name = base;
    for (let k = 2; squads.has(name); k++) name = `${base} ${k}`;
    return name;
  };
  const ships: { classId: string; name: string; squadron?: string }[] = [];
  for (const classId of DEFENCE_CLASSES) {
    const profile = CATALOGUE[classId]?.profile;
    const n = counts[classId] ?? 0;
    if (profile === undefined || n === 0) continue;
    let squadron: string | undefined;
    for (let i = 0, k = 1; i < n; i++) {
      while (taken.has(`${profile.className} ${k}`)) k++;
      const name = `${profile.className} ${k}`;
      taken.add(name);
      // Escorts in squadrons of up to six, one class each.
      if (profile.type === "escort" && i % 6 === 0) {
        squadron = squadronName(`${profile.className}s`);
        squads.add(squadron);
      }
      ships.push({ classId, name, ...(profile.type === "escort" && squadron !== undefined ? { squadron } : {}) });
    }
  }
  return { type: "choose_defences", player, ships, orbitalMines, minefields };
}

export function DefenceShopping({ state, player, onApply }: { state: GameState; player: PlayerId; onApply: (t: Transform) => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mines, setMines] = useState(0);
  const [fields, setFields] = useState(0);
  const budget = state.setup.surpriseAttack?.defenceBudget ?? 0;
  const points = DEFENCE_CLASSES.reduce((n, id) => n + (counts[id] ?? 0) * (CATALOGUE[id]?.profile.points ?? 0), 0) + MINE_POINTS * mines + MINEFIELD_POINTS * fields;
  const whole = (raw: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(raw) || 0)));
  const t = shoppingList(state, player, counts, mines, fields);
  return (
    <>
      <p className="hint">
        <strong>{playerName(state, player)}</strong>, the planet's own defences: spend up to {budget} pts on top of your fleet. Whatever you don't spend is lost.
      </p>
      <div className="defence-shop">
        {DEFENCE_CLASSES.map((id) => {
          const p = CATALOGUE[id]?.profile;
          return (
            <label key={id}>
              {p?.className} ({p?.points} pts)
              <input type="number" min={0} max={16} value={counts[id] ?? 0} onChange={(e) => setCounts({ ...counts, [id]: whole(e.target.value, 16) })} />
            </label>
          );
        })}
        <label>
          Orbital mines ({MINE_POINTS} pts)
          <input type="number" min={0} max={100} value={mines} onChange={(e) => setMines(whole(e.target.value, 100))} />
        </label>
        <label>
          Minefields ({MINEFIELD_POINTS} pts)
          <input type="number" min={0} max={MAX_MINEFIELDS} value={fields} onChange={(e) => setFields(whole(e.target.value, MAX_MINEFIELDS))} />
        </label>
      </div>
      <Act state={state} transform={t} onApply={onApply} primary showReason>
        {t.type === "choose_defences" && t.ships.length + mines + fields === 0 ? "Take none" : `Buy (${points} of ${budget} pts)`}
      </Act>
    </>
  );
}
