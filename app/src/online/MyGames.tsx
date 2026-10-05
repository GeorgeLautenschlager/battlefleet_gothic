import type { MyGame } from "./myGames";

export function MyGames({ games, onResume, onForget }: { games: MyGame[]; onResume: (g: MyGame) => void; onForget: (id: string) => void }) {
  if (games.length === 0) return null;
  return (
    <section className="new-game my-games">
      <h2>My online games</h2>
      <ul>
        {games.map((g) => (
          <li key={g.gameId}>
            <span>
              {g.name || "Joining…"}{" "}
              <span className={`muted ${g.seat ?? ""}`}>
                {g.seat === "p1" ? "Player 1 · " : g.seat === "p2" ? "Player 2 · " : ""}
                {new Date(g.joinedAt).toLocaleDateString()}
              </span>
            </span>
            <span className="buttons">
              <button type="button" className="primary" onClick={() => onResume(g)}>
                Resume
              </button>
              <button type="button" onClick={() => onForget(g.gameId)} title="Forget this game in this browser">
                Forget
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
