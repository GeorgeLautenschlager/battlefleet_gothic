# @bfg/app

Battlefleet Gothic in the browser: hot-seat Cruiser Clash (one Lunar vs one Murder) on top of [`@bfg/engine`](../engine/README.md). Decisions in [ADR 0002](../docs/adr/0002-browser-app.md).

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
| Zoom and pan, dice presentation, polish | next |

## Layout

```
src/
  game/history.ts   config + initial state + applied transforms; apply, undo, saves
  game/storage.ts   localStorage autosave
  game/config.ts    the Cruiser Clash config (Lunar vs Murder)
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

In a cloud session with a preinstalled Chromium, run `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`.
