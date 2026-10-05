import type { GameState, PlayerId } from "@bfg/engine";
import type { Remote } from "./useRemoteSource";

/** Online status above the controls: who's here, the connection, and the end-of-game check. */
export function OnlineBanner({ remote, state }: { remote: Remote; state: GameState }) {
  const dot = (p: PlayerId) => (
    <span key={p} className={`presence ${p} ${remote.presence[p] ? "online" : "offline"}`} title={remote.presence[p] ? "Online" : "Away"}>
      {state.players[p].name}
      {p === remote.seat ? " (you)" : ""}
    </span>
  );
  return (
    <div className="online-banner">
      <div className="presences">{(["p1", "p2"] as const).map(dot)}</div>
      {remote.connection !== "open" && (
        <p className="rejection" role="status">
          Reconnecting to the game server…
        </p>
      )}
      {remote.ended !== null &&
        (remote.ended.verification.ok ? (
          <p className="verified" role="status">
            Game over. Every die checked: replaying the revealed seed gives exactly this game.
          </p>
        ) : (
          <p className="rejection" role="alert">
            Warning: the revealed dice don't reproduce this game ({remote.ended.verification.problem}).
          </p>
        ))}
    </div>
  );
}
