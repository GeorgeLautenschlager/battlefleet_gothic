import type { Ship } from "@bfg/engine";

/** One button per ship still to act, when there's a choice. Clicking a ship on the table or its card does the same. */
export function ShipPicker({ ships, current, verb, onPick }: { ships: Ship[]; current: string | undefined; verb: string; onPick: (id: string) => void }) {
  if (ships.length < 2) return null;
  return (
    <div className="picker" role="group" aria-label={`${verb} which ship`}>
      <span className="muted small">{verb}:</span>
      {ships.map((s) => (
        <button key={s.id} type="button" aria-pressed={s.id === current} className={s.id === current ? "selected" : undefined} onClick={() => onPick(s.id)}>
          {s.name}
        </button>
      ))}
    </div>
  );
}
