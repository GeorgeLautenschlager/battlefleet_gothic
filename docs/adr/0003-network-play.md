# ADR 0003: Network play with a server-authoritative engine

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** George Lautenschlager, Claude

## Context

Hot-seat works ([ADR 0002](0002-browser-app.md)); the next step is two players on two devices. Forces at play:

1. **The engine is deterministic.** A game is its config (with the seed) plus a list of transforms, so devices only need to agree on one ordered list. Transforms are tiny.
2. **Dice are the catch.** The seed is in the state; anyone holding the state can predict every roll.
3. **The engine is portable by construction** ([ADR 0001](0001-engine-language.md)): pure TypeScript, no DOM or Node APIs. A server can run it unchanged.
4. **`validate` never reads the RNG.** Clients can preview and check moves on a state with the dice hidden.
5. **No dev box, low cost.** The app is on GitHub Pages; the backend should be serverless and essentially free at a hobby scale.
6. **Battlefleet Gothic has almost no hidden information**, and games may be live or played a turn a day.

## Decision

Full design: [`network/SPEC.md`](../../network/SPEC.md).

- **A server-authoritative engine on Cloudflare.** A Worker routes; one **Durable Object per game** runs `validate` and `reduce`, holds the secret seed, the transform log and a snapshot, and broadcasts each result over WebSockets.
- **Clients only validate.** They render the redacted states the server sends (seed and RNG state zeroed, `draws` kept) and use `validate` locally for ghosts, previews and button states.
- **Verification at the end.** When a game ends the server reveals the seed and the full log; clients replay them and check the final state.
- **No accounts.** A 128-bit token per seat, carried in the invite link's URL fragment; the server stores hashes only.
- **Online undo:** only your own latest transform, and only if it rolled no dice.
- **Hot-seat unchanged.** The UI drives a `GameSource`: `LocalSource` (today's history) or `RemoteSource` (the socket).
- **Server logic is a plain `GameRoom` class**, unit-tested without Cloudflare; the Durable Object is a thin adapter.

## Options considered

| Option | Verdict | Why |
|---|---|---|
| **Server-authoritative engine (Durable Objects)** | **Chosen** | Dice are simply secret; one serial actor per game orders transforms; the engine already runs anywhere; idle games cost nothing with WebSocket hibernation. |
| Dumb relay + per-roll commit-reveal | Rejected | A handshake round-trip on every roll, more protocol, and still needs a server. |
| Peer-to-peer (WebRTC) | Rejected | Needs signalling and sometimes a relay anyway; dice need commit-reveal; harder to resume turn-by-turn games. |
| Honour system (share the seed) | Rejected for online | Fine for friends, but trivially exploitable. Hot-seat keeps it. |
| A conventional server (Node on a VM) | Rejected | Something to run and patch; no advantage at this scale. |

## Consequences

- Online play needs the server: no server, no online play. Builds without `VITE_SERVER_URL` simply hide it.
- Client and server must run the same engine build; a mismatch tells the client to reload.
- A rules change deployed mid-game applies to the rest of that game. Accepted for Phase 1.
- Deploying the server needs Cloudflare credentials as repository secrets, which George provides.
