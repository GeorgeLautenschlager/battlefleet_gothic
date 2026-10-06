/**
 * The real Worker and Durable Object in workerd (via wrangler), driven over
 * HTTP and real WebSockets: create a game, both seats connect, setup plays
 * through, an undo, and the dice stay hidden.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { unstable_startWorker } from "wrangler";
import { PROTOCOL, type ServerMessage } from "../src/protocol";

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;
let worker: Worker;
let base: URL;

beforeAll(async () => {
  worker = await unstable_startWorker({ config: "wrangler.toml", dev: { persist: false, server: { port: 0 }, inspector: false } });
  base = await worker.url;
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
});

/** A WebSocket client that queues what it receives. */
class Client {
  readonly received: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      this.received.push(JSON.parse(String(e.data)) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async open(gameId: string): Promise<Client> {
    const url = new URL(`/games/${gameId}/ws`, base);
    url.protocol = url.protocol.replace("http", "ws");
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
    });
    return new Client(ws);
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Wait for the next message of a type (or any of several). */
  async next<T extends ServerMessage["type"]>(...types: T[]): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const i = this.received.findIndex((m) => (types as string[]).includes(m.type));
      if (i >= 0) return this.received.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`no ${types.join("/")} in ${JSON.stringify(this.received.map((m) => m.type))}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(new URL(path, base), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

const HOST = { name: "Ann", side: "p1", faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }] };

describe("the Worker", () => {
  test("health", async () => {
    const res = await fetch(new URL("/health", base));
    expect(await res.json()).toEqual({ ok: true, engine: "dev", protocol: PROTOCOL });
  });

  test("CORS: allowed origins get headers, others are refused", async () => {
    const ok = await post("/games", HOST, { Origin: "http://localhost:5173" });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    const no = await post("/games", HOST, { Origin: "https://evil.example" });
    expect(no.status).toBe(403);
  });

  test("bad requests", async () => {
    expect((await post("/games", { ...HOST, name: "" })).status).toBe(400);
    const v1 = await post("/games", { name: "Ann", shipName: "Agrippa", side: "p1" }); // a page from before fleets
    expect(v1.status).toBe(400);
    expect(await v1.json()).toMatchObject({ error: "INVALID_FLEET" });
    expect((await fetch(new URL("/games/not-a-game/ws", base))).status).toBe(404);
    await expect(Client.open("AAAAAAAAAAAAAAAA")).rejects.toThrow("socket failed"); // no such game: the handshake is refused
  });
});

describe("a game over WebSockets", () => {
  test("create, join, setup rolls, deploy, undo; dice hidden; state survives reconnects", async () => {
    const res = await post("/games", HOST);
    const { gameId, token, inviteToken } = (await res.json()) as { gameId: string; token: string; inviteToken: string };

    const ann = await Client.open(gameId);
    ann.send({ type: "hello", token, protocol: PROTOCOL, engine: "dev" });
    expect(await ann.next("welcome")).toMatchObject({ seat: "p1", status: "lobby", state: null });

    const bo = await Client.open(gameId);
    bo.send({ type: "hello", token: inviteToken, protocol: PROTOCOL, engine: "dev" });
    expect(await bo.next("welcome")).toMatchObject({ seat: "p2", status: "lobby" });
    bo.send({ type: "join", token: inviteToken, name: "Bo", faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }] });
    const started = await ann.next("welcome");
    expect(started).toMatchObject({ status: "active", seq: 0 });
    expect(started.state!.rng).toMatchObject({ seed: 0, state: 0 });
    await bo.next("welcome");

    // Setup rolls until deployment.
    let seq = 0;
    const roll = async (type: string) => {
      ann.send({ type: "propose", id: `r${seq}`, base: seq, transform: { type, player: "p1" } });
      const applied = await ann.next("applied");
      expect(applied.state.rng).toMatchObject({ seed: 0, state: 0 });
      expect((await bo.next("applied")).seq).toBe(applied.seq);
      seq = applied.seq;
      return applied.state;
    };
    await roll("roll_leadership");
    await roll("roll_zones");
    let state = await roll("roll_deploy_order");
    while (state.clock.setupStep === "roll_deploy_order") state = await roll("roll_deploy_order");

    // The first deployer deploys, then takes it back.
    const first = state.setup.firstDeployer!;
    const [mover, other] = first === "p1" ? [ann, bo] : [bo, ann];
    const zone = state.scenario.deploymentZones![state.setup.zones![first]];
    const ship = state.ships.find((s) => s.owner === first)!;
    mover.send({ type: "propose", id: "d1", base: seq, transform: { type: "deploy_ship", player: first, shipId: ship.id, position: { x: 90, y: zone.y + 5 } } });
    seq = (await mover.next("applied")).seq;
    await other.next("applied");
    other.send({ type: "undo", id: "u0", seq });
    expect((await other.next("rejected")).reason.code).toBe("NOT_YOURS");
    mover.send({ type: "undo", id: "u1", seq });
    const undone = await mover.next("undone");
    expect(undone.seq).toBe(seq - 1);
    expect(undone.state.ships.find((s) => s.id === ship.id)!.status).toBe("undeployed");

    // Reconnect: welcome brings the same state back.
    ann.close();
    const again = await Client.open(gameId);
    again.send({ type: "hello", token, protocol: PROTOCOL, engine: "dev" });
    const back = await again.next("welcome");
    expect(back.seq).toBe(seq - 1);
    expect(back.state).toEqual(undone.state);
    expect((await bo.next("presence"))).toMatchObject({ type: "presence" });

    again.close();
    bo.close();
  }, 60_000);

  test("unknown tokens and stale engines are turned away", async () => {
    const { gameId } = (await (await post("/games", { ...HOST, side: "p2" })).json()) as { gameId: string };
    const c = await Client.open(gameId);
    c.send({ type: "hello", token: "nope", protocol: PROTOCOL, engine: "dev" });
    expect((await c.next("error")).code).toBe("UNKNOWN_TOKEN");
    const d = await Client.open(gameId);
    d.send({ type: "hello", token: "nope", protocol: PROTOCOL, engine: "older" });
    expect((await d.next("error")).code).toBe("ENGINE_MISMATCH");
  }, 30_000);
});
