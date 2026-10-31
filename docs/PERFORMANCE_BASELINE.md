# Paletcam mobile performance baseline

Date: 2026-10-31

## Synthetic profile

The CI profile uses the production artifact in Chromium with a Pixel 5 viewport,
service workers disabled for a cold load, 4x CPU slowdown, 40 ms network latency,
200 KiB/s download throughput, and 100 KiB/s upload throughput. Camera permission
is deterministically denied so device availability does not distort startup.

This profile is a stable regression test, not a claim about all phones.

## Enforced budgets

| Metric | Budget |
| --- | ---: |
| Production artifact | 2 MiB |
| Precache | 2 MiB / 150 entries |
| Initial JavaScript | 700 KiB |
| CSS | 150 KiB |
| Fonts | 250 KiB |
| App usable | 10,000 ms |
| DOM content loaded | 8,000 ms |
| Window load | 10,000 ms |
| Maximum long task | 1,000 ms |
| Total long tasks | 2,500 ms |
| Extraction p95, 320x240 | 1,000 ms |
| 250-capture initial render | 1,500 ms |
| 250-capture full hydration | 7,000 ms |
| Capture to durable save, synthetic photo | 2,000 ms |
| Synthetic camera ready | 10,000 ms |
| Preview RAF interval p95 | 100 ms |
| First viewer open, photo-backed capture | 4,000 ms |
| One-photo backup export | 1,000 ms |
| One-photo backup import | 2,000 ms |
| One-photo backup round trip | 3,000 ms |
| 1,000-photo generated backup import | 10,000 ms |
| 1,000-photo import maximum event-loop gap | 500 ms |
| Service-worker initial control | 15,000 ms |
| Immutable update install | 5,000 ms |
| Immutable update activation/cache cleanup | 5,000 ms |

Authoritative thresholds live in `scripts/performance-budgets.js`.
`scripts/verify-build.js` checks the artifact rows and
`tests/performance/startup.spec.js` checks the runtime rows.

## Running the suite

```sh
PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev bun run build:production
bun run verify:build
PLAYWRIGHT_REUSE_DIST=1 bun run test:performance
```

Without `PLAYWRIGHT_REUSE_DIST=1`, `test:performance` builds the artifact
itself and refuses to start unless `PALETCAM_LOG_API_BASE_URL` is set.
`verify:build` prints the artifact sizes. Each Playwright test logs its metrics
to the console and attaches them as JSON. The three tests take about 35 seconds.

## Measured baseline, 2026-10-31

Commit `ecac24d`, `pwa/prod` build, Apple M5 host. The 4x CPU slowdown applies
to the host CPU, so a slower machine reports higher timings. Runtime figures are
the median and range of three suite runs.

### Artifact

| Metric | Measured | Budget |
| --- | ---: | ---: |
| Production artifact | 1,274,556 bytes / 110 files | 2 MiB |
| Precache | 1,256,288 bytes / 106 entries | 2 MiB / 150 entries |
| Initial JavaScript | 515,085 bytes | 700 KiB |
| CSS | 153,992 bytes | 150 KiB (153,600 bytes) |
| Fonts shipped | 217,172 bytes | 250 KiB |
| Fonts fetched at startup, decoded | 146,012 bytes | none |

CSS is 392 bytes over budget. `bun run verify:build` fails on this commit, and
so do `bun run verify` and the CI `verify:release` job, which both run it.

### Startup

| Metric | Median | Range | Budget |
| --- | ---: | ---: | ---: |
| App usable | 5,087 ms | 5,072–5,130 ms | 10,000 ms |
| DOM content loaded | 4,919 ms | 4,914–4,976 ms | 8,000 ms |
| Window load | 5,005 ms | 4,997–5,053 ms | 10,000 ms |
| Long tasks | 2 | 1–3 | none |
| Maximum long task | 141 ms | 140–192 ms | 1,000 ms |
| Total long tasks | 257 ms | 141–386 ms | 2,500 ms |
| Extraction p50, 320x240 | 1.40 ms | 1.39–1.83 ms | none |
| Extraction p95, 320x240 | 2.73 ms | 2.70–4.13 ms | 1,000 ms |
| 250-capture initial render | 984 ms | 978–997 ms | 1,500 ms |
| 250-capture full hydration | 1,050 ms | 1,047–1,069 ms | 7,000 ms |

### Critical journeys

| Metric | Median | Range | Budget |
| --- | ---: | ---: | ---: |
| Synthetic camera ready | 5,090 ms | 5,082–5,091 ms | 10,000 ms |
| Preview RAF interval p95 | 9.13 ms | 9.07–9.27 ms | 100 ms |
| Capture to durable save | 186 ms | 177–195 ms | 2,000 ms |
| First viewer open with usable preview | 326 ms | 322–328 ms | 4,000 ms |
| Backup export | 116 ms | 114–189 ms | 1,000 ms |
| Backup import | 253 ms | 215–287 ms | 2,000 ms |
| Backup export/clear/import round trip | 450 ms | 435–457 ms | 3,000 ms |
| 1,000-photo generated backup import | 2,968 ms | 2,956–2,979 ms | 10,000 ms |
| 1,000-photo import maximum event-loop gap | 94.0 ms | 93.4–102.5 ms | 500 ms |

### Service worker

| Metric | Median | Range | Budget |
| --- | ---: | ---: | ---: |
| Initial install to controlled page | 5,158 ms | 5,155–5,159 ms | 15,000 ms |
| Artifact-B install to waiting | 407 ms | 150–408 ms | 5,000 ms |
| Activation plus artifact-A cache cleanup | 1,929 ms | 1,928–1,934 ms | 5,000 ms |

## What the profile covers

The critical-journey test runs one real synthetic capture with photo
persistence, the first lazy viewer open, and export/clear/import of that
photo-backed backup.

The same test generates a 1,000-palette, 1,000-photo schema-v2 backup entirely
in memory. It uses a deterministic one-pixel PNG, so no user photos or large
fixture are stored in the repository. The 337,306-byte `File` passes through the
production file-input, Blob worker parser, acknowledged two-entry worker
batches, durable staging store, and atomic commit. A 10 ms main-thread sampler
counts responsive ticks during the import (287–288 on 2026-10-31). The test
checks that the final database contains exactly 1,000 metadata and asset
records and zero provisional staging rows.

This high-cardinality case complements direct deterministic tests proving that
the worker does not acknowledge a batch until its staging callback settles,
that a failed callback receives a negative acknowledgement, and that an abort
during commit rolls back every live-store write. It exercises bounded streaming
and staging behavior without committing a private or artificially huge fixture.

The collection figures depend on progressive card mounting in
`src/modules/collection/render-groups.js`. The default grid view mounts the
first 12 cards of each date group, then 48 per idle callback. The swatch view mounts 24,
then 72. The camera shell loads without collection code.
`src/collection-ui.js` loads with a dynamic import when the collection opens,
and it loads the viewer, verso, and color-name modules in their own chunks.

Stable CI measurements currently cover startup, long tasks, extraction, a
250-card collection, camera readiness/preview cadence, capture-to-save, first
viewer open, one-photo backup export/import, a generated 1,000-photo streaming
import with event-loop responsiveness, and coherent service-worker
install/update/cache cleanup. Maximum-byte backup timing and peak memory remain
physical/field measurement work rather than synthetic CI claims.
