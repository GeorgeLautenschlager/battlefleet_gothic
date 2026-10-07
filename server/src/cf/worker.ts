/**
 * The Worker (spec §8.1): creates games and routes each game's WebSockets to
 * its Durable Object. CORS and origin checks for browsers; a best-effort
 * per-isolate rate limit on creating games.
 */
import type { Forces } from "@bfg/engine";
import { createRoom, type CreateRequest } from "../room";
import { isShipList, PROTOCOL, shipEntry } from "../protocol";
import { isWebSocketUpgrade, workerDeps } from "./deps";
import type { Env } from "./env";

export { GameDO } from "./durable";

const GAME_ID = /^[A-Za-z0-9_-]{16}$/;
const CREATES_PER_MINUTE = 10;
const recentCreates = new Map<string, number[]>();

function allowedOrigin(request: Request, env: Env): string | null | false {
  const origin = request.headers.get("Origin");
  if (origin === null) return null; // not a browser: no CORS needed
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin) ? origin : false;
}

function cors(origin: string | null): Record<string, string> {
  return origin === null ? {} : { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
}

function rateLimited(ip: string, now: number): boolean {
  const recent = (recentCreates.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  recentCreates.set(ip, recent);
  return recent.length > CREATES_PER_MINUTE;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (origin === false) return new Response("Origin not allowed", { status: 403 });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors(origin), "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, engine: env.ENGINE_BUILD, protocol: PROTOCOL }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/games") {
      if (rateLimited(request.headers.get("CF-Connecting-IP") ?? "local", Date.now())) {
        return json({ error: "RATE_LIMITED" }, 429, origin);
      }
      let body: Partial<CreateRequest> | null;
      try {
        body = (await request.json()) as Partial<CreateRequest> | null;
      } catch {
        return json({ error: "MALFORMED" }, 400, origin);
      }
      const ships: unknown = body?.ships;
      if (!isShipList(ships)) return json({ error: "INVALID_FLEET", message: "Expected a list of ships" }, 400, origin);
      const created = await createRoom(
        {
          name: String(body?.name ?? ""),
          side: body?.side as CreateRequest["side"],
          faction: String(body?.faction ?? "") as CreateRequest["faction"],
          ships: ships.map(shipEntry),
          ramming: body?.ramming !== false,
          boarding: body?.boarding === true,
          carriers: body?.carriers === true,
          fleetLists: body?.fleetLists === true,
          ...(body?.scenario === "fleet_engagement" || body?.scenario === "the_bait" || body?.scenario === "raiders" || body?.scenario === "surprise_attack" || body?.scenario === "blockade_run"
            ? { scenario: body.scenario as "fleet_engagement" | "the_bait" | "raiders" | "surprise_attack" | "blockade_run" }
            : {}),
          ...(body?.attacker === "p1" || body?.attacker === "p2" ? { attacker: body.attacker as "p1" | "p2" } : {}),
          ...(body?.planet === "small" || body?.planet === "medium" || body?.planet === "large" ? { planet: body.planet as "small" | "medium" | "large" } : {}),
          ...forcesOf(body?.forces),
          ...(body?.scoring === "victory_points" ? { scoring: "victory_points" as const } : {}),
        },
        workerDeps(env.ENGINE_BUILD),
      );
      if ("error" in created) return json(created, 400, origin);
      const stub = env.GAMES.get(env.GAMES.idFromName(created.data.gameId));
      if (!(await stub.init(created.data))) return json({ error: "TRY_AGAIN" }, 503, origin);
      return json({ gameId: created.data.gameId, seat: created.seat, token: created.token, inviteToken: created.inviteToken }, 201, origin);
    }

    const ws = url.pathname.match(/^\/games\/([^/]+)\/ws$/);
    if (request.method === "GET" && ws !== null) {
      const id = ws[1] ?? "";
      if (!GAME_ID.test(id)) return new Response("No such game", { status: 404 });
      if (!isWebSocketUpgrade(request)) return new Response("Expected a WebSocket", { status: 426 });
      return env.GAMES.get(env.GAMES.idFromName(id)).fetch(request);
    }

    return new Response("Not found", { status: 404, headers: cors(origin) });
  },
} satisfies ExportedHandler<Env>;

/** A points battle's forces from a request body, or nothing (Cruiser Clash). A bad limit is the engine's to refuse. */
function forcesOf(v: unknown): { forces?: Forces } {
  if (typeof v !== "object" || v === null) return {};
  const f = v as { kind?: unknown; limit?: unknown };
  return f.kind === "points" && typeof f.limit === "number" ? { forces: { kind: "points", limit: f.limit } } : {};
}
