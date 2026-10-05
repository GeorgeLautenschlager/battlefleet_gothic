import { describe, expect, test } from "vitest";
import { createRoom, ENDED_LIFETIME, IDLE_LIFETIME } from "../src/room";
import { MAX_MESSAGE_BYTES, MAX_MESSAGES_PER_SECOND } from "../src/protocol";
import { Harness, testDeps } from "./harness";

const rejection = (msgs: { type: string }[]) => msgs.find((m) => m.type === "rejected") as { reason: { code: string } } | undefined;
const errorOf = (msgs: { type: string }[]) => msgs.find((m) => m.type === "error") as { code: string } | undefined;

describe("creating a game", () => {
  test("the host's seat is named; the guest's waits; tokens are stored only as hashes", async () => {
    const created = await createRoom({ name: "  Ann ", shipName: "Agrippa", side: "p2" }, testDeps());
    if ("error" in created) throw new Error(created.error);
    expect(created.seat).toBe("p2");
    expect(created.data.seats.p2).toMatchObject({ name: "Ann", shipName: "Agrippa" });
    expect(created.data.seats.p1).toMatchObject({ name: null, shipName: null });
    expect(JSON.stringify(created.data)).not.toContain(created.token);
    expect(JSON.stringify(created.data)).not.toContain(created.inviteToken);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test("names and sides are checked", async () => {
    expect(await createRoom({ name: " ", shipName: "x", side: "p1" }, testDeps())).toEqual({ error: "INVALID_NAME" });
    expect(await createRoom({ name: "x", shipName: "y", side: "p3" as "p1" }, testDeps())).toEqual({ error: "INVALID_SIDE" });
  });
});

describe("lobby and start", () => {
  test("hello gets the lobby; the guest's join starts the game with a server seed, redacted", async () => {
    const h = await Harness.create();
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ type: "welcome", seat: "p1", status: "lobby", seq: 0, state: null });
    expect(welcome).toMatchObject({ lobby: { seats: { p1: { name: "Ann", joined: true }, p2: { joined: false } } } });

    await h.hello("b", "p2");
    await h.send("b", { type: "join", token: h.tokens.p2, name: "Bo", shipName: "Unclean" });
    for (const conn of ["a", "b"]) {
      const w = h.last(conn);
      expect(w).toMatchObject({ type: "welcome", status: "active", seq: 0 });
      const state = h.stateOf(conn)!;
      expect(state.players.p2.name).toBe("Bo");
      expect(state.ships.map((s) => s.name)).toEqual(["Agrippa", "Unclean"]);
      expect(state.rng).toMatchObject({ seed: 0, state: 0, draws: 0 });
    }
    expect(h.room.data.config!.seed).not.toBe(0);
    expect(h.room.data.snapshot!.rng.seed).toBe(h.room.data.config!.seed);
  });

  test("join checks names, and is refused once the game is on", async () => {
    const h = await Harness.create();
    await h.hello("b", "p2");
    expect(rejection(await h.send("b", { type: "join", token: h.tokens.p2, name: "", shipName: "x" }))?.reason.code).toBe("INVALID_NAME");
    await h.send("b", { type: "join", token: h.tokens.p2, name: "Bo", shipName: "Unclean" });
    expect(rejection(await h.send("b", { type: "join", token: h.tokens.p2, name: "Bo2", shipName: "x" }))?.reason.code).toBe("ALREADY_STARTED");
  });

  test("proposals before the start are refused", async () => {
    const h = await Harness.create();
    await h.hello("a", "p1");
    expect(rejection(await h.propose("a", { type: "roll_leadership", player: "p1" }))?.reason.code).toBe("NOT_STARTED");
  });
});

describe("proposals", () => {
  test("applied to both seats, with who, whether it rolled, and a redacted state", async () => {
    const h = await Harness.started();
    await h.propose("b", { type: "roll_leadership", player: "p2" }); // either player may roll
    for (const conn of ["a", "b"]) {
      expect(h.last(conn)).toMatchObject({ type: "applied", seq: 1, by: "p2", rolled: true });
      const state = h.stateOf(conn)!;
      expect(state.rng).toMatchObject({ seed: 0, state: 0, draws: 2 });
      expect(state.ships.every((s) => s.leadership !== null)).toBe(true);
    }
  });

  test("rejections: wrong seat, stale base, validator reasons, and duplicates", async () => {
    const h = await Harness.started();
    expect(rejection(await h.propose("b", { type: "roll_leadership", player: "p1" }))?.reason.code).toBe("NOT_YOUR_SEAT");
    expect(rejection(await h.propose("a", { type: "roll_leadership", player: "p1" }, 5))?.reason.code).toBe("STALE");
    expect(rejection(await h.propose("a", { type: "roll_zones", player: "p1" }))?.reason.code).toBe("WRONG_MOMENT");
    expect(rejection(await h.propose("a", { type: "nonsense", player: "p1" }))?.reason.code).toBe("MALFORMED");

    await h.propose("a", { type: "roll_leadership", player: "p1" }, 0, "dup");
    const again = await h.propose("a", { type: "roll_leadership", player: "p1" }, 0, "dup");
    expect(rejection(again)).toMatchObject({ reason: { code: "ALREADY_APPLIED", details: { seq: 1 } } });
    expect(h.room.seq).toBe(1);
  });
});

describe("undo (spec §6)", () => {
  /** Through setup to deployment, p2 (Bo) deploying first for this seed. */
  async function toDeploy(): Promise<Harness> {
    const h = await Harness.started(7);
    await h.propose("a", { type: "roll_leadership", player: "p1" });
    await h.propose("a", { type: "roll_zones", player: "p1" });
    while (h.room.data.snapshot!.clock.setupStep === "roll_deploy_order") await h.propose("a", { type: "roll_deploy_order", player: "p1" });
    return h;
  }

  test("your own latest dice-free action: yes; anything else: no", async () => {
    const h = await toDeploy();
    const s = h.room.data.snapshot!;
    const first = s.setup.firstDeployer!;
    const [conn, other] = first === "p1" ? ["a", "b"] : ["b", "a"];
    const zone = s.setup.zones![first];
    const y = s.scenario.deploymentZones[zone].y + 5;
    const ship = s.ships.find((x) => x.owner === first)!;
    // An undo of a roll is refused.
    expect(rejection(await h.send(conn, { type: "undo", id: "u0", seq: h.room.seq }))?.reason.code).toBe("ROLLED_DICE");

    await h.propose(conn, { type: "deploy_ship", player: first, shipId: ship.id, position: { x: 90, y } });
    const seq = h.room.seq;
    expect(rejection(await h.send(other, { type: "undo", id: "u1", seq }))?.reason.code).toBe("NOT_YOURS");
    expect(rejection(await h.send(conn, { type: "undo", id: "u2", seq: seq - 1 }))?.reason.code).toBe("NOT_LATEST");
    await h.send(conn, { type: "undo", id: "u3", seq });
    for (const c of ["a", "b"]) {
      expect(h.last(c)).toMatchObject({ type: "undone", seq: seq - 1 });
      expect(h.stateOf(c)!.ships.find((x) => x.id === ship.id)!.status).toBe("undeployed");
      expect(h.stateOf(c)!.rng).toMatchObject({ seed: 0, state: 0 });
    }
    expect(h.room.data.snapshot!.ships.find((x) => x.id === ship.id)!.status).toBe("undeployed");
  });
});

describe("connections", () => {
  test("presence follows hello and leave", async () => {
    const h = await Harness.create();
    await h.hello("a", "p1");
    expect(h.last("a")).toMatchObject({ type: "presence", p1: true, p2: false });
    await h.hello("b", "p2");
    expect(h.last("a")).toMatchObject({ type: "presence", p1: true, p2: true });
    const out = h.room.leave("b");
    expect(out[0]).toMatchObject({ to: ["a"], message: { type: "presence", p1: true, p2: false } });
  });

  test("protocol failures close the socket", async () => {
    const h = await Harness.create();
    expect(errorOf(await h.send("x", "not json"))?.code).toBe("MALFORMED_MESSAGE");
    expect(errorOf(await h.send("x", { type: "propose", id: "1", base: 0, transform: {} }))?.code).toBe("HELLO_FIRST");
    expect(errorOf(await h.send("x", { type: "hello", token: "nope", protocol: 1, engine: "test-engine" }))?.code).toBe("UNKNOWN_TOKEN");
    expect(errorOf(await h.hello("x", "p1", { protocol: 999 }))?.code).toBe("PROTOCOL_MISMATCH");
    expect(errorOf(await h.hello("x", "p1", { engine: "older" }))?.code).toBe("ENGINE_MISMATCH");
    expect(errorOf(await h.send("x", "x".repeat(MAX_MESSAGE_BYTES + 1)))?.code).toBe("MESSAGE_TOO_LARGE");
    expect(h.closed.has("x")).toBe(true);
  });

  test("a third tab on one seat is refused", async () => {
    const h = await Harness.create();
    await h.hello("a1", "p1");
    await h.hello("a2", "p1");
    expect(errorOf(await h.hello("a3", "p1"))?.code).toBe("TOO_MANY_CONNECTIONS");
  });

  test("more than the rate limit in a second is cut off", async () => {
    const h = await Harness.create();
    let last: { type: string }[] = [];
    for (let i = 0; i <= MAX_MESSAGES_PER_SECOND; i++) last = await h.send("x", { type: "ping" }, 1);
    expect(errorOf(last)?.code).toBe("RATE_LIMITED");
  });
});

test("lifetime: 30 days idle, or 7 days after the end", async () => {
  const h = await Harness.started();
  expect(h.room.expiresAt()).toBe(h.room.data.lastActivity + IDLE_LIFETIME);
  h.room.data.endedAt = h.room.data.lastActivity;
  expect(h.room.expiresAt()).toBe(h.room.data.endedAt + ENDED_LIFETIME);
});
