# @bfg/server

Network play's server side ([network/SPEC.md](../network/SPEC.md), [ADR 0003](../docs/adr/0003-network-play.md)): the server-authoritative game room. It runs the engine, holds the secret seed, and sends players redacted states.

## Status

| Piece | State |
|---|---|
| Protocol types and message shape checks (`protocol.ts`) | ✅ |
| `GameRoom`: lobby, start with a server seed, propose / apply / broadcast, every rejection (engine failures included), online undo, presence, limits, lifetime | ✅ |
| Redaction (`redact.ts`) and end-of-game verification (`verify.ts`) | ✅ |
| Cloudflare Worker + Durable Object adapter, `wrangler.toml`, deploy | next |

## Layout

```
src/
  protocol.ts   every client ↔ server message (spec §4), limits, parseClientMessage
  room.ts       createRoom and GameRoom: messages in, addressed messages out, `data` to persist
  redact.ts     hide the seed and RNG state (W2)
  verify.ts     replay a revealed game and compare (W5); used by the client at the end
  config.ts     the Cruiser Clash config the room builds when both seats are named
test/
  harness.ts    a room with fake connections and deterministic deps
  room.test.ts  lobby, proposals, rejections, undo, connections, limits
  engine-error.test.ts  a throwing reducer rejects the proposal and changes nothing
  fuzz.test.ts  the engine's bot plays whole games through the room from redacted states
```

`GameRoom` has no Cloudflare APIs: randomness, SHA-256 and the clock come in as `Deps`, so it's tested like the engine. The Durable Object will be a thin adapter around it.

## Working on it

```sh
npm ci
npm run check      # typecheck + lint + tests
```
