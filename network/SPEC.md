# Network Play Specification

**Status:** v0.4, accepted ([ADR 0003](../docs/adr/0003-network-play.md)). Implemented: the server in [`server/`](../server/README.md) (live on Cloudflare) and the online app in [`app/src/online/`](../app/README.md). **Scope:** two players on two devices playing Cruiser Clash (1–4 cruisers a side, each player's own fleet), live or turn-by-turn. v0.4 (protocol 2) added fleets: v0.3 was one Lunar vs one Murder. Builds on [Game State](../game_state/SPEC.md), [Transforms](../transforms/SPEC.md), the [engine](../engine/README.md) and the [browser app](../app/README.md) ([ADR 0002](../docs/adr/0002-browser-app.md)).

Hot-seat stays exactly as it is. Network play is a second way to drive the same UI.

Contents:

- the idea (§1)
- architecture: a game server that runs the engine (§2)
- games, players and links (§3)
- the protocol (§4)
- dice, secrecy and verification (§5)
- undo (§6)
- the client (§7)
- the server (§8)
- operations: hosting, deploys, versions, limits (§9)
- testing (§10)
- delivery plan (§11)
- rulings (§12), decisions (§13), later (§14)

---

## 1. The idea

The engine is deterministic: a game is its config (with the seed) plus the list of transforms, and replaying them gives the same state. So two devices only need to agree on **one ordered list of transforms**. Transforms are tiny (well under 1 KB), and Battlefleet Gothic has almost no hidden information.

The problem is **dice**. The seed is in the state, so whoever holds the state can compute every future roll. Between friends on the honour system that's tolerable; nobody else should have to trust it. The fix is cheap because of [ADR 0001](../docs/adr/0001-engine-language.md): the engine is pure TypeScript with no DOM or Node APIs, so a server can run it. **The server holds the seed, applies every transform, and sends players the resulting state with the dice hidden.** Clients keep everything else: `validate` never reads the RNG, so ghosts, previews and disabled buttons work exactly as they do now.

## 2. Architecture

```
 browser (p1)                   Cloudflare                    browser (p2)
┌────────────┐  WebSocket   ┌──────────────────┐  WebSocket  ┌────────────┐
│ app        │◄────────────►│ Worker (router)  │◄───────────►│ app        │
│ + engine   │              │   │              │             │ + engine   │
│ (validate, │              │   ▼              │             │ (validate, │
│  preview)  │              │ Durable Object   │             │  preview)  │
└────────────┘              │ one per game:    │             └────────────┘
                            │ engine (validate │
                            │ + reduce), seed, │
                            │ transform log,   │
                            │ SQLite storage   │
                            └──────────────────┘
```

- **One Durable Object (DO) per game.** It's a single-threaded actor with its own storage, so it serialises transforms for free: no locks, no races. It holds the seed, the config, the transform log and a state snapshot.
- **The Worker** only routes: creating a game, and sending each WebSocket to its game's DO.
- **The app** stays on GitHub Pages. It talks to the server over one WebSocket per game.
- **The server is authoritative.** A client sends a *proposal*; the DO validates it with the same engine, reduces it, stores it, and broadcasts the result. A client never applies its own transform until the server says so.

Why not peer-to-peer? WebRTC still needs a signalling server, NAT traversal sometimes needs a relay, and peers would have to agree on dice with a commit-reveal handshake on every roll. A small authoritative server is less code and fixes dice outright (§5).

## 3. Games, players and links

No accounts. A player is whoever holds that seat's **token**.

1. **Create.** The host picks *New online game* and brings their fleet: their name, a faction, and 1–4 named cruisers. That number sets the size of the battle, and the host also chooses the optional rules (ramming). The host is Player 1 in the app (the server takes either side; D3). The server checks the fleet (D10) and returns `gameId` plus two secret tokens, one per seat.
2. **Invite.** The app shows an invite link for the other seat: `https://…/battlefleet_gothic/#join=<gameId>.<token>`. The host sends it however they like.
3. **Join.** The guest opens the link, sees the host's fleet, and brings their own: their name, any faction (mirror matches are fine), and the same number of cruisers. Ship names must differ from the host's. The seat is then theirs. When both seats are filled, the server builds the config (with a server-side random seed, §5) and creates the game. Setup then proceeds as today: leadership, zones, deployment.
4. **Return.** Each browser remembers its games in `localStorage` (`gameId`, seat and token). A *My games* list on the start screen resumes any of them, live or days later.

Tokens live in the URL **fragment**, which browsers never send to servers, so they don't appear in Pages or Cloudflare request logs. They are 128-bit random values; the DO stores only their SHA-256 hashes.

Losing your token loses your seat. Without accounts that's the trade-off; *Export* still gives a copy of the game once it has ended (§5).

## 4. The protocol

One WebSocket per open game: `wss://<server>/games/<gameId>/ws`. Messages are JSON, each with a `type`. The server checks every message's shape and size (§9) before anything else.

### 4.1 Client → server

| type | payload | when |
|---|---|---|
| `hello` | `token, protocol, engine` | first message on a connection. `protocol` is the protocol version, `engine` the client's engine build id. |
| `join` | `token, name, faction, ships` | lobby only: claim the seat this token belongs to, with a fleet. `ships` is `{ name, classId }[]`, `classId` from the engine catalogue. |
| `propose` | `id, base, transform` | a transform for the player's own seat. `id` is a client-chosen message id; `base` is the `seq` of the state it was built on. |
| `undo` | `id, seq` | take back transform `seq` (§6) |
| `ping` | — | keep-alive; the server answers `pong` |

### 4.2 Server → client

| type | payload | when |
|---|---|---|
| `welcome` | `seat, status, seq, state, lobby, presence, engine` | reply to `hello`: the full current (redacted) state, or `state: null` in the lobby. Sent again to every seat when the game starts. |
| `lobby` | `seats: { p1, p2 }` (each `name, faction, ships, joined`), `count` (ships a side), `options` (`ramming`) | the lobby changed |
| `applied` | `seq, by, transform, state, rolled` | a transform was accepted. Sent to **both** seats, the proposer included, with `id` echoed to the proposer. |
| `rejected` | `id, reason` | a proposal, undo or join was refused (a join's `id` is `""`). `reason` is the validator's `{ code, message, details }`, or a room code (§4.4). |
| `undone` | `seq, state` | the latest transform was taken back; `seq` is the new current `seq` and `state` the state there |
| `presence` | `p1, p2` (online booleans) | someone connected or disconnected |
| `ended` | `seed, config, transforms` | the game is over: everything needed to replay and verify it (§5) |
| `error` | `code, message` | a protocol failure; the server closes the socket |

`seq` is the number of transforms applied so far: 0 at the start, then 1, 2, and so on. Every state on the wire is tagged with the `seq` it follows.

### 4.3 Sending whole states

Each `applied` carries the whole redacted state. A Phase 1 state is a few tens of KB once the log has grown. That costs bandwidth but keeps clients trivially correct: there's no diffing, no client-side reduce, and no drift. If size becomes a problem, the first optimisation is sending log entries since the last `seq` plus the non-log state (D8).

### 4.4 Ordering and conflicts

- The DO handles one message at a time, so it applies transforms in a single total order.
- A `propose` whose `base` isn't the current `seq` is rejected as `STALE`. The client already has (or is about to receive) the newer state, and re-plans against it. This matters only where both players can act at once: the setup roll steps (actor `either`) and damage control (both players repair).
- The server also rejects:
  - `NOT_YOUR_SEAT`: the transform's `player` isn't the token's seat;
  - `NOT_STARTED` / `GAME_OVER`;
  - any validator rejection, passed through unchanged.
- Proposals are idempotent by `id` (per seat). Resending one that was already applied is rejected as `ALREADY_APPLIED` with its `seq`, so a retry after a dropped connection can't apply a transform twice; the client already has the state from `welcome` or `applied`.
- Undo rejections: `NOT_LATEST`, `NOT_YOURS`, `ROLLED_DICE`. Join rejections: `ALREADY_STARTED`, `INVALID_NAME` (including a ship name the other fleet already uses), `INVALID_FLEET`.

### 4.5 Reconnecting

On reconnect the client sends `hello` again. `welcome` carries the full current state, and that's the whole resync. Proposals the client never saw answered are resent with their original `id` (§4.4).

## 5. Dice, secrecy and verification

- **The seed is created on the server** with `crypto.getRandomValues` when the game starts. It never leaves the DO until the game ends.
- **Redaction.** Every state sent to a client has `rng = { algorithm, seed: 0, state: 0, draws }`, and its config has `seed: 0`. `draws` stays, so the client can still tell whether a transform rolled dice.
- **Clients never reduce** online. They `validate` locally (it ignores `rng`) for ghosts, previews and button states, and render whatever state the server sends.
- **Verification at the end.** `ended` reveals the seed, the real config and the full transform list. The client replays them with its own engine and checks that it reaches the same final state. If it doesn't, the client says so loudly, because that means a server bug or tampering. A finished online game then becomes an ordinary save: *Export* works, and so do replays later.
- **Dice results aren't secret.** They're in the log the moment they're rolled, as on a real table. Only *future* rolls are hidden.

The server is ours, so "trust the server" means trusting our own deploy. The end-of-game check keeps us honest anyway, and costs a replay.

## 6. Undo

Hot-seat undo lets the player step back over anything since the last dice roll (ADR 0002). Online, an undo also takes something away from the opponent's screen, so the rule is a little tighter:

- A player may undo transform `seq` only if all of these hold:
  - it's the **latest** transform;
  - **they** made it;
  - it **rolled no dice**.
- Repeating that walks back through a run of the player's own dice-free actions: a deployment in the wrong spot, a move that hit nothing, a step ended too early. It can't take back anything the opponent did, or anything that rolled. That includes special orders (a Command check) and brace answers (the attack resolves at once).
- No consent prompt. Everything undoable is the undoer's own and has revealed nothing, so a consent step would only add friction.
- The server keeps the transform log and a state snapshot per `seq`, or replays from the start, which is fast. An undo sends `undone` with the restored state.

## 7. The client

### 7.1 One UI, two sources

Today everything goes through `run(transform)` → `apply(history, t)`. That becomes a small interface:

```ts
interface GameSource {
  state: GameState;              // current (redacted when online)
  seat: PlayerId | "both";       // "both" for hot-seat
  run(t: Transform): void;       // hot-seat: apply now; online: propose
  canUndo: boolean;
  undo(): void;
  status: "ready" | "waiting" | "offline";  // online: a proposal in flight, or no connection
}
```

- `LocalSource` wraps today's `History`.
- `RemoteSource` wraps the WebSocket.
- Everything else (table, plotter, fire controls, prompts) reads `state` and calls `run`, as it does now.

### 7.2 What changes on screen

- **Only your seat's controls.** If `actor(state)` isn't your seat (and isn't `either`), the side panel shows "Waiting for Bo…" instead of controls. The turn banner already shows whose turn it is.
- **Brace prompts** appear only for the defending seat; the attacker sees "Waiting for Ann to decide whether to brace".
- **While a proposal is in flight**, controls are disabled with a small spinner. In practice that's tens of milliseconds.
- **Presence:** a dot by each player's name, online or offline.
- **Start screen:** *New hot-seat game*, *New online game*, and *My games* (online games stored in this browser, with whose turn it is).
- **Lobby:** the invite link with a copy button, and the seats filling up.
- **Disconnected:** a banner while reconnecting with backoff, with controls disabled.
- **Export** of an online game is available once it has ended (§5).
- **The transform console** still works, and sends proposals.

### 7.3 Configuration

The app learns the server URL at build time (`VITE_SERVER_URL`). If it's not set, the online options are hidden, so local development and forks without a server just get hot-seat.

## 8. The server

A new `server/` package: a Cloudflare Worker plus a Durable Object class, importing `@bfg/engine` as source the same way the app does.

### 8.1 Worker routes

| route | does |
|---|---|
| `POST /games` | body `{ name, side, faction, ships, ramming }`. Creates a DO with a random `gameId` and returns `{ gameId, seat, token, inviteToken }`, or `400 { error, message? }` (`INVALID_NAME`, `INVALID_SIDE`, `INVALID_FLEET`). |
| `GET /games/:id/ws` | upgrades to a WebSocket, forwarded to that game's DO |
| `GET /health` | `{ ok, engine, protocol }` |

Origins are checked against an allow-list (the Pages origin and `localhost`). `POST /games` is rate-limited per IP.

### 8.2 The game room

The DO's logic lives in a plain class, `GameRoom`, with no Cloudflare APIs. It takes messages in and returns messages out plus storage writes, so it can be unit-tested like the engine. The DO itself is a thin adapter: WebSocket handling (with the hibernation API, so idle games cost nothing) and storage.

Stored per game:

- `meta`: created time, engine build id, status (`lobby` | `active` | `ended`), and the seats (token hashes, names, sides);
- `config`: secret until the game ends;
- `transforms`: an append-only list `{ seq, by, transform, rolled, at }`;
- `snapshot`: the latest unredacted state and its `seq`, so a cold start doesn't replay.

### 8.3 Lifetime

- An alarm deletes a game after **30 days with no activity** (D4).
- Ended games are kept for 7 days so both players can export them.

## 9. Operations

- **Hosting:** Cloudflare Workers with SQLite-backed Durable Objects. A two-player turn-based game is a handful of requests per minute, which should fit comfortably in the free plan. Verify the current limits and pricing before relying on that.
- **Deploys:** a GitHub Actions job deploys `server/` with `wrangler deploy` on pushes to `main` that touch `server/**` or `engine/src/**`. It reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the `github-pages` environment's secrets.
- **Versions:** each build stamps an `engine` id (the commit SHA of `engine/src`).
  - The client sends it in `hello`. On a mismatch the server answers with an error asking the client to reload, so the client never validates against different rules from the server's.
  - A game in progress keeps running on whatever engine the server has after a deploy. A rules change mid-game is accepted as a risk for Phase 1, since the rules are stable now.
  - The `protocol` version follows the same pattern. Protocol 2 (fleets) replaced 1; rooms stored by protocol 1 are read as one Lunar vs one Murder.
- **Limits:** messages up to 16 KB; at most 20 messages a second per socket; 2 sockets per seat (a second tab is allowed). Anything over a limit gets `error` and the socket is closed.
- **Logs:** request metadata only, never tokens. Fragments never reach the server anyway, and tokens travel only inside the WebSocket.

## 10. Testing

- **`GameRoom` unit tests** (Vitest):
  - lobby → start;
  - propose, apply and broadcast;
  - every rejection code;
  - stale `base`;
  - duplicate `id`;
  - the undo rules;
  - redaction (no seed or RNG state ever leaves before `ended`);
  - end-of-game reveal and replay verification.
- **Worker integration:** `@cloudflare/vitest-pool-workers` runs the real Worker and DO locally (Miniflare). It covers WebSockets, hibernation and storage across restarts.
- **e2e:** Playwright with **two browser contexts** against `wrangler dev` plus the app. Host creates, guest joins via the invite link, the setup rolls follow, both deploy, and a move and a shot go through with a brace prompt on the other side. Then a reconnect after `page.reload()`.
- **Fuzzing:** the full-game bot from the engine tests drives a `GameRoom` for whole games, checking that both seats' states match and that the end-of-game verification passes.

## 11. Delivery plan

Each step is a PR, as with the engine and the app:

1. **Server core:**
   - `server/` package, `GameRoom` and the protocol types;
   - redaction and verification;
   - unit tests and the fuzzing harness.
   - No Cloudflare yet.
2. **Cloudflare wiring:**
   - the Worker and DO adapter, plus `wrangler.toml`;
   - local dev and integration tests;
   - the CI deploy job (inert until the secrets exist).
3. **App, part 1:**
   - the `GameSource` abstraction, with hot-seat moved onto `LocalSource` and no behaviour change.
4. **App, part 2:**
   - `RemoteSource`;
   - the start screen, lobby, invite links, *My games*;
   - waiting, presence and reconnect;
   - two-context e2e.
5. **Docs:** ADR 0003 (network play) and the README and CLAUDE.md updates.

Steps 1 and 3 don't need a Cloudflare account, so they can start straight away.

---

## 12. Rulings introduced here

| # | Ruling |
|---|---|
| W1 | The server is authoritative: it alone reduces. Clients only validate. |
| W2 | Online states are redacted: `rng.seed`, `rng.state` and `config.seed` are 0 until the game ends; `rng.draws` stays. |
| W3 | A proposal's `base` must equal the current `seq`, or it's rejected as `STALE`. |
| W4 | Online undo covers only the latest transform, only your own, and only if it rolled no dice. It can repeat, and needs no consent. |
| W5 | The seed and full log are revealed when the game ends, and the client replays them to verify the server. |
| W6 | Hot-seat behaviour doesn't change. |

## 13. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Server-authoritative engine, or a dumb relay with per-roll commit-reveal between peers? | **Server-authoritative** (W1). |
| D2 | Online undo? | As §6 (W4): your own latest, dice-free transform only; repeatable; no consent. |
| D3 | Sides and names? | The host's seat is their choice in the protocol; the app makes the host Player 1. Each player names their own admiral and ships. |
| D4 | How long do games live? | Deleted after 30 days idle; ended games kept 7 days for export. |
| D8 | Whole states or deltas on the wire? | Whole redacted states until size hurts (§4.3). |
| D9 | Turn timeouts or a clock? | None. |
| D10 | Who decides fleets? | Each player brings their own, any faction. The host sets the number of ships a side and the optional rules. Each fleet is checked when it's offered (by trying it in `newGame` against a mirror of itself), so the game can always start. |

## 14. Later

Not in the first version; the design leaves room for each.

| # | What | Note |
|---|---|---|
| L5 | Spectator links | A third, read-only token; the server already broadcasts to every socket. |
| L6 | In-game chat | A `chat` message type relayed by the DO. |
| L7 | "Your turn" notifications | Web Push from the DO when the actor changes; *My games* shows whose turn it is meanwhile. |
