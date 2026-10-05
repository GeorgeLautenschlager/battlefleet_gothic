import { useState } from "react";
import type { PlayerId } from "@bfg/engine";
import { createGame } from "./api";
import type { MyGame } from "./myGames";

/** New online game: you pick your side and names; your opponent joins with a link (spec §3, D3). */
export function OnlineStart({ onCreated }: { onCreated: (game: MyGame) => void }) {
  const [name, setName] = useState("Player 1");
  const [shipName, setShipName] = useState("Agrippa");
  const [side, setSide] = useState<PlayerId>("p1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        createGame({ name, shipName, side })
          .then((g) => onCreated({ gameId: g.gameId, token: g.token, seat: g.seat, name, joinedAt: new Date().toISOString(), inviteToken: g.inviteToken }))
          .catch((err: unknown) => setError((err as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Online</h2>
      <p className="muted">Play a friend on another device. You'll get a link to send them.</p>
      <fieldset className="sides">
        <legend>Your side</legend>
        <label className={side === "p1" ? "p1 chosen" : "p1"}>
          <input type="radio" name="side" checked={side === "p1"} onChange={() => { setSide("p1"); setShipName("Agrippa"); }} /> Imperial Navy · Lunar
        </label>
        <label className={side === "p2" ? "p2 chosen" : "p2"}>
          <input type="radio" name="side" checked={side === "p2"} onChange={() => { setSide("p2"); setShipName("Unclean"); }} /> Chaos · Murder
        </label>
      </fieldset>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
      </label>
      <label>
        Ship name
        <input value={shipName} onChange={(e) => setShipName(e.target.value)} required maxLength={40} />
      </label>
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create game"}
        </button>
      </div>
      {error && <p className="rejection">{error}</p>}
    </form>
  );
}
