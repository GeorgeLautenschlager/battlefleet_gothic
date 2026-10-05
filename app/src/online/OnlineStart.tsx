import { useState } from "react";
import { defaultNames, shipEntries, type Side } from "../game/config";
import { CountSelect, duplicates, DuplicateNames, FleetFields, RammingCheck, resize } from "../panels/FleetForm";
import { createGame } from "./api";
import type { MyGame } from "./myGames";

/** New online game: you're Player 1 and set the size of the battle; your opponent joins with a link and brings their own fleet. */
export function OnlineStart({ onCreated }: { onCreated: (game: MyGame) => void }) {
  const [side, setSide] = useState<Side>({ name: "Player 1", fleet: "imperial_navy", ships: defaultNames("imperial_navy", 1) });
  const [ramming, setRamming] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dupes = duplicates(side.ships);
  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        if (dupes.length > 0) return;
        setBusy(true);
        setError(null);
        const name = side.name.trim();
        createGame({ name, side: "p1", faction: side.fleet, ships: shipEntries(side), ramming })
          .then((g) => onCreated({ gameId: g.gameId, token: g.token, seat: g.seat, name, joinedAt: new Date().toISOString(), inviteToken: g.inviteToken }))
          .catch((err: unknown) => setError((err as Error).message))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Online</h2>
      <p className="muted">Play a friend on another device. You'll get a link to send them; they pick their own fleet.</p>
      <CountSelect value={side.ships.length} onChange={(n) => setSide({ ...side, ships: resize(side.ships, side.fleet, n) })} />
      <FleetFields
        legend="You"
        className="p1"
        side={side}
        onChange={(patch) =>
          setSide({ ...side, ...patch, ...(patch.fleet !== undefined && patch.fleet !== side.fleet ? { ships: defaultNames(patch.fleet, side.ships.length) } : {}) })
        }
        dupes={dupes}
      />
      <RammingCheck value={ramming} onChange={setRamming} />
      <DuplicateNames dupes={dupes} />
      <div className="buttons">
        <button type="submit" className="primary" disabled={busy || dupes.length > 0}>
          {busy ? "Creating…" : "Create game"}
        </button>
      </div>
      {error && <p className="rejection">{error}</p>}
    </form>
  );
}
