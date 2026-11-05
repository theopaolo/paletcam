# Paletcam: a guided tour of the codebase

This is a course: read it top to bottom once, then keep it around as a map.
Each chapter names the files it talks about so you can open them alongside.
The tour skips the perceptual pipeline (quantizer, hybrid selector,
smoothing). `docs/extraction-pipeline.md` covers it in depth.

---

## Chapter 1: The big picture

Paletcam is a **vanilla-JS single-page PWA** with no framework. It has two
runtime dependencies. The first is `lit`, which five components use (the
performance HUD, the toast host, and the shared, settings and config panels),
along with the template-only tuning panels in `tune-panels.js`. The second is
`color-name-list`. Dexie is not on that list because it is vendored as
`src/vendor/dexie.mjs`. There is no router: `index.html` is the whole app. The
collection and settings are panels layered on top of the camera view, and the
tuning controls sit in a tray that slides up over the palette strip.

`scripts/build.js` bundles four JS entry points separately:

| Entry | Role |
|---|---|
| `src/app.js` | The app itself: camera, live palette, capture, panels |
| `src/pwa-install.js` | Service-worker registration + the "install app" toast |
| `src/offline.js` | Tiny script for `offline.html` (the no-network fallback page) |
| `src/debug-extraction.js` | Extraction lab page, only built on `pwa/preprod` |

It also bundles two **Web Worker** entry points into `dist/workers/`:
`palette-extraction.worker.js` and `palette-json-transfer.worker.js`.

The source tree looks like this:

```
src/
├── app.js                     ← composition root (wires everything, owns nothing)
├── modules/                   ← camera + palette machinery, footer controls
│   ├── app/                   ← controllers app.js composes (preview, capture, lifecycle…)
│   ├── collection/            ← saved-palettes UI (views, rail, cards, viewer, polaroid, verso)
│   └── panels/                ← settings drawer, tuning drawer and tray panels
├── palette-storage/           ← IndexedDB layer (Dexie)
├── community-service/         ← publish/unpublish/moderation against colorcatchers.co
├── workers/                   ← worker entry points (thin; real logic lives in modules/)
└── *-ui.js, *-service.js      ← top-level features (collection, login, backup, stats…)
```

Outside `src/`, `services/` holds two small Bun and Hono servers that deploy
on their own: `log-server` (cclogs.ludique.dev, Chapter 9) and `sync-server`
(the backup server, Chapter 6).

You'll see one pattern everywhere: **factory functions that return controller
objects** (`createXController({ deps })`). The code has no classes and no
globals. The caller passes every dependency in explicitly, and that is what
lets the test suite (`bun run test`, isolated per file by
`scripts/test-isolated.js`) run without a browser.

---

## Chapter 2: What happens when the app starts

Open `src/app.js` (813 lines). It is the composition root, and it is the best
single file for understanding the architecture. Its only job is to:

1. **Grab DOM nodes** from `index.html` (camera feed, canvases, buttons)
   through `createAppView()` in `modules/app/app-view.js`.
2. **Instantiate about twenty controllers** and hand each one the exact
   dependencies it needs. Most dependencies arrive as *getter functions*
   (`getSwatchCount: () => swatchCount`), so controllers read the current
   value on every call without holding state themselves.
3. **Bind events** through one `AbortController` (`bindManagedEventListener`),
   so `destroyApp()` can detach everything with a single `abort()`.
4. Start the camera stream.

It composes these controllers, all in `src/modules/` and `src/modules/app/`:

- `cameraController` handles getUserMedia, the zoom and exposure
  capabilities, and the facing mode.
- `cameraLifecycleController` starts, stops and resumes the camera across tab
  switches, iOS interruptions and the permission flow.
- `cameraSurfaceLifecycleController` stops the camera while the collection
  or a catch viewer covers the screen, and restarts it when they close.
- `livePreviewController` is **the heart of the app**. Chapter 3 covers it.
- `captureController` saves the palette on screen (pins included) with the
  frame as the master photo. It extracts afresh only when no live palette is
  ready.
- `zoomUi`, `exposureUi` and `gridUi` are overlay widgets inside the camera
  viewport frame (pinch zoom, tap-to-meter exposure, grid lines).
- `collectionEntryController` lazy-imports `collection-ui.js` on the first
  tap on the catches button or the last-catch thumbnail.
- `ralPreview` draws the single-color swatch shown at count 1 (Chapter 3).
- Chapter 9 covers `performanceHud`.
- `visualEffects` and `captureMicroInteractions` are small presentational
  helpers (glow on the capture button, capture pulse and flash, the palette
  flying into the thumbnail).
- The footer controls, described below.

**The footer.** Several footer variants still ship side by side.
`src/modules/footer-lab.js` stores which shutter face, count control, tuning
panel and look control a device uses (localStorage `paletcam.footerLab.v2`).
Its switches render only in debug builds, so production runs the defaults:
flat iris, the count as a sideways drum in the tray, the drums panel, the
prism look. `applyFooterLab()` in `app.js` builds the matching count control
from `count-controls-ui.js` (dial, ADJ lever, shutter slide or tray
scroller). The count stops are `SWATCH_COUNT_STOPS = [1, 3, 4, 5, 6, 7]`.
`iris-shutter.js` paints the live palette on the shutter as aperture blades.
The tuning tray (`#tuneTray`) opens from the bubble above the shutter:
`config-panel-controller.js` owns open and closed, `tune-tray.js` moves the
tray with the finger, and `panels/tune-panels.js` draws the panels. Those
panels drive the drawer's native inputs, so settings, history and undo stay
in `config-panel-controller.js`. `ui-feedback.js` synthesizes the clicks and
vibrations.

`app.js` settles one platform quirk at boot (`app.js:103-118`). On **iOS**,
the `<video>` element is hidden off-screen, and the preview you see is a
`<canvas>` repainted every frame (`shouldUseCanvasPreview`). This works around
iOS Safari video rendering problems. It also explains the
`use-canvas-camera-preview` class and the `cameraSourceMount` div appended to
`<body>`.

**Settings.** `src/app-settings.js` holds a single normalized settings object
(locale, collection view and zoom, the one-more-color and pins switches, all
the algorithm tunings). Any module can call `updateAppSettings(patch)`. The
store normalizes and clamps the patch, persists it to localStorage and
notifies subscribers. `app.js` subscribes with `applyAppSettings()` and pushes
the new values into its local variables. That one pub/sub store is the whole
"state management", with no reducer and no framework.

---

## Chapter 3: The live preview loop (and why it's fast)

The loop lives in `src/modules/app/live-preview-controller.js` (658 lines). It
delegates to four helpers in the same folder: `live-preview-timing.js` (the
rAF clock and cadences), `live-preview-frame-acquisition.js` (canvases,
drawing, pixel readback), `live-preview-extraction-pipeline.js` (worker or
in-thread extraction, latest result) and `live-preview-origin-marker-model.js`
(badge positions and animation).

The loop is a standard `requestAnimationFrame` cycle (`refresh()` →
`scheduleRefresh()`), but it splits the work into **two cadences**:

- **Every frame (60/120 Hz):** repaint the camera canvas (iOS only), smooth
  colors, animate badges, and repaint the palette bars *only if something
  changed*.
- **At least 200 ms apart (`EXTRACTION_MIN_INTERVAL_MS`):** run a palette
  extraction. The interval is time-based on purpose, so a 120 Hz display
  doesn't do twice the work of a 60 Hz one.

At count 1 (single color), the loop runs no extraction. Instead,
`requestCenterSample()` averages a small square under the crosshair every
100 ms (`readCenterColor()` in the frame-acquisition helper), and
`ral-preview.js` shows the color's name with the nearest RAL code in small
type. Internally, the code still calls this mode `"ral"`.

Here are the performance tricks, in order of impact:

1. **The analysis canvas** (`DEFAULT_ANALYSIS_MAX_WIDTH = 320` in
   `live-preview-frame-acquisition.js`). Extraction does not read the
   full-resolution frame. The loop first draws the frame into an offscreen
   canvas at most 320 px wide. The comment at the top of that file explains
   why: the quantizer samples ~40k pixels max, so a bigger readback adds
   `getImageData` cost with zero quality gain.
2. **`willReadFrequently: true`** is set on the 2D contexts that get read
   back. The flag keeps the canvas on the CPU and avoids GPU→CPU sync stalls.
3. **The worker** (Chapter 4) takes the extraction itself off the main thread.
   Outside iOS, it takes the pixel readback too: `grabAnalysisFrame()` hands
   the worker a scaled `ImageBitmap` from `createImageBitmap()`, so the live
   loop does not call `getImageData` on the main thread. iOS keeps its canvas
   preview path and reads the pixels on the main thread.
4. **Paint deduplication** (`paletteUnchanged`, line ~588). The color
   smoother returns the *same object references* while the palette is inside
   its deadband. A cheap identity check can then skip the whole branch that
   repaints the bars, lock hints and glow on most frames.
5. **Cached camera track settings.** `getSettings()` on a MediaStreamTrack is
   expensive, so the code polls it at most once per second.

After each extraction, `extractionPipeline.getSnapshot()` holds `colors` (raw
quantizer output) and `origins` (where each color lives in the frame). The
colors then go through smoothing (`color-smoothing.js`, factor 0.16), the
optional `removeDarkestColor` step (the "one more color" setting) and the
frozen-pin overlay (`frozenPins.applyToColors()`). The result is
`displayColors`, which you see as bars.

---

## Chapter 4: Workers

The two workers share a shape: a *thin entry point* in `src/workers/` and a
*controller* on the main-thread side in `src/modules/`.

### The extraction worker

- Entry: `src/workers/palette-extraction.worker.js`. It receives an
  `extract-palette` message that carries either a pixel buffer or an
  `ImageBitmap`, which it draws into an `OffscreenCanvas` to read. It runs
  the exact same `extractPaletteColors()` you know from the pipeline, plus
  origin tracking and frozen-presence measurement, and posts the result back
  with a duration.
- Controller: `src/modules/palette-extraction-worker.js`. The interesting
  decisions live here:
  - **Zero-copy handoff.** The controller *transfers* the frame's
    `ImageBitmap`, or on iOS the `Uint8ClampedArray.buffer` from
    `getImageData`, instead of cloning it
    (`postMessage(msg, [bitmap ?? buffer])`). A 320×240 RGBA frame is
    ~300 KB, and the transfer makes the handoff free.
  - **A one-deep queue, latest-wins.** At most one job is in flight and one
    is queued. A new request simply *overwrites* `queuedJob`. If the camera
    produces frames faster than the worker extracts, the frames in between
    get dropped, which is what you want for a live preview. The controller
    closes a dropped job's bitmap right away, since the bitmap holds GPU
    memory.
  - **Generation counter.** `invalidate()` bumps `currentGeneration`
    whenever the preview resets (mode switch, swatch-count change). The
    controller ignores results from an older generation, so a stale
    extraction can't paint over a fresh state.
  - **Fail once, fall back for the session.** Any worker error disables the
    worker for the rest of the session, and the live preview silently
    switches to the synchronous in-thread path (`app.js` records a
    `worker-fallback` metric and reports the error). A malformed result
    counts as an error too. The palette comes out the same, only jankier.
    The fallback is a graceful degradation that the app triggers on its own,
    with no feature toggle.

### The JSON transfer worker

- Entry: `src/workers/palette-json-transfer.worker.js`, controller:
  `src/modules/palette-json-worker.js`, used by `src/palette-storage/backup.js`.
- Its only job is to serialize and deserialize the **collection backup**:
  your palettes exported or imported as JSON, with photos base64-encoded.
  Stringifying hundreds of palettes with embedded images would freeze the UI
  for seconds. The worker keeps the main thread free, and the backup code
  also yields to the paint loop every 20 palettes so the progress UI keeps
  moving.
- It uses the same request/response bookkeeping (request ids, a pending map,
  disable-on-error), but it is promise-based because callers await one-shot
  results.

---

## Chapter 5: Badges, the lock, and frozen pins

This is one feature with three faces:

- **Origin badges** are the numbered discs floating on the live view. Each
  one marks *where in the frame* a palette color comes from.
- **The lock (frozen pins)**: tap a swatch to pin its color, and that color
  stops following the live extraction.
- **The padlock hints** are the little open and closed padlocks over the
  swatch bars. They teach you that the swatches are tappable.

The Pins key in the tuning tray switches badges and pins on or off (the
`originBadgesEnabled` setting). Single-color mode (count 1) has neither.

### Where badges come from

`src/modules/palette-origins.js` scans the analysis frame. For each extracted
color, it finds the **densest cluster of matching pixels** on a 12×9 grid and
returns that cluster's centroid. Region hysteresis keeps a badge from
teleporting between two regions of similar density. The scan runs inside the
extraction worker, so origins arrive together with the colors.

Back on the main thread, `updateOriginMarkers()` in the live preview
controller hands off to `live-preview-origin-marker-model.js`. The model
matches each *displayed* (smoothed) color to its nearest *raw* color to find
its origin. Then it eases the badge toward that origin
(`ORIGIN_MARKER_SMOOTHING_FACTOR = 0.1`) so sensor noise doesn't make markers
twitch. New badges "pop" in with an `easeOutBack` scale animation. The badges
are drawn on a dedicated overlay canvas that accounts for the device pixel
ratio (DPR).

### The frozen pin state machine

`src/modules/app/frozen-pins.js` is **pure bookkeeping**: it touches no DOM,
no canvas and no haptics. It tracks which slots are pinned, and it owns the
two *watchdogs* that decide when pins release themselves:

1. **Scene-change watchdog** (`checkSceneChange`). When you freeze, the
   module snapshots the current raw extraction as the "scene reference". It
   compares every new extraction to that reference by mean nearest-color
   distance, with two tiers:
   - A mean distance above **85** means an unmistakable scene swap, so every
     pin releases immediately (≤200 ms).
   - A mean distance above **58** for **3 consecutive extractions** means
     sustained drift (slow pan, reframe, autoexposure), so every pin releases
     as well.

   The comment in the file records the calibration: static-scene noise
   measures ≈ 8, and a full scene change measures ≈ 100.
2. **Per-pin presence watchdog** (`processPresence`). The worker measures
   what fraction of frame pixels still match each frozen color. If a pinned
   color's pixels vanish (you covered the object or walked away), that one
   pin releases after 2 consecutive misses. The threshold is *adaptive*: it
   is 25% of the best presence that pin ever measured, clamped. A small vivid
   object is therefore judged against its own normal.

### The presentation side

The live preview controller reacts to release lists. Released badges get a
**falling animation** from `buildFallingBadgeMarkers` in the marker model:
they hop up at −140 px/s, fall under a gravity of 1400 px/s², tumble off the
bottom and fade out. The live badge pops back in, and a haptic pattern fires
(`navigator.vibrate`, a no-op on iOS). The padlock hints
(`syncSwatchLockHints`) are plain DOM nodes in `#paletteLockOverlay`. They are
restyled on each frame change with the same numbering and ink-color logic as
the badges, so you can match each swatch to its badge at a glance.

Hit-testing works like this. A tap on the camera view meters exposure
(`exposure-ui.js`), so you set pins from the palette strip only. `app.js`
listens on the palette canvas and calls `togglePaletteSwatchFreezeAt(x)`,
which divides the x-coordinate by the swatch count and calls
`toggleSlotFreeze(slot)`. The badge hit-test (`toggleOriginFreezeAt`, through
`hitTestOriginMarkers`) is still exported, but nothing calls it.

---

## Chapter 6: Storage, four layers for four jobs

### Layer 1: localStorage, small and synchronous, one key per feature

Every key is namespaced and versioned. Here is the full inventory:

| Key | Owner | Contents |
|---|---|---|
| `paletcam:settings:v1` | `app-settings.js` | The whole settings object |
| `paletcam:community:session:v1` | `community-session.js` | Auth token + user for colorcatchers.co |
| `paletcam:community:publication-recovery:v1` | `community-service/publication.js` | Publishes in flight, so a lost server reply is reconciled later |
| `paletcam:account-deletion-cleanup-pending:v1` | `community-service/auth.js` | Local cleanup still owed after an account deletion |
| `paletcam:backup:credentials:v1` | `backup-credentials.js` | Backup server account id + secret (Layer 4) |
| `paletcam:stats:pending:local_capture` | `capture-stat-service.js` | Count of captures not yet reported |
| `paletcam:performance-hud-position:v1` | `performance-hud.js` | Where you dragged the HUD |
| `paletcam:grid:v1` | `camera-grid-ui.js` | Grid overlay on/off |
| `paletcam.footerLab.v2` | `footer-lab.js` | Footer variants picked in the debug lab |
| `pwa-install-dismissed` | `pwa-install.js` | You closed the install toast |

Two more keys live in sessionStorage: `paletcam:telemetry-correlation:v1`
(`client-log.js`) and `paletcam:metric:session-started:v1`
(`operational-metrics.js`). The old `paletcam:community:delete-cleanup-outbox:v1`
key is only read once, to migrate its entries into IndexedDB.

All these keys follow one rule: **every read goes through a normalizer** that
clamps, validates and falls back to defaults. Corrupt or stale JSON therefore
can't crash the app, and the next write repairs it.

### Layer 2: IndexedDB (Dexie), the palette collection

`src/palette-storage/` wraps a Dexie database called `PaletcamDB`.
`db.js` is the schema history. It holds nine versions, and the first three
tell the story:

- **v1**: one `palettes` table (`++id, timestamp`), photo blob inline.
- **v2**: adds community fields (`remoteCatchId`, `moderationStatus`,
  `postedAt`…) with an upgrade that backfills nulls.
- **v3** is the important one. It **splits photos out** into a
  `paletteAssets` table keyed by `paletteId`, so palette *metadata* (colors,
  timestamps, settings) and palette *assets* (the heavy WebP or JPEG blob)
  are now separate rows. The split exists because listing the collection
  reads every metadata row, and iOS Safari chokes when each row drags a
  multi-megabyte blob along. `getSavedPalettes()` does not touch blobs.
  Viewers hydrate them on demand through `assets.js`, which also lazily
  repairs any legacy inline-blob record it encounters.

The later versions add tables and indexes:

- **v4**: `palettePreviews` (rendered polaroid images, keyed by
  `[paletteId+variant]`) and `paletteStorageMetadata` (maintenance markers).
- **v5**: `communityDeleteOutbox` (Chapter 7).
- **v6**: `paletteImportStaging`, so an interrupted import does not leave half
  a collection.
- **v7**: a `remoteOwnerAccountKey` index (which account published a palette).
- **v8**: a `favoritedAt` index. The field holds an ISO string or `null`
  because IndexedDB rejects booleans as keys. As a result, the index lists
  only favourites.
- **v9**: the backup ledger (Layer 4): a unique `backupUid`, a
  `backupDirtyAt` index of palettes awaiting upload, and a `backupTombstones`
  table.

The rest of the folder:

- `records.js` holds the normalizers and constructors for both record types.
- `core.js` does the CRUD, always inside `db.transaction` so a palette and
  its asset can't get out of sync.
- `deletion.js` has `deletePalette`, which also queues remote cleanup and
  backup tombstones.
- `backup.js` and `json-transfer.js` export and import through the JSON
  worker.
- `import-staging.js` runs the staged import sessions.
- `backup-ledger.js` is the backup queue.
- `maintenance.js` does the startup cleanup.
- `database-lifecycle.js` handles blocked and version-change events, which
  `app.js` shows as toasts.
- `blob.js` converts between data URLs and Blobs.

### Layer 3: Cache Storage, the offline app shell

The service worker owns this layer entirely. Chapter 7 covers it.

### Layer 4: the backup server, a copy off the device

The browser, a cleaner app or the user can wipe origin storage, so palettes
also go to a private backup server: `services/sync-server/`, deployed at
ccbackup.ludique.dev. Several devices can share one account. The server does
not merge anything. Each device syncs through it with conditional writes.

- `src/backup-service.js` runs the sync pass. It reads the server manifest,
  pulls, sends the tombstones, then uploads dirty palettes in batches of 10.
  Photos are addressed by their SHA-256 (`crypto.subtle.digest`), so each
  photo uploads once. A pass runs 8 s after startup, every 5 minutes, a few
  seconds after a capture or a delete, and when you tap "Sync now".
- Each palette keeps the hash of the server document it last uploaded or
  applied (`backupRemoteHash`). An upload sends it as `If-Match`, or
  `If-None-Match: *` when the hash is unknown. On a 409 the newest change
  wins, compared on the `backupDirtyAt` stamp each document carries.
  Connecting a recovery code forgets every hash, so the first pass downloads
  what the account holds and uploads what it lacks.
- `src/backup-pull.js` applies what other devices changed. Clean palettes get
  the new favourite and publication state. New palettes are downloaded and
  committed 25 at a time through the staged import path, so an interrupted
  pass keeps the committed ones. Copies of one capture under two
  uids (one file imported on two devices) collapse to the lowest uid. A remote
  delete removes a local palette only if it is clean and the device saw its
  current server version. A pass that would delete more than 10 palettes and
  more than half the collection deletes nothing and logs
  `backup:pull-delete-guard`.
- `src/backup-credentials.js` keeps the recovery code in localStorage,
  `src/backup-api.js` is the HTTP layer, and `src/backup-ui.js` draws the
  backup section of the settings Data tab. Its Create online backup button
  calls `POST /v1/pair` and shows the new recovery code.

The same tab shows whether the browser granted persistent storage
(`inspectStorageHealth()` in `modules/storage-health.js`) and the date of the
last file export (the `lastBackupAt` setting).

---

## Chapter 7: Offline & the PWA machinery

### The service worker (`public/service-worker.js`)

The service worker is hand-written, ~265 lines, with no Workbox. It picks one
of three routing strategies by request type:

1. **Navigations** (`request.mode === "navigate"`) to the root or
   `index.html` get the cached `index.html` *immediately*, and the SW
   refreshes it from the network in the background. This is the "app shell"
   pattern, and it makes the app open instantly, even offline. Other
   navigations go network-first and fall back to the shell, but they do not
   overwrite it. With no cached shell and no network, `offline.html` (with
   its own tiny `offline.js`) is the last resort.
2. **Scripts, styles and workers** go cache-first, with a background
   revalidation that *bypasses the HTTP cache* (`cache: "no-store"`) so a
   deploy propagates.
3. **Everything else same-origin** (images, fonts, JSON) gets classic
   stale-while-revalidate, which this time *respects* the HTTP cache.

Strategies 2 and 3 apply only to URLs on the build's precache list. Any other
URL, and any URL with a query string, goes to the network uncached, so the
cache can't grow without bound.

The SW does not touch `api/` calls, the SW script itself, the precache
manifest or the web manifest (`BYPASS_CACHE_PATHS`). A stale copy of any of
those would be dangerous. Debug-only paths and requests made with
`cache: "no-store"` skip it too.

### How updates roll out

This is the part that usually feels magical, so here is the full chain:

1. `scripts/build.js` writes `precache-manifest.json` (the list of every
   built file) and inlines the same list into the service worker. The
   **build id** in `CACHE_NAME` is a SHA-256 of those files' paths and bytes
   (`scripts/build-id.js`), so a rebuild with identical output keeps its
   cache.
2. On **install**, the new SW pre-caches the required shell (`index.html`,
   `offline.html`, every JS and CSS file) as one transaction: a single
   failure deletes the new cache and fails the install. The SW caches fonts
   and icons on a best-effort basis. The new SW then *waits*, because install
   does not call `skipWaiting()`.
3. On **activate**, the SW deletes every `colorcatcher-` cache whose name
   isn't the current build id, then calls `clients.claim()`.
4. On the page side, `pwa-install.js` creates the registration with
   `updateViaCache: "none"`. It calls `registration.update()` every
   5 minutes *and* on focus, pageshow and visibilitychange, so a phone waking
   from standby checks for a new build right away.
5. When a new SW is waiting, `pwa-install.js` shows an "update ready" toast
   with an "Update now" action. The tap goes through
   `modules/service-worker-update-controller.js`. While a critical operation
   runs (`modules/critical-operation.js`: publication, palette deletion,
   restore, file export or import, account deletion), activation waits and a
   toast says so. Then the page posts `SKIP_WAITING` to the worker, and the
   `controllerchange` listener reloads once nothing critical is running. The
   user picks the moment the new version arrives.

In local dev, the opposite happens: any registered SW gets **unregistered**
on load, so caching can't fight the dev server.

### The install toast

`pwa-install.js` also intercepts and stashes the browser's
`beforeinstallprompt` event. After 3 seconds, a custom toast offers
installation. "Install" replays the stashed prompt. "×" writes
`pwa-install-dismissed`, so the toast does not come back.

### Offline-resilient side effects

Two features assume the network can vanish at any time. Both use the same
pattern: *persist the intent locally, then flush it on every plausible
occasion*.

- **Capture stats** (`capture-stat-service.js`): each save increments a
  pending counter in localStorage and tries to POST it. The flush retries on
  `online` and on the next capture. It is fire-and-forget, and failures stay
  silent.
- **The delete outbox** (`community-delete-outbox.js`): when you delete a
  palette locally that was published remotely, the app enqueues the remote
  cleanup in the IndexedDB table `communityDeleteOutbox`. The outbox flushes
  on startup, on `online`, when the tab becomes visible, and on login. Its
  entries carry attempt counts and leases, back off exponentially, and
  survive across sessions until they succeed. The same triggers reconcile
  the publication recovery journal.

---

## Chapter 8: The community layer (brief)

`src/community-service/` talks to `colorcatchers.co/api/v1` through two
files one level up: `src/community-api.js` is the raw HTTP layer, and
`src/config.js` builds the base URL from the build-time
`__COMMUNITY_BASE_URL__` (colorcatchers.co by default). On localhost, the app
calls that URL directly. The dev server still proxies `/api/v1`, but the app
doesn't go through it.

- **Session**: `community-session.js` keeps the token and user in
  localStorage and offers a subscribe API. Reads re-check storage, so
  multiple tabs stay coherent.
- **Publication** (`publication.js`): builds the payload (with the photo in
  base64), posts a "catch", then writes `remoteCatchId` and
  `moderationStatus` back into the palette's IndexedDB record. The local
  record is the source of truth for what's published.
- **Moderation sync** (`moderation-sync.js`): asks the server, with batched
  requests, for the current status of every published palette and reconciles
  local records (including remote deletions). The collection UI triggers it
  (`modules/collection/moderation-sync-controller.js`).
- Publication state drives the little status chip on collection cards
  (`palette-card.js`). That chip is the "publication badge", unrelated to the
  origin badges of Chapter 5.

---

## Chapter 9: Performance instrumentation

- **The HUD** (`src/modules/performance-hud.js`) is a Lit component that
  ships in debug builds only (dev and preprod). `performance-hud-bridge.js`
  loads it from `debug/performance-hud.js` when `__PALETCAM_DEBUG_TOOLS__` is
  set, and four taps on the version label in settings toggle it. You can drag
  it, and it remembers its position. The live preview loop calls
  `performanceHud.recordFrame({...})` every frame with real measurements:
  refresh duration, extraction duration (as the worker reports it), camera
  fps and analysis dimensions. The HUD adds its own sampling of FPS, long
  tasks (`PerformanceObserver`) and JS heap. It blends the numbers with an
  exponential moving average so they stay readable, and updates them 4×/s.
- **Client logging** (`src/modules/client-log.js` and `error-reporting.js`)
  sends timing and diagnostic events (the `clientLog(...)` calls you'll see
  sprinkled in the storage layer) and uncaught errors to the log server
  (cclogs.ludique.dev). The build injects the base URL through
  `__PALETCAM_LOG_API_BASE_URL__`. Every event must be declared in
  `services/log-server/src/telemetry-contract.js`, which the client and the
  server share. Unknown events and fields are dropped, and
  `src/modules/telemetry-contract-coverage.test.js` fails on an undeclared
  `clientLog` call. `modules/operational-metrics.js` sends sampled
  `metric:*` events (worker fallback, service-worker updates, camera start)
  through the same path.

---

## Chapter 10: Build & dev tooling

- **Dev** (`scripts/dev-server.js`): a Bun server on **:3000** serves
  `public/` and bundles `src/` on the fly, with no bundler watch process. It
  proxies `/api/v1` to colorcatchers.co and applies the same security
  headers as production (`security-headers.js`).
- **Build** (`scripts/build.js`): `Bun.build` minifies the four entry points
  and the two workers (preprod also gets the HUD as
  `dist/debug/performance-hud.js`), and copies `public/`. Then it stamps the
  app version and commit hash into every HTML and JS file (`__APP_VERSION__`,
  `__COMMIT_HASH__`), writes `precache-manifest.json` from the actual dist
  contents, hashes those files into the build id, and stamps the build id
  and the precache and required-shell lists into the service worker. It ends
  by writing `build-manifest.json` (version, commit, branch, build id).
  Build-time constants (`__COMMUNITY_BASE_URL__`, deploy branch, log and
  backup URLs, `__PALETCAM_DEBUG_TOOLS__`) are injected via `define`, which
  is why `config.js` reads bare globals.
- **Tests**: `bun run test` runs each `*.test.js` in an isolated process
  (`scripts/test-isolated.js`) so module-level state (settings store,
  session singletons) can't leak between files. Storage-dependent tests use
  hand-rolled localStorage mocks. Browser suites run on Playwright from
  `tests/` (`bun run test:e2e`, `test:pwa`, `test:performance`).
- **CSS** is token-driven (see `docs/css-architecture.md`), with the tokens in
  `public/styles/settings/tokens.css`. `bun run lint:css` rejects raw color
  values: every property with `color` in its name, plus `fill` and `stroke`,
  must use a variable.

---

## Chapter 11: Suggested reading order

To learn the code itself, read the files in this order. Each one makes the
next easier:

1. `src/app.js`, the wiring diagram.
2. `src/modules/app/live-preview-controller.js`, the loop that runs every
   frame.
3. `src/modules/palette-extraction-worker.js`, the worker contract.
4. `src/modules/app/frozen-pins.js`, small and pure, with comments that
   record its calibration.
5. `src/palette-storage/db.js` then `core.js`, the data model.
6. `public/service-worker.js` and `src/pwa-install.js`, the offline story.
7. `src/collection-ui.js`, the biggest file (2052 lines). By now, every
   import at its top will be familiar. It renders three views: grid, mosaic
   (`"swatch"` in the code) and spectrum. The bands and rings views still
   have rendering code, but their buttons carry `hidden` in `index.html` and
   `VALID_COLLECTION_VIEW_MODES` in `app-settings.js` leaves them out.

Afterward, test yourself with these questions:

- Why does the extraction worker *transfer* the frame instead of cloning it,
  and why is the queue only one deep?
- What exactly happens, step by step, between pushing a new commit and a
  user's phone running the new build?
- Why did schema v3 split `paletteAssets` out of `palettes`?
- Which two watchdogs can release a frozen pin, and why do they have
  different breach limits?

If you can answer all four, you know this codebase well enough to change it.
