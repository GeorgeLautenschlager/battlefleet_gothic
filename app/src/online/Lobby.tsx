import { useState } from "react";
import type { PlayerId } from "@bfg/engine";
import { inviteLink } from "./config";
import type { MyGame } from "./myGames";
import type { Remote } from "./useRemoteSource";

const SIDE: Record<PlayerId, string> = { p1: "Imperial Navy · Lunar", p2: "Chaos · Murder" };

/** Before the game starts: claim your seat, or share the invite and wait. */
export function Lobby({ remote, game }: { remote: Remote; game: MyGame }) {
  const seat = remote.seat;
  const seats = remote.lobby?.seats;
  const mine = seat !== null ? seats?.[seat] : undefined;
  const [name, setName] = useState(seat === "p1" ? "Player 1" : "Player 2");
  const [shipName, setShipName] = useState(seat === "p2" ? "Unclean" : "Agrippa");
  const [copied, setCopied] = useState(false);
  if (seat === null || seats === undefined) return <p className="muted center-note">Connecting…</p>;

  if (mine?.joined !== true) {
    return (
      <form
        className="new-game"
        onSubmit={(e) => {
          e.preventDefault();
          remote.join(name.trim(), shipName.trim());
        }}
      >
        <h2>You've been invited</h2>
        <p className="muted">
          You'll play <strong className={seat}>{SIDE[seat]}</strong>
          {(() => {
            const other = seats[seat === "p1" ? "p2" : "p1"];
            return other.name ? ` against ${other.name}` : "";
          })()}
          .
        </p>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        </label>
        <label>
          Ship name
          <input value={shipName} onChange={(e) => setShipName(e.target.value)} required maxLength={40} />
        </label>
        <div className="buttons">
          <button type="submit" className="primary">
            Join the battle
          </button>
        </div>
      </form>
    );
  }

  const link = game.inviteToken === undefined ? null : inviteLink(game.gameId, game.inviteToken);
  return (
    <section className="new-game lobby">
      <h2>Waiting for your opponent</h2>
      {link !== null ? (
        <>
          <p className="muted">Send them this link. It's their seat in this game, so share it only with them.</p>
          <div className="invite">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">The game starts when the other seat joins.</p>
      )}
      <ul className="seats">
        {(["p1", "p2"] as const).map((p) => (
          <li key={p} className={p}>
            <strong>{seats[p].name ?? "(open)"}</strong> <span className="muted">{SIDE[p]}</span>
            {p === seat && <span className="muted"> · you</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
