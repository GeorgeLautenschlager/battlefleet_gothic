# @bfg/server

Network play's server side ([network/SPEC.md](../network/SPEC.md), [ADR 0003](../docs/adr/0003-network-play.md)): the server-authoritative game room. It runs the engine, holds the secret seed, and sends players redacted states.

## Status

| Piece | State |
|---|---|
| Protocol types and message shape checks (`protocol.ts`) | ✅ |
| `GameRoom`: lobby, start with a server seed, propose / apply / broadcast, every rejection (engine failures included), online undo, presence, limits, lifetime | ✅ |
| Redaction (`redact.ts`) and end-of-game verification (`verify.ts`) | ✅ |
| Cloudflare Worker (routes, CORS, create-game rate limit) and the `GameDO` Durable Object (hibernating WebSockets, storage, expiry alarm) | ✅ |
| Integration tests in workerd: HTTP, CORS, a game over real WebSockets, reconnect | ✅ |
| Deploy from `main` (`.github/workflows/server.yml`) | ✅ |
| The app talking to it | next (spec §11 steps 3–4) |

## Layout

```
src/
  protocol.ts   every client ↔ server message (spec §4), limits, parseClientMessage
  room.ts       createRoom and GameRoom: messages in, addressed messages out, `data` to persist
  redact.ts     hide the seed and RNG state (W2)
  verify.ts     replay a revealed game and compare (W5); used by the client at the end
  config.ts     the Cruiser Clash config the room builds when both seats are named
  cf/worker.ts  the Worker: POST /games, GET /games/:id/ws, GET /health, CORS
  cf/durable.ts GameDO: a thin Durable Object around GameRoom (hibernation, storage, alarm)
  cf/deps.ts    Deps from Web Crypto and the clock
test/
  harness.ts    a room with fake connections and deterministic deps
  room.test.ts  lobby, proposals, rejections, undo, connections, limits
  engine-error.test.ts  a throwing reducer rejects the proposal and changes nothing
  fuzz.test.ts  the engine's bot plays whole games through the room from redacted states
  worker.int.test.ts  the real Worker + Durable Object in workerd, over HTTP and WebSockets
```

`GameRoom` has no Cloudflare APIs: randomness, SHA-256 and the clock come in as `Deps`, so it's tested like the engine. The Durable Object will be a thin adapter around it.

## Working on it

```sh
npm ci
npm run check      # typecheck + lint + tests (the integration tests start workerd locally)
npm run dev        # wrangler dev: the server on http://localhost:8787
```

## Deploying

`main` deploys automatically (`.github/workflows/server.yml`, job `deploy`) once `check` passes. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, which live as secrets on the repository's `github-pages` environment, and a `workers.dev` subdomain on the Cloudflare account. `ENGINE_BUILD` is stamped with the last commit that touched `engine/src`; the app must send the same value in `hello`.
