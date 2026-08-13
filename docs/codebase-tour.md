# Paletcam — a guided tour of the codebase

This is a course, not a reference. Read it top to bottom once, then keep it
around as a map. Each chapter names the files it talks about so you can open
them alongside. The perceptual pipeline (quantizer, scoring, hybrid selector)
is deliberately *not* covered in depth — you already know it, and
`docs/extraction-refactor.md` exists for that.

---

## Chapter 1 — The big picture

Paletcam is a **vanilla-JS single-page PWA** with no framework (the only
runtime dependencies are `lit` — used by five components: the performance
HUD, the toast host, and the shared/settings/config panels — and
`color-name-list`). There is no router: `index.html` is
the whole app, and everything that looks like a "page" (collection, settings,
config) is a panel/drawer layered on top of the camera view.

There are four JS entry points, bundled separately by `scripts/build.js`:

| Entry | Role |
|---|---|
| `src/app.js` | The app itself — camera, live palette, capture, panels |
| `src/pwa-install.js` | Service-worker registration + the "install app" toast |
| `src/offline.js` | Tiny script for `offline.html` (the no-network fallback page) |
| `src/debug-extraction.js` | Extraction lab page — only built on `pwa/preprod` |

Plus two **Web Worker** entry points bundled into `dist/workers/`:
`palette-extraction.worker.js` and `palette-json-transfer.worker.js`.

The mental model of the source tree:

```
src/
├── app.js                     ← composition root (wires everything, owns nothing)
├── modules/                   ← camera + palette machinery
│   ├── app/                   ← controllers app.js composes (preview, capture, lifecycle…)
│   ├── collection/            ← saved-palettes UI (cards, viewer, polaroid, verso)
│   └── panels/                ← config & settings drawers
├── palette-storage/           ← IndexedDB layer (Dexie)
├── community-service/         ← publish/unpublish/moderation against colorcatchers.co
├── workers/                   ← worker entry points (thin; real logic lives in modules/)
└── *-ui.js, *-service.js      ← top-level features (collection, login, stats…)
```

A pattern you'll see everywhere: **factory functions returning controller
objects** (`createXController({ deps })`). No classes, no globals; every
dependency is passed in explicitly, which is what makes the test suite
(`bun run test`, isolated per-file by `scripts/test-isolated.js`) possible
without a browser.

---

## Chapter 2 — Boot: what happens when the app starts

Open `src/app.js` (730 lines) — it is the composition root and the best
single file to understand the architecture. Its job is only to:

1. **Grab DOM nodes** from `index.html` (camera feed, canvases, buttons).
2. **Instantiate ~12 controllers** and hand each one the exact dependencies
   it needs — mostly as *getter functions* (`getSwatchCount: () => swatchCount`)
   so controllers always read fresh values without holding state themselves.
3. **Bind events** through one `AbortController` (`bindManagedEventListener`),
   so `destroyApp()` can detach everything with a single `abort()`.
4. Kick off the camera stream.

The controllers it composes (all in `src/modules/` and `src/modules/app/`):

- `cameraController` — getUserMedia, zoom/exposure capabilities, facing mode.
- `cameraLifecycleController` — start/stop/resume across tab switches,
  iOS interruptions, permission flow.
- `livePreviewController` — **the heart of the app**; Chapter 3.
- `captureController` — freezes a frame, extracts the final palette, saves.
- `zoomUi`, `exposureUi`, `gridUi` — overlay widgets that
  live inside the camera viewport frame.
- `performanceHud` — Chapter 8.
- `swatchSliderUi`, `visualEffects`, `captureMicroInteractions` — small
  presentational helpers (glow on the capture button, palette ribbon, pulses).

One platform quirk decided at boot (`app.js:83-98`): on **iOS** the `<video>`
element is hidden off-screen and the preview you see is a `<canvas>` repainted
every frame (`shouldUseCanvasPreview`). This works around iOS Safari video
rendering problems and explains the `use-canvas-camera-preview` class and the
`cameraSourceMount` div appended to `<body>`.

**Settings are the nervous system.** `src/app-settings.js` holds a single
normalized settings object (locale, capture mode, swatch options, all the
algorithm tunings). Anyone calls `updateAppSettings(patch)`; the store
normalizes/clamps it, persists to localStorage, and notifies subscribers.
`app.js` subscribes with `applyAppSettings()` and pushes the new values into
its local variables. That is the whole "state management": one pub/sub store,
no reducer, no framework.

---

## Chapter 3 — The live preview loop (and why it's fast)

File: `src/modules/app/live-preview-controller.js` (880 lines).

The loop is a classic `requestAnimationFrame` cycle (`refresh()` →
`scheduleRefresh()`), but it splits work into **two very different cadences**:

- **Every frame (60/120 Hz):** repaint the camera canvas (iOS only), smooth
  colors, animate badges, repaint the palette bars *only if something
  actually changed*.
- **Every ≥200 ms (`EXTRACTION_MIN_INTERVAL_MS`):** run a palette extraction.
  The interval is time-based on purpose, so a 120 Hz display doesn't do twice
  the work of a 60 Hz one.

The performance tricks worth knowing, in order of impact:

1. **The analysis canvas** (`ANALYSIS_MAX_WIDTH = 320`). Extraction never
   reads the full-resolution frame. The frame is drawn into a ≤320-px-wide
   offscreen canvas first; the comment at the top of the file explains why:
   the quantizer samples ~40k pixels max, so a bigger readback is pure
   `getImageData` cost with zero quality gain.
2. **`willReadFrequently: true`** on the 2D contexts that get read back —
   this keeps the canvas on the CPU and avoids GPU→CPU sync stalls.
3. **The worker** (Chapter 4) takes the extraction itself off the main thread.
4. **Paint deduplication** (`paletteUnchanged`, line ~804): the color
   smoother returns the *same object references* while the palette is inside
   its deadband, so a cheap identity check skips the whole
   repaint-bars/lock-hints/glow branch on most frames.
5. **Cached camera track settings** — `getSettings()` on a MediaStreamTrack
   is surprisingly expensive, so it's polled at most once per second.

What flows out of the loop each extraction: `lastExtractedColors` (raw
quantizer output), `lastExtractedOrigins` (where each color lives in the
frame), then smoothing (`color-smoothing.js`, factor 0.16) → optional
`removeDarkestColor` ("one more color" setting) → frozen-pin overlay →
`displayColors`, which is what you see as bars.

---

## Chapter 4 — Workers

Two workers, same shape: a *thin entry point* in `src/workers/` and a
*controller* on the main-thread side in `src/modules/`.

### The extraction worker

- Entry: `src/workers/palette-extraction.worker.js` — receives an
  `extract-palette` message, runs the exact same `extractPaletteColors()` you
  know from the pipeline plus origin tracking and frozen-presence
  measurement, posts the result back with a duration.
- Controller: `src/modules/palette-extraction-worker.js`. This is where the
  interesting decisions live:
  - **Zero-copy handoff.** The `Uint8ClampedArray.buffer` from
    `getImageData` is *transferred* (`postMessage(msg, [buffer])`), not
    cloned. A 320×240 RGBA frame is ~300 KB; transferring makes it free.
  - **A one-deep queue, latest-wins.** At most one job is in flight and one
    is queued; a new request simply *overwrites* `queuedJob`. If the camera
    produces frames faster than the worker extracts, intermediate frames are
    dropped — exactly what you want for live preview.
  - **Generation counter.** `invalidate()` bumps `currentGeneration`
    whenever the preview resets (mode switch, swatch-count change). Results
    from an older generation are ignored, so a stale extraction can never
    paint over a fresh state.
  - **Fail-once, fall back forever.** Any worker error disables the worker
    for the rest of the session and the live preview silently switches to
    the synchronous in-thread path (`app.js` just logs it). Same result,
    just jankier — a graceful degradation, not a feature toggle.

### The JSON transfer worker

- Entry: `src/workers/palette-json-transfer.worker.js`, controller:
  `src/modules/palette-json-worker.js`, used by `src/palette-storage/backup.js`.
- Its only job is serializing/deserializing the **collection backup**
  (export/import your palettes as JSON, photos base64-encoded). Stringifying
  hundreds of palettes with embedded images would freeze the UI for seconds;
  the worker keeps the main thread free, and the backup code additionally
  yields to the paint loop every 20 palettes to keep the progress UI moving.
- Same request/response bookkeeping style (request ids, pending map,
  disable-on-error), but promise-based since callers await one-shot results.

---

## Chapter 5 — Badges, the lock, and frozen pins

This is one feature with three faces:

- **Origin badges** — the numbered discs floating on the live view, marking
  *where in the frame* each palette color comes from.
- **The lock (frozen pins)** — tap a badge or a swatch to pin that color; it
  stops following the live extraction.
- **The padlock hints** — the little open/closed padlocks over the swatch
  bars that teach you the swatches are tappable.

### Where badges come from

`src/modules/palette-origins.js` scans the analysis frame and computes, for
each extracted color, the **centroid of the pixels that match it** (with
region hysteresis so a badge doesn't teleport between two similar-density
regions). That runs inside the extraction worker, so origins arrive together
with the colors.

Back on the main thread, `updateOriginMarkers()` in the live preview
controller matches each *displayed* (smoothed) color to its nearest *raw*
color to find its origin, then eases the badge toward it
(`ORIGIN_MARKER_SMOOTHING_FACTOR = 0.1`) so sensor noise doesn't make markers
twitch. New badges "pop" in with an `easeOutBack` scale animation. Drawing
happens on a dedicated overlay canvas, DPR-aware.

### The frozen pin state machine

`src/modules/app/frozen-pins.js` is **pure bookkeeping** — no DOM, no canvas,
no haptics. It tracks which slots are pinned and, crucially, owns the two
*watchdogs* that decide when pins release themselves:

1. **Scene-change watchdog** (`checkSceneChange`). When you freeze, the
   current raw extraction is snapshotted as the "scene reference". Every new
   extraction is compared to it (mean nearest-color distance). Two tiers:
   - mean distance > **85** → unmistakable scene swap → release everything
     immediately (≤200 ms);
   - mean distance > **58** for **3 consecutive extractions** → sustained
     drift (slow pan, reframe, autoexposure) → release everything.
   The comment in the file records the calibration: static-scene noise
   measures ≈ 8, a full scene change ≈ 100.
2. **Per-pin presence watchdog** (`processPresence`). The worker measures
   what fraction of frame pixels still match each frozen color. If a pinned
   color's pixels vanish (you covered the object, walked away), that single
   pin releases after 2 consecutive misses. The threshold is *adaptive*: a
   fraction (25%) of the best presence that pin ever measured, clamped —
   so a small vivid object is judged against its own normal.

### The presentation side

The live preview controller reacts to release lists: released badges get a
**falling animation** (hop up at −140 px/s, gravity 1400 px/s², tumble off
the bottom, fade out — `buildFallingBadgeMarkers`), the live badge pops back
in, and a haptic pattern fires (`navigator.vibrate`, no-op on iOS). The
padlock hints (`syncSwatchLockHints`) are plain DOM nodes in
`#paletteLockOverlay`, restyled per frame-change with the same numbering and
ink-color logic as the badges so the swatch↔badge mapping reads at a glance.

Hit-testing: tapping the camera view runs `hitTestOriginMarkers` against the
last rendered markers; tapping the palette bars divides the x-coordinate by
the swatch count. Both funnel into `toggleSlotFreeze(slot)`.

---

## Chapter 6 — Storage: three layers, three jobs

### Layer 1: localStorage — small, synchronous, key-per-feature

Every key is namespaced and versioned. The full inventory:

| Key | Owner | Contents |
|---|---|---|
| `paletcam:settings:v1` | `app-settings.js` | The whole settings object |
| `paletcam:community:session:v1` | `community-session.js` | Auth token + user for colorcatchers.co |
| `paletcam:community:delete-cleanup-outbox:v1` | `community-delete-outbox.js` | Retry queue (Chapter 7) |
| `paletcam:stats:pending:local_capture` | `capture-stat-service.js` | Count of captures not yet reported |
| `paletcam:performance-hud-position:v1` | `performance-hud.js` | Where you dragged the HUD |
| `paletcam:grid:v1` | `camera-grid-ui.js` | Grid overlay on/off |
| `pwa-install-dismissed` | `pwa-install.js` | You closed the install toast |

The shared discipline: **every read goes through a normalizer** that clamps,
validates, and falls back to defaults — so corrupt or stale JSON can never
crash the app; it just gets repaired on the next write.

### Layer 2: IndexedDB (Dexie) — the palette collection

`src/palette-storage/` wraps a Dexie database called `PaletcamDB`.
`db.js` is the schema history, and it tells a story in three versions:

- **v1**: one `palettes` table (`++id, timestamp`), photo blob inline.
- **v2**: adds community fields (`remoteCatchId`, `moderationStatus`,
  `postedAt`…) with an upgrade that backfills nulls.
- **v3**: the important one — **splits photos out** into a `paletteAssets`
  table keyed by `paletteId`. Palette *metadata* (colors, timestamps,
  settings) and palette *assets* (the heavy JPEG blob) are now separate rows.
  Why: listing the collection means reading every metadata row; if each row
  drags a multi-megabyte blob along, iOS Safari chokes. `getSavedPalettes()`
  never touches blobs; viewers hydrate them on demand
  (`assets.js`, which also lazily repairs any legacy inline-blob record it
  encounters).

The rest of the folder: `records.js` (normalizers/constructors for both
record types), `core.js` (CRUD, always inside `db.transaction` so a palette
and its asset can't get out of sync), `backup.js` + `json-transfer.js`
(export/import via the JSON worker), `blob.js` (dataURL↔Blob).

### Layer 3: Cache Storage — the offline app shell

Owned entirely by the service worker. Next chapter.

---

## Chapter 7 — Offline & the PWA machinery

### The service worker (`public/service-worker.js`)

Hand-written, ~215 lines, no Workbox. Three routing strategies, chosen by
request type:

1. **Navigations** (`request.mode === "navigate"`): serve the cached
   `index.html` *immediately*, refresh it from the network in the
   background. This is the "app shell" pattern — the app opens instantly
   even offline, and a pure-SPA assumption makes it safe to cache every
   navigation under the single `index.html` key. If there's no cached shell
   and no network, `offline.html` (with its own tiny `offline.js`) is the
   last resort.
2. **Scripts / styles / workers**: cache-first, with a background
   revalidation that *bypasses the HTTP cache* (`cache: "no-store"`) so a
   deploy actually propagates.
3. **Everything else same-origin** (images, fonts, JSON): classic
   stale-while-revalidate, this time *respecting* the HTTP cache.

Never touched by the SW: `api/` calls, the SW script itself, the precache
manifest, and the web manifest (`BYPASS_CACHE_PATHS`) — the things where
staleness would be dangerous.

### How updates roll out

This is the part that usually feels magical, so here is the full chain:

1. `scripts/build.js` stamps a fresh **build id** (`Date.now().toString(36)`)
   into `CACHE_NAME` and writes `precache-manifest.json` — the list of every
   built file.
2. On **install**, the new SW opens its new cache and pre-caches the shell +
   manifest entries, then `skipWaiting()` — no "waiting" phase.
3. On **activate**, every cache whose name isn't the current build id is
   deleted, then `clients.claim()`.
4. On the page side (`pwa-install.js`), the registration is created with
   `updateViaCache: "none"` and `registration.update()` is called every
   5 minutes *and* on focus/pageshow/visibilitychange — so a phone waking
   from standby checks for a new build right away.
5. When the new SW takes over, the `controllerchange` listener reloads the
   page once (guarded by a `refreshing` flag). That reload is the moment the
   user actually gets the new version.

In local dev the opposite happens: any registered SW is **unregistered** on
load so caching never fights the dev server.

### The install toast

Also in `pwa-install.js`: the browser's `beforeinstallprompt` event is
intercepted and stashed; 3 seconds later a custom toast offers installation.
"Install" replays the stashed prompt; "×" writes `pwa-install-dismissed` so
the toast never comes back.

### Offline-resilient side effects

Two features assume the network can vanish at any time and use the same
pattern — *persist intent locally, flush on every plausible occasion*:

- **Capture stats** (`capture-stat-service.js`): each save increments a
  pending counter in localStorage and tries to POST it; flushes retry on
  `online` and on the next capture. Fire-and-forget, silent failure.
- **The delete outbox** (`community-delete-outbox.js`): deleting a palette
  locally that was published remotely enqueues the remote cleanup. The
  outbox is flushed on startup, on `online`, on tab-visible, and on login —
  entries carry attempt counts and survive across sessions until they
  succeed.

---

## Chapter 8 — The community layer (brief)

`src/community-service/` talks to `colorcatchers.co/api/v1`
(`community-api.js` is the raw HTTP layer, `config.js` resolves base URLs —
the dev server proxies `/api/v1` so localhost works without CORS pain).

- **Session**: token + user in localStorage (`community-session.js`), with a
  subscribe API; reads re-check storage so multiple tabs stay coherent.
- **Publication** (`publication.js`): builds the payload (photo base64'd),
  posts a "catch", then writes `remoteCatchId`/`moderationStatus` back into
  the palette's IndexedDB record — the local record is the source of truth
  for what's published.
- **Moderation sync** (`moderation-sync.js`): batch-asks the server for the
  current status of every published palette and reconciles local records
  (including remote deletions). Triggered from the collection UI.
- Publication state drives the little status chip on collection cards
  (`palette-card.js`) — that's the "publication badge", unrelated to the
  origin badges of Chapter 5.

---

## Chapter 9 — Performance instrumentation

- **The HUD** (`src/modules/performance-hud.js`) — the one Lit component.
  Enabled from settings, draggable (position persisted). The live preview
  loop calls `performanceHud.recordFrame({...})` every frame with real
  measurements: refresh duration, extraction duration (worker-reported),
  camera fps, analysis dimensions, plus its own sampling of FPS, long tasks
  (`PerformanceObserver`), and JS heap. Numbers are blended with an
  exponential moving average so they're readable, updated 4×/s.
- **Client logging** (`src/modules/client-log.js` + `error-reporting.js`):
  timing/diagnostic events (`clientLog(...)` calls you'll see sprinkled in
  the storage layer) and uncaught errors ship to the log server
  (cclogs.ludique.dev) — base URL injected at build time via
  `__PALETCAM_LOG_API_BASE_URL__`.

---

## Chapter 10 — Build & dev tooling

- **Dev** (`scripts/dev-server.js`): a Bun server on **:3000** that serves
  `public/` and bundles `src/` on the fly — no bundler watch process. It
  proxies `/api/v1` to colorcatchers.co and applies the same security
  headers as production (`security-headers.js`).
- **Build** (`scripts/build.js`): `Bun.build` minifies the four entry points
  plus the two workers, copies `public/`, then does three stamping passes:
  app version + commit hash into every HTML/JS (`__APP_VERSION__`,
  `__COMMIT_HASH__`), the build id into the service worker, and finally
  writes `precache-manifest.json` from the actual dist contents. Build-time
  constants (`__COMMUNITY_BASE_URL__`, deploy branch, log URL) are injected
  via `define` — that's why `config.js` reads bare globals.
- **Tests**: `bun run test` runs each `*.test.js` in an isolated process
  (`scripts/test-isolated.js`) so module-level state (settings store,
  session singletons) can't leak between files. Storage-dependent tests use
  hand-rolled localStorage mocks.
- **CSS**: token-driven (see `docs/css-architecture.md`); `bun run lint:css`
  enforces that values come from `public/styles/settings/tokens.css`.

---

## Chapter 11 — Suggested reading order

If you want to internalize the code itself, read in this order — each file
makes the next one easier:

1. `src/app.js` — the wiring diagram.
2. `src/modules/app/live-preview-controller.js` — the runtime heart.
3. `src/modules/palette-extraction-worker.js` — the worker contract.
4. `src/modules/app/frozen-pins.js` — small, pure, beautifully commented.
5. `src/palette-storage/db.js` then `core.js` — the data model.
6. `public/service-worker.js` + `src/pwa-install.js` — the offline story.
7. `src/collection-ui.js` — the biggest file (1470 lines); by now every
   import at its top will be familiar.

And the questions worth asking yourself afterward, as a self-test:

- Why does the extraction worker *transfer* the buffer instead of cloning,
  and why is the queue only one deep?
- What exactly happens, step by step, between pushing a new commit and a
  user's phone running the new build?
- Why did schema v3 split `paletteAssets` out of `palettes`?
- Which two watchdogs can release a frozen pin, and why do they have
  different breach limits?

If you can answer those four, you own this codebase.
