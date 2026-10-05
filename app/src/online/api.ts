/** The game server's HTTP side (spec §8.1). */
import type { FactionId, PlayerId } from "@bfg/engine";
import type { ShipEntry } from "@bfg/server";
import { SERVER_URL } from "./config";

export type CreatedGame = { gameId: string; seat: PlayerId; token: string; inviteToken: string };

const ERRORS: Record<string, string> = {
  INVALID_NAME: "Names need 1–40 characters.",
  INVALID_FLEET: "The server didn't accept that fleet.",
  RATE_LIMITED: "Too many new games just now; try again in a minute.",
};

export type CreateGame = { name: string; side: PlayerId; faction: FactionId; ships: ShipEntry[]; ramming: boolean; boarding: boolean };

export async function createGame(req: CreateGame): Promise<CreatedGame> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/games`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  } catch {
    throw new Error("Couldn't reach the game server.");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<CreatedGame> & { error?: string; message?: string };
  if (!res.ok || body.gameId === undefined) {
    throw new Error(body.message ?? ERRORS[body.error ?? ""] ?? `The server said no (${body.error ?? res.status}).`);
  }
  return body as CreatedGame;
}
