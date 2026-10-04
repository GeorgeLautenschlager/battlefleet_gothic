/** An ordered list the player can rearrange: repairs and Blast Marker removal both roll down a priority list. */
export function PriorityList({
  items,
  order,
  onChange,
  onHover,
}: {
  items: Record<string, string>;
  order: string[];
  onChange: (order: string[]) => void;
  onHover?: (id: string | null) => void;
}) {
  const move = (i: number, by: number) => {
    const next = [...order];
    const [id] = next.splice(i, 1);
    if (id === undefined) return;
    next.splice(i + by, 0, id);
    onChange(next);
  };
  return (
    <ol className="priority">
      {order.map((id, i) => (
        <li key={id} onPointerEnter={() => onHover?.(id)} onPointerLeave={() => onHover?.(null)}>
          <span>{items[id] ?? id}</span>
          <span className="buttons">
            <button type="button" aria-label={`Move ${items[id] ?? id} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" aria-label={`Move ${items[id] ?? id} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Keep a user's ordering of `ids`, dropping ids that went away and appending new ones. */
export function reconcile(order: string[], ids: string[]): string[] {
  const kept = order.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}
