import { victoryPoints, type GameState, type PlayerId } from "@bfg/engine";

const WHY = { destroyed: "destroyed", crippled: "crippled", disengaged: "disengaged", ran_the_blockade: "ran the blockade" } as const;

/** The game's result: the winner and the score, with where each side's victory points came from (pp. 122–123). */
export function Result({ state }: { state: GameState }) {
  const result = state.result;
  if (result === null) return null;
  const vp = state.scenario.scoring === "victory_points";
  const name = (p: PlayerId) => state.players[p].name;
  return (
    <div className="result-panel">
      <p className="result">
        {result.winner === null ? "A draw" : `${name(result.winner)} wins`} · {result.scores.p1}–{result.scores.p2}
        {vp && " victory points"}
      </p>
      {vp && (
        <ul className="vp-breakdown">
          {(["p1", "p2"] as const).map((p) => {
            const v = victoryPoints(state, p);
            return (
              <li key={p} className={p}>
                <strong>{name(p)}</strong>: {v.total}
                <ul>
                  {v.ships.map((s) => (
                    <li key={s.shipId}>
                      {state.ships.find((x) => x.id === s.shipId)?.name ?? s.shipId} {WHY[s.why]}: {s.vp}
                    </li>
                  ))}
                  {v.squadrons.map((q) => (
                    <li key={q.squadronId}>
                      {(state.squadrons ?? []).find((x) => x.id === q.squadronId)?.name ?? q.squadronId} {WHY[q.why]}: {q.vp}
                    </li>
                  ))}
                  {v.field > 0 && <li>Holding the field: {v.field}</li>}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
