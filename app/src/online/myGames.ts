/** Online games this browser holds a seat in (spec §3): enough to resume them. */
import type { PlayerId } from "@bfg/engine";

export type MyGame = {
  gameId: string;
  token: string;
  /** Known once the server has said which seat the token holds. */
  seat?: PlayerId;
  /** Our admiral's name, once known. */
  name: string;
  joinedAt: string;
  /** The host keeps the guest's invite token so the lobby can show the link again. */
  inviteToken?: string;
};

const KEY = "bfg.myGames";

export function loadMyGames(): MyGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? (list as MyGame[]).filter((g) => typeof g?.gameId === "string" && typeof g?.token === "string") : [];
  } catch {
    return [];
  }
}

export function saveMyGame(game: MyGame): MyGame[] {
  const list = [game, ...loadMyGames().filter((g) => g.gameId !== game.gameId)].slice(0, 30);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the game still works this session.
  }
  return list;
}

export function forgetMyGame(gameId: string): MyGame[] {
  const list = loadMyGames().filter((g) => g.gameId !== gameId);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // As above.
  }
  return list;
}
