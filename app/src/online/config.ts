/** Where the game server is (network/SPEC.md §7.3). Without one, online play is hidden. */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL ?? "").replace(/\/$/, "");
export const ENGINE_BUILD: string = import.meta.env.VITE_ENGINE_BUILD ?? "dev";
export const ONLINE = SERVER_URL !== "";

export function socketUrl(gameId: string): string {
  const url = new URL(`${SERVER_URL}/games/${encodeURIComponent(gameId)}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** The link that hands a seat to a friend: the token rides in the fragment, which never reaches a server. */
export function inviteLink(gameId: string, token: string): string {
  const here = new URL(window.location.href);
  here.hash = `join=${gameId}.${token}`;
  return here.toString();
}

/** `#join=<gameId>.<token>` in the current URL, if any. */
export function joinFromHash(hash: string): { gameId: string; token: string } | null {
  const m = /^#join=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(hash);
  return m === null ? null : { gameId: m[1] ?? "", token: m[2] ?? "" };
}
