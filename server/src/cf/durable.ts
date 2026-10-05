/**
 * One game as a Durable Object (spec §8.2): a thin adapter around GameRoom.
 * WebSockets use the hibernation API, so an idle game costs nothing; each
 * socket's attachment remembers its connection id and seat across wake-ups.
 *
 * Storage (SQLite-backed key-value): "meta" (everything but the log and the
 * snapshot), "t:<seq>" per transform, and "snapshot".
 */
import { DurableObject } from "cloudflare:workers";
import type { GameState, PlayerId } from "@bfg/engine";
import { GameRoom, type Outgoing, type RoomData, type TransformRecord } from "../room";
import { workerDeps } from "./deps";
import type { Env } from "./env";

type Attachment = { conn: string; seat: PlayerId | null };
type Meta = Omit<RoomData, "transforms" | "snapshot">;

const key = (seq: number) => `t:${String(seq).padStart(6, "0")}`;

export class GameDO extends DurableObject<Env> {
  private room: GameRoom | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    const meta = await this.ctx.storage.get<Meta>("meta");
    if (meta === undefined) return;
    const transforms = [...(await this.ctx.storage.list<TransformRecord>({ prefix: "t:" })).values()];
    const snapshot = (await this.ctx.storage.get<GameState>("snapshot")) ?? null;
    this.room = new GameRoom({ ...meta, transforms, snapshot }, workerDeps(this.env.ENGINE_BUILD));
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a !== null) this.room.restore(a.conn, a.seat);
    }
  }

  /** RPC from the Worker: store a newly created game. False if this id is taken. */
  async init(data: RoomData): Promise<boolean> {
    if (this.room !== null) return false;
    this.room = new GameRoom(data, workerDeps(this.env.ENGINE_BUILD));
    await this.persist(-1, null);
    return true;
  }

  /** The Worker forwards WebSocket upgrades here. */
  override async fetch(request: Request): Promise<Response> {
    if (this.room === null) return new Response("No such game", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ conn: crypto.randomUUID(), seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    const a = ws.deserializeAttachment() as Attachment;
    if (room === null) {
      ws.close(1011, "No such game");
      return;
    }
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    const seq = room.seq;
    const status = room.data.status;
    const out = await room.receive(a.conn, raw);
    const seat = room.seatOf(a.conn);
    if (seat !== a.seat) ws.serializeAttachment({ ...a, seat } satisfies Attachment);
    this.deliver(out);
    await this.persist(seq, status);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.gone(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  /** Delete the game once it has expired (spec §8.3). */
  override async alarm(): Promise<void> {
    const room = this.room;
    if (room === null) return;
    if (Date.now() < room.expiresAt()) {
      await this.ctx.storage.setAlarm(room.expiresAt());
      return;
    }
    for (const ws of this.ctx.getWebSockets()) ws.close(1001, "Game expired");
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  private gone(ws: WebSocket): void {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (this.room !== null && a !== null) this.deliver(this.room.leave(a.conn));
  }

  private deliver(out: Outgoing[]): void {
    const sockets = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a !== null) sockets.set(a.conn, ws);
    }
    for (const o of out) {
      const text = JSON.stringify(o.message);
      for (const conn of o.to) {
        const ws = sockets.get(conn);
        if (ws === undefined) continue;
        try {
          ws.send(text);
          if (o.close) ws.close(1008, o.message.type === "error" ? o.message.code : "closed");
        } catch {
          // The socket went away mid-send; its close event will tidy up.
        }
      }
    }
  }

  /** Write what changed since `seqBefore` / `statusBefore` (-1 / null: everything). */
  private async persist(seqBefore: number, statusBefore: RoomData["status"] | null): Promise<void> {
    const room = this.room;
    if (room === null) return;
    const { transforms, snapshot, ...meta } = room.data;
    const storage = this.ctx.storage;
    await storage.put("meta", meta satisfies Meta);
    const seq = transforms.length;
    if (seqBefore < 0) {
      for (const r of transforms) await storage.put(key(r.seq), r);
    } else if (seq > seqBefore) {
      for (const r of transforms.slice(seqBefore)) await storage.put(key(r.seq), r);
    } else if (seq < seqBefore) {
      await storage.delete(Array.from({ length: seqBefore - seq }, (_, i) => key(seq + 1 + i)));
    }
    if (seqBefore < 0 || seq !== seqBefore || statusBefore !== room.data.status) {
      if (snapshot === null) await storage.delete("snapshot");
      else await storage.put("snapshot", snapshot);
    }
    await storage.setAlarm(room.expiresAt());
  }
}
