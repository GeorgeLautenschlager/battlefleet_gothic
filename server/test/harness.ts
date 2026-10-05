/** A room plus fake connections, for tests: send raw messages, collect what each connection receives. */
import { createHash } from "node:crypto";
import type { GameState, PlayerId } from "@bfg/engine";
import { GameRoom, createRoom, type Deps } from "../src/room";
import { PROTOCOL, type ServerMessage } from "../src/protocol";

export const ENGINE = "test-engine";

/** Deterministic deps: a seeded byte stream, real SHA-256, and a clock the test moves. */
export function testDeps(seed = 1): Deps & { clock: { t: number } } {
  let s = seed >>> 0;
  const clock = { t: Date.UTC(2026, 9, 5) };
  return {
    clock,
    randomBytes: (n) =>
      Uint8Array.from({ length: n }, () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s >>> 24;
      }),
    sha256: async (text) => createHash("sha256").update(text).digest("hex"),
    now: () => clock.t,
    engine: ENGINE,
  };
}

export class Harness {
  readonly inbox = new Map<string, ServerMessage[]>();
  readonly closed = new Set<string>();
  private ids = 0;

  constructor(
    readonly room: GameRoom,
    readonly deps: ReturnType<typeof testDeps>,
    readonly tokens: Record<PlayerId, string>,
  ) {}

  static async create(opts: { side?: PlayerId; seed?: number } = {}): Promise<Harness> {
    const deps = testDeps(opts.seed);
    const created = await createRoom({ name: "Ann", shipName: "Agrippa", side: opts.side ?? "p1" }, deps);
    if ("error" in created) throw new Error(created.error);
    const guest: PlayerId = created.seat === "p1" ? "p2" : "p1";
    const tokens = { [created.seat]: created.token, [guest]: created.inviteToken } as Record<PlayerId, string>;
    return new Harness(new GameRoom(created.data, deps), deps, tokens);
  }

  /** Send a raw message from a connection; deliver the replies; advance the clock by `tick` ms. */
  async send(conn: string, message: unknown, tick = 100): Promise<ServerMessage[]> {
    this.deps.clock.t += tick;
    const raw = typeof message === "string" ? message : JSON.stringify(message);
    const out = await this.room.receive(conn, raw);
    const mine: ServerMessage[] = [];
    for (const o of out) {
      for (const to of o.to) {
        if (!this.inbox.has(to)) this.inbox.set(to, []);
        this.inbox.get(to)!.push(o.message);
        if (to === conn) mine.push(o.message);
        if (o.close) this.closed.add(to);
      }
    }
    return mine;
  }

  hello(conn: string, seat: PlayerId, extra: Record<string, unknown> = {}) {
    return this.send(conn, { type: "hello", token: this.tokens[seat], protocol: PROTOCOL, engine: ENGINE, ...extra });
  }

  /** Host on "a" (p1), guest on "b" (p2) who joins as Bo / Unclean: the game starts. */
  static async started(seed = 1): Promise<Harness> {
    const h = await Harness.create({ seed });
    await h.hello("a", "p1");
    await h.hello("b", "p2");
    await h.send("b", { type: "join", token: h.tokens.p2, name: "Bo", shipName: "Unclean" });
    return h;
  }

  nextId(): string {
    return `m${++this.ids}`;
  }

  propose(conn: string, transform: unknown, base?: number, id = this.nextId()) {
    return this.send(conn, { type: "propose", id, base: base ?? this.room.seq, transform });
  }

  /** The latest state a connection has been sent. */
  stateOf(conn: string): GameState | null {
    const msgs = this.inbox.get(conn) ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.type === "welcome" || m.type === "applied" || m.type === "undone") return m.state;
    }
    return null;
  }

  last(conn: string): ServerMessage | undefined {
    return this.inbox.get(conn)?.at(-1);
  }

  all(): ServerMessage[] {
    return [...this.inbox.values()].flat();
  }
}
