import { describe, expect, test } from "vitest";
import { createRoom, ENDED_LIFETIME, IDLE_LIFETIME } from "../src/room";
import { MAX_MESSAGE_BYTES, MAX_MESSAGES_PER_SECOND, PROTOCOL } from "../src/protocol";
import { GUEST_FLEET, Harness, testDeps, type Fleet } from "./harness";
import { upgradeRoomData, type CreateRequest, type RoomData } from "../src/room";

const rejection = (msgs: { type: string }[]) => msgs.find((m) => m.type === "rejected") as { reason: { code: string } } | undefined;
const errorOf = (msgs: { type: string }[]) => msgs.find((m) => m.type === "error") as { code: string } | undefined;

describe("creating a game", () => {
  test("the host's seat is named; the guest's waits; tokens are stored only as hashes", async () => {
    const ships = [{ name: " Agrippa ", classId: "lunar" }, { name: "Hammer of Terra", classId: "lunar" }];
    const created = await createRoom({ name: "  Ann ", side: "p2", faction: "imperial_navy", ships, ramming: false }, testDeps());
    if ("error" in created) throw new Error(created.error);
    expect(created.seat).toBe("p2");
    expect(created.data.seats.p2).toMatchObject({ name: "Ann", faction: "imperial_navy", ships: [{ name: "Agrippa" }, { name: "Hammer of Terra" }] });
    expect(created.data.seats.p1).toMatchObject({ name: null, faction: null, ships: [] });
    expect(created.data).toMatchObject({ count: 2, options: { ramming: false } });
    expect(JSON.stringify(created.data)).not.toContain(created.token);
    expect(JSON.stringify(created.data)).not.toContain(created.inviteToken);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test("names, sides and fleets are checked", async () => {
    const req: CreateRequest = { name: "Ann", side: "p1", faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }], ramming: true };
    expect(await createRoom({ ...req, name: " " }, testDeps())).toEqual({ error: "INVALID_NAME" });
    expect(await createRoom({ ...req, side: "p3" as "p1" }, testDeps())).toEqual({ error: "INVALID_SIDE" });
    const fleet = async (r: Partial<CreateRequest>) => {
      const out = await createRoom({ ...req, ...r }, testDeps());
      return "error" in out ? out : null;
    };
    expect(await fleet({ ships: [] })).toMatchObject({ error: "INVALID_FLEET" });
    expect(await fleet({ ships: Array.from({ length: 5 }, (_, i) => ({ name: `L${i}`, classId: "lunar" })) })).toMatchObject({ error: "INVALID_FLEET" });
    expect(await fleet({ ships: [{ name: "A", classId: "lunar" }, { name: "A", classId: "lunar" }] })).toMatchObject({ error: "INVALID_FLEET", message: "Every ship needs its own name" });
    expect(await fleet({ ships: [{ name: "A", classId: "murder" }] })).toMatchObject({ error: "INVALID_FLEET" }); // a Murder isn't Imperial
    expect(await fleet({ ships: [{ name: "A", classId: "battle_barge" }] })).toMatchObject({ error: "INVALID_FLEET" });
    expect(await fleet({ ships: [{ name: " ", classId: "lunar" }] })).toMatchObject({ error: "INVALID_FLEET" });
    expect(await fleet({ faction: "chaos", ships: [{ name: "A", classId: "murder" }, { name: "B", classId: "murder" }] })).toBeNull();
  });

  test("a protocol 1 room reads as protocol 2", () => {
    const v1 = {
      gameId: "g", createdAt: 0, lastActivity: 0, endedAt: null, status: "lobby", config: null, transforms: [], snapshot: null,
      seats: { p1: { tokenHash: "h1", name: "Ann", shipName: "Agrippa" }, p2: { tokenHash: "h2", name: null, shipName: null } },
    } as unknown as RoomData;
    const v2 = upgradeRoomData(v1);
    expect(v2).toMatchObject({ count: 1, options: { ramming: true, boarding: false, carriers: false } });
    expect(v2.seats.p1).toEqual({ tokenHash: "h1", name: "Ann", faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }] });
    expect(v2.seats.p2).toEqual({ tokenHash: "h2", name: null, faction: null, ships: [] });
    expect(upgradeRoomData(v2)).toEqual(v2);
    // A protocol 2 room from before boarding or carriers existed: they stay off.
    const before = { ...v2, options: { ramming: false } } as unknown as RoomData;
    expect(upgradeRoomData(before).options).toEqual({ ramming: false, boarding: false, carriers: false, fleetLists: false, scenario: "cruiser_clash", forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" });
    const boardingOnly = { ...v2, options: { ramming: true, boarding: true } } as unknown as RoomData;
    expect(upgradeRoomData(boardingOnly).options).toEqual({ ramming: true, boarding: true, carriers: false, fleetLists: false, scenario: "cruiser_clash", forces: { kind: "cruiser_clash" }, scoring: "cruiser_clash" });
  });
});

describe("lobby and start", () => {
  test("hello gets the lobby; the guest's join starts the game with a server seed, redacted", async () => {
    const h = await Harness.create();
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ type: "welcome", seat: "p1", status: "lobby", seq: 0, state: null });
    expect(welcome).toMatchObject({
      lobby: { count: 1, options: { ramming: true, boarding: false, carriers: false }, seats: { p1: { name: "Ann", faction: "imperial_navy", joined: true }, p2: { joined: false } } },
    });

    await h.hello("b", "p2");
    await h.join("b", "p2", "Bo", GUEST_FLEET);
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

  test("join checks names and fleets, and is refused once the game is on", async () => {
    const h = await Harness.create();
    await h.hello("b", "p2");
    expect(rejection(await h.join("b", "p2", "", GUEST_FLEET))?.reason.code).toBe("INVALID_NAME");
    const two = { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }, { name: "Woe", classId: "murder" }] } as const;
    expect(rejection(await h.join("b", "p2", "Bo", two))?.reason.code).toBe("INVALID_FLEET"); // the host set one a side
    const clash = { faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }] } as const;
    expect(rejection(await h.join("b", "p2", "Bo", clash))?.reason).toMatchObject({ code: "INVALID_NAME", message: "Agrippa is already a ship in this game" });
    expect(rejection(await h.send("b", { type: "join", token: h.tokens.p2, name: "Bo", shipName: "Unclean" }))).toBeUndefined();
    expect(h.closed.has("b")).toBe(true); // a protocol 1 join is malformed now
  });

  test("join is refused once the game is on", async () => {
    const h = await Harness.started();
    expect(rejection(await h.join("b", "p2", "Bo2", GUEST_FLEET))?.reason.code).toBe("ALREADY_STARTED");
  });

  test("fleets: a 3-a-side Imperial mirror match starts with the host's options", async () => {
    const lunars = (prefix: string) => ({ faction: "imperial_navy", ships: [1, 2, 3].map((i) => ({ name: `${prefix} ${i}`, classId: "lunar" })) }) as const;
    const h = await Harness.create({ fleet: lunars("Ann"), ramming: false, boarding: true });
    await h.hello("a", "p1");
    await h.hello("b", "p2");
    await h.join("b", "p2", "Bo", lunars("Bo"));
    const state = h.stateOf("b")!;
    expect(state.ships.map((s) => `${s.owner} ${s.name} ${s.profile.className}`)).toEqual([
      "p1 Ann 1 Lunar class cruiser", "p1 Ann 2 Lunar class cruiser", "p1 Ann 3 Lunar class cruiser",
      "p2 Bo 1 Lunar class cruiser", "p2 Bo 2 Lunar class cruiser", "p2 Bo 3 Lunar class cruiser",
    ]);
    expect(state.players.p2.faction).toBe("imperial_navy");
    expect(state.meta.options).toEqual({ ramming: false, boarding: true, carriers: false });
  });

  test("carriers: with the option, each side may bring one carrier over the cap", async () => {
    const withDictator = { faction: "imperial_navy", ships: [{ name: "Fortitude", classId: "dictator" }, { name: "Agrippa", classId: "lunar" }] } as const;
    const withDevastation = { faction: "chaos", ships: [{ name: "Deathbane", classId: "devastation" }, { name: "Unclean", classId: "murder" }] } as const;
    await expect(Harness.create({ fleet: withDictator })).rejects.toThrow("INVALID_FLEET"); // no option, no carrier
    const h = await Harness.create({ fleet: withDictator, carriers: true });
    await h.hello("a", "p1");
    await h.hello("b", "p2");
    const two = { faction: "chaos", ships: [{ name: "Deathbane", classId: "devastation" }, { name: "Unforgivable", classId: "devastation" }] } as const;
    expect(rejection(await h.join("b", "p2", "Bo", two))?.reason.code).toBe("INVALID_FLEET");
    await h.join("b", "p2", "Bo", withDevastation);
    const state = h.stateOf("b")!;
    expect(state.meta.options.carriers).toBe(true);
    expect(state.ships.map((s) => s.profile.classId)).toEqual(["dictator", "lunar", "devastation", "murder"]);
  });

  test("points battles: each side brings its own number of ships within the limit, scored in victory points", async () => {
    const ann = { faction: "imperial_navy", ships: [{ name: "Fortitude", classId: "dictator" }, { name: "Invincible", classId: "gothic" }, { name: "Agrippa", classId: "lunar" }] } as const;
    const h = await Harness.create({ fleet: ann, forces: { kind: "points", limit: 750 }, scoring: "victory_points" });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { forces: { kind: "points", limit: 750 }, scoring: "victory_points" } } });
    await h.hello("b", "p2");
    const tooMuch = { faction: "chaos", ships: ["devastation", "carnage", "inferno", "slaughter", "murder"].map((classId, i) => ({ name: `C${i}`, classId })) } as const;
    expect(rejection(await h.join("b", "p2", "Bo", tooMuch))?.reason).toMatchObject({ code: "INVALID_FLEET", message: expect.stringContaining("over the 750 pt limit") });
    const two = { faction: "chaos", ships: [{ name: "Deathbane", classId: "devastation" }, { name: "Killfrenzy", classId: "slaughter" }] } as const;
    await h.join("b", "p2", "Bo", two);
    const state = h.stateOf("b")!;
    expect(state.ships).toHaveLength(5);
    expect(state.scenario).toMatchObject({ forces: { kind: "points", limit: 750 }, scoring: "victory_points" });
  });

  test("Fleet Engagement: a points room, always victory points; it can't be made without a points limit", async () => {
    const ann = { faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }, { name: "Invincible", classId: "gothic" }] } as const;
    const h = await Harness.create({ fleet: ann, scenario: "fleet_engagement", forces: { kind: "points", limit: 500 }, scoring: "cruiser_clash" });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { scenario: "fleet_engagement", forces: { kind: "points", limit: 500 }, scoring: "victory_points" } } });
    await h.hello("b", "p2");
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }] });
    const state = h.stateOf("b")!;
    expect(state.scenario).toMatchObject({ id: "fleet_engagement", maxRounds: null, scoring: "victory_points" });
    expect(state.setup.engagement?.formations).toEqual({ p1: null, p2: null });
    await expect(Harness.create({ fleet: ann, scenario: "fleet_engagement" })).rejects.toThrow("INVALID_FLEET");
  });

  test("The Bait: the host names the pursuers; reinforcements ride on the ship entries; each side is checked in its own role", async () => {
    const ann: Fleet = {
      faction: "imperial_navy",
      ships: [
        { name: "Agrippa", classId: "lunar" },
        { name: "Relief", classId: "gothic", reserve: true },
      ],
    };
    // The host is pursued: p2 pursues.
    const h = await Harness.create({ fleet: ann, scenario: "the_bait", forces: { kind: "points", limit: 500 }, attacker: "p2" });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { scenario: "the_bait", attacker: "p2", scoring: "victory_points" } } });
    await h.hello("b", "p2");
    // The pursuers keep nothing back.
    expect(rejection(await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder", reserve: true }] }))?.reason).toMatchObject({
      code: "INVALID_FLEET",
      message: expect.stringContaining("no reinforcements"),
    });
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }, { name: "Despair", classId: "carnage" }] });
    const state = h.stateOf("b")!;
    expect(state.scenario).toMatchObject({ id: "the_bait", attacker: "p2", maxRounds: null });
    expect(state.ships.map((s) => s.status)).toEqual(["undeployed", "reserve", "undeployed", "undeployed"]);
    // A bait over half the limit can't host (a Mars, 270 pts of 500)…
    const heavy: Fleet = { faction: "imperial_navy", ships: [{ name: "Imperious", classId: "mars" }] };
    await expect(Harness.create({ fleet: heavy, scenario: "the_bait", forces: { kind: "points", limit: 500 }, attacker: "p2" })).rejects.toThrow("INVALID_FLEET");
    // …but the same Mars can host as the pursuers.
    await expect(Harness.create({ fleet: heavy, scenario: "the_bait", forces: { kind: "points", limit: 500 }, attacker: "p1" })).resolves.toBeDefined();
  });

  test("The Raiders: the host names the raiders, held to half the defender's points", async () => {
    const ann: Fleet = { faction: "imperial_navy", ships: [{ name: "Agrippa", classId: "lunar" }, { name: "Invincible", classId: "gothic" }] };
    // The host defends; p2 raids at up to 250 points.
    const h = await Harness.create({ fleet: ann, scenario: "raiders", forces: { kind: "points", limit: 500 }, attacker: "p2" });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { scenario: "raiders", attacker: "p2", scoring: "victory_points" } } });
    await h.hello("b", "p2");
    expect(rejection(await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }, { name: "Despair", classId: "carnage" }] }))?.reason).toMatchObject({
      code: "INVALID_FLEET",
      message: expect.stringContaining("over the 250 pt limit"),
    });
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }] });
    const state = h.stateOf("b")!;
    expect(state.scenario).toMatchObject({ id: "raiders", attacker: "p2", maxRounds: 8 });
    expect(state.ships.map((s) => s.status)).toEqual(["undeployed", "undeployed", "reserve"]);
    // The host's 360 points can't raid at 500.
    await expect(Harness.create({ fleet: ann, scenario: "raiders", forces: { kind: "points", limit: 500 }, attacker: "p1" })).rejects.toThrow("INVALID_FLEET");
  });

  test("a planet: the host's choice rides in the options and reaches the game", async () => {
    const h = await Harness.create({ planet: "large" });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { planet: "large" } } });
    await h.hello("b", "p2");
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }] });
    expect(h.stateOf("b")!.table.features).toMatchObject([{ kind: "planet", size: "large", diameter: 35, well: 30 }]);
  });

  test("fleet lists: commanders ride on the ship entries and the engine checks the list", async () => {
    const ann: Fleet = {
      faction: "imperial_navy",
      ships: [
        { name: "Imperious", classId: "mars", options: ["targeting_matrix"], commander: { kind: "admiral", leadership: 9, extraRerolls: 1 } },
        { name: "Agrippa", classId: "lunar" },
        { name: "Invincible", classId: "gothic" },
      ],
    };
    const h = await Harness.create({ fleet: ann, forces: { kind: "points", limit: 1000 }, fleetLists: true });
    const [welcome] = await h.hello("a", "p1");
    expect(welcome).toMatchObject({ lobby: { options: { fleetLists: true } } });
    await h.hello("b", "p2");
    // No Warmaster: Chaos Incursion refuses it.
    expect(rejection(await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder" }] }))?.reason).toMatchObject({
      code: "INVALID_FLEET",
      message: expect.stringContaining("Warmaster"),
    });
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Unclean", classId: "murder", commander: { kind: "warmaster", leadership: 8, marks: ["tzeentch"] } }] });
    const state = h.stateOf("b")!;
    expect(state.meta.options.fleetLists).toBe(true);
    expect(state.ships.map((s) => s.commander?.rerolls ?? null)).toEqual([2, null, null, 2]);
  });

  test("squadrons ride on the ship entries: escorts in one, the engine checks them", async () => {
    const ann: Fleet = {
      faction: "imperial_navy",
      ships: [
        { name: "Blue 1", classId: "sword", squadron: "Blue" },
        { name: "Blue 2", classId: "sword", squadron: "Blue" },
        { name: "Agrippa", classId: "lunar" },
      ],
    };
    const h = await Harness.create({ fleet: ann, forces: { kind: "points", limit: 500 } });
    await h.hello("a", "p1");
    await h.hello("b", "p2");
    expect(rejection(await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Lost", classId: "iconoclast" }] }))?.reason).toMatchObject({
      code: "INVALID_FLEET",
      message: expect.stringContaining("squadron"),
    });
    await h.join("b", "p2", "Bo", { faction: "chaos", ships: [{ name: "Lost", classId: "iconoclast", squadron: "Lost" }, { name: "Unclean", classId: "murder" }] });
    const state = h.stateOf("b")!;
    expect(state.squadrons?.map((sq) => [sq.owner, sq.name, sq.shipIds.length])).toEqual([
      ["p1", "Blue", 2],
      ["p2", "Lost", 1],
    ]);
  });

  test("a host over its own points limit can't create the game", async () => {
    const big = { faction: "imperial_navy", ships: ["dictator", "dictator", "tyrant", "lunar"].map((classId, i) => ({ name: `I${i}`, classId })) } as const;
    await expect(Harness.create({ fleet: big, forces: { kind: "points", limit: 750 } })).rejects.toThrow("INVALID_FLEET");
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
    const y = s.scenario.deploymentZones![zone].y + 5;
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
    expect(errorOf(await h.send("x", { type: "hello", token: "nope", protocol: PROTOCOL, engine: "test-engine" }))?.code).toBe("UNKNOWN_TOKEN");
    expect(errorOf(await h.hello("x", "p1", { protocol: 999 }))?.code).toBe("PROTOCOL_MISMATCH");
    expect(errorOf(await h.hello("x", "p1", { protocol: 1 }))?.code).toBe("PROTOCOL_MISMATCH"); // a page from before fleets
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
