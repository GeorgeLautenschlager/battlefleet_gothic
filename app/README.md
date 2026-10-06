# @bfg/app

Battlefleet Gothic in the browser: hot-seat Cruiser Clash (1–4 cruisers a side: Lunars for the Imperial Navy, Murders for Chaos, mirror matches welcome), online the same, each player bringing their own fleet, on top of [`@bfg/engine`](../engine/README.md). Decisions in [ADR 0002](../docs/adr/0002-browser-app.md).

## Status

| Piece | State |
|---|---|
| New game, history, undo to the last roll, autosave, export/import | ✅ |
| Table view: ships, Blast Markers, salvos, deployment zones | ✅ |
| Setup: rolls, click-to-deploy, first-turn choice | ✅ |
| Log as prose | ✅ |
| Transform console (raw JSON, validated live) | ✅ for debugging |
| Battle controls: turn banner, orders, brace prompts, hulk drift, salvo moves, repairs, BM removal, end step | ✅ |
| Movement plotter: click-to-plot with turn limits, exact turns at the turn point, typed steps, live verdict, guides, keyboard | ✅ |
| Shooting: weapon picker, arc/range overlay, target list with the engine's reasons, click-to-fire, arc/aspect choices, torpedo aiming and launch | ✅ |
| Fleets: pick a fleet per side (Imperial Navy or Chaos, mirror matches allowed), 1–4 cruisers a side, ship names, ramming option; pick which ship to deploy or move next. Online: the host sets the size and options, the guest brings their own fleet in the lobby | ✅ |
| Boarding (rules option, on by default): "Board X" in the plotter when a path ends touching an enemy, the End Phase boarding panel (together / separately, damage order, teleport attacks), grapple lines on the table, boarding and grapple status on the ship cards, log prose | ✅ |
| Attack craft (carriers option, off by default): a carrier per side in the fleet forms (Dictator, Devastation); the launch panel (squadrons by kind, CAP fighters, recall, fleet limit); waves flown by clicking waypoints, with CAP over a friendly ship at the end; releasing CAP at the start of the Movement Phase; waves and CAP on the table; bays and CAP on the ship cards; log prose | ✅ |
| Ship classes: a class per ship in the fleet forms (Lunar, Gothic, Tyrant; Murder, Murder lance variant, Carnage, Inferno, Slaughter; carriers with the option), the engine's reason shown when a fleet can't play; combined battery volleys offered first in the target list (a table click fires the volley) | ✅ |
| Nova cannon: the Dominator and the Lunar, Tyrant and Dominator options in the class pickers (those over 185 pts in points battles only); aiming by clicking the table or an enemy, with the legal band, the template and its scatter reach drawn on the table; log prose | ✅ |
| Fleet Engagement (hot-seat and online): a Scenario choice in the forms; formations picked in turn on the honour system; the set-up roll-off; the two set-ups on offer, previewed on the table; divisions and their facing arrows drawn during setup; no round limit in the clock; log prose | ✅ |
| Points battles (hot-seat and online): Cruiser Clash or 500 / 750 / 1,000 / 1,500 points a side, any number of ships within the limit (carriers included), Cruiser Clash or victory points scoring, and a result panel with each side's VP breakdown | ✅ |
| Online play: start screen (hot-seat / online / My games), invite links, lobby, `RemoteSource` over WebSocket, waiting and presence, reconnect, online undo, end-of-game dice verification, export | ✅ |
| Zoom and pan, dice presentation, polish | next |

## Layout

```
src/
  game/history.ts   config + initial state + applied transforms; apply, undo, saves
  game/source.ts    GameSource: where the game comes from (hot-seat now, online next); seats
  game/useLocalSource.ts  hot-seat: the history behind the GameSource interface
  online/           network play: config, HTTP api, My games, useRemoteSource, start/lobby/banner screens
  GameView.tsx      the battle UI, driven by any GameSource
  game/storage.ts   localStorage autosave
  game/config.ts    the Cruiser Clash config: a fleet per side, ship names, the ramming option
  game/pick.ts      several ships a side: which one to deploy or move next
  table/            the SVG table: view maths, ship glyphs, ghosts
  plot/             the movement plotter: path maths (plot.ts), state hook, table overlay, side panel
  fire/             shooting: targets and choices (fire.ts), the aimed weapon, controls, arc overlay
  panels/           clock bar, ship cards, log feed, setup controls, console, new game
  controls/         battle controls: Act (validated button), brace prompt, per-step controls, priority lists
  log/format.ts     log entries as sentences
test/               vitest (logic)
e2e/                Playwright (flows through the built app); fixtures/ holds seeded saves
```

## Working on it

```sh
npm ci
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + unit tests
npm run e2e        # builds, serves, and drives the app in Chromium
```

`npm run e2e` starts the game server locally (`wrangler dev` in `../server`, so run `npm ci` there first) and builds the app against it; `online.spec.ts` plays two browsers against it. To smoke-test a deployed server instead: `E2E_SERVER_URL=https://… E2E_ENGINE_BUILD=<its /health engine> npm run e2e`.

In a cloud session with a preinstalled Chromium, add `CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Online play appears only when the build has `VITE_SERVER_URL` (and `VITE_ENGINE_BUILD`, matching the server's). CI builds Pages with the live server and the last commit that touched `engine/src`.
