import { useState } from "react";
import { CATALOGUE, type PlayerId } from "@bfg/engine";
import type { Lobby as LobbyInfo, SeatInfo } from "@bfg/server";
import { asFleet, shipEntries, type Side } from "../game/config";
import { duplicates, DuplicateNames, FleetFields, resize } from "../panels/FleetForm";
import { factionName } from "../players";
import { inviteLink } from "./config";
import type { MyGame } from "./myGames";
import type { Remote } from "./useRemoteSource";

const SEAT: Record<PlayerId, string> = { p1: "Player 1", p2: "Player 2" };
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** "Cruiser Clash, 2 cruisers a side, ramming allowed, boarding allowed." */
function rulesLine(lobby: LobbyInfo): string {
  const { ramming, boarding = false } = lobby.options as LobbyInfo["options"] & { boarding?: boolean };
  return `Cruiser Clash, ${lobby.count} cruiser${lobby.count === 1 ? "" : "s"} a side, ${ramming ? "ramming allowed" : "no ramming"}, ${boarding ? "boarding allowed" : "no boarding"}.`;
}

/** "Imperial Navy: 2 × Lunar class cruiser (Agrippa, Hammer of Terra)" */
function fleetLine(seat: SeatInfo): string {
  if (seat.faction === null) return "";
  const classes = new Map<string, number>();
  for (const s of seat.ships) {
    const name = CATALOGUE[s.classId]?.profile.className ?? s.classId;
    classes.set(name, (classes.get(name) ?? 0) + 1);
  }
  const list = [...classes].map(([name, n]) => `${n} × ${name}`).join(", ");
  return `${factionName(seat.faction)}: ${list} (${seat.ships.map((s) => s.name).join(", ")})`;
}

/** Before the game starts: claim your seat with your fleet, or share the invite and wait. */
export function Lobby({ remote, game }: { remote: Remote; game: MyGame }) {
  const [copied, setCopied] = useState(false);
  const { seat, lobby } = remote;
  if (seat === null || lobby === null) return <p className="muted center-note">Connecting…</p>;
  if (!lobby.seats[seat].joined) return <JoinForm remote={remote} seat={seat} lobby={lobby} />;

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
      <p className="muted small">
        {rulesLine(lobby)}
      </p>
      <ul className="seats">
        {(["p1", "p2"] as const).map((p) => (
          <li key={p} className={p}>
            <strong>{lobby.seats[p].name ?? "(open)"}</strong>
            {p === seat && <span className="muted"> · you</span>}
            {lobby.seats[p].joined && <div className="muted small">{fleetLine(lobby.seats[p])}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The guest's form: the host has set the size of the battle; you pick your fleet and name your ships. */
function JoinForm({ remote, seat, lobby }: { remote: Remote; seat: PlayerId; lobby: LobbyInfo }) {
  const host = lobby.seats[other(seat)];
  const hostNames = host.ships.map((s) => s.name);
  const [side, setSide] = useState<Side>(() => {
    // Default to the classic matchup: whichever fleet the host didn't pick.
    const fleet = asFleet(host.faction) === "chaos" ? "imperial_navy" : "chaos";
    return { name: SEAT[seat], fleet, ships: resize([], fleet, lobby.count, hostNames) };
  });
  const dupes = duplicates([...hostNames, ...side.ships]);
  return (
    <form
      className="new-game"
      onSubmit={(e) => {
        e.preventDefault();
        if (dupes.length === 0) remote.join(side.name.trim(), side.fleet, shipEntries(side));
      }}
    >
      <h2>You've been invited</h2>
      <p className="muted">
        {rulesLine(lobby)}
      </p>
      {host.joined && (
        <p className="muted small">
          <strong className={other(seat)}>{host.name}</strong> brings {fleetLine(host)}.
        </p>
      )}
      <FleetFields
        legend="You"
        className={seat}
        side={side}
        onChange={(patch) =>
          setSide({
            ...side,
            ...patch,
            ...(patch.fleet !== undefined && patch.fleet !== side.fleet ? { ships: resize([], patch.fleet, lobby.count, hostNames) } : {}),
          })
        }
        dupes={dupes}
      />
      <DuplicateNames dupes={dupes} />
      {remote.rejection && <p className="rejection">{remote.rejection.message}</p>}
      <div className="buttons">
        <button type="submit" className="primary" disabled={dupes.length > 0}>
          Join the battle
        </button>
      </div>
    </form>
  );
}
