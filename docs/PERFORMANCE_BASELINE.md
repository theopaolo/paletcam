# Paletcam mobile performance baseline

Date: 2026-07-17

## Synthetic profile

The CI profile uses the production artifact in Chromium with a Pixel 5 viewport,
service workers disabled for a cold load, 4x CPU slowdown, 40 ms network latency,
200 KiB/s download throughput, and 100 KiB/s upload throughput. Camera permission
is deterministically denied so device availability does not distort startup.

This profile is a stable regression test, not a claim about all phones. Release
sign-off still records p50/p95 on physical supported devices.

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

Authoritative thresholds live in `scripts/performance-budgets.js` and are used by
both artifact verification and the Playwright performance profile.

## Latest measured clean-commit baseline

Artifact and runtime figures below came from the reproducible clean local commit
on 2026-07-18. The exact-artifact UI, PWA, and performance gates pass, but these
figures are not promotion evidence until the same commit passes CI.

After removing production source maps, filesystem metadata, unused font families,
legacy WOFF duplicates, and unused font weights:

| Metric | Measured |
| --- | ---: |
| Production artifact | 1,154,861 bytes / 103 files |
| Precache | 1,137,095 bytes / 99 entries |
| Initial JavaScript | 456,068 bytes |
| CSS | 119,798 bytes |
| Fonts shipped | 217,172 bytes |
| Fonts decoded | 146,012 bytes |
| App usable | 4,482.370 ms |
| DOM content loaded | 4,337.005 ms |
| Window load | 4,370.120 ms |
| Long tasks | 1 |
| Maximum long task | 137 ms |
| Total long tasks | 137 ms |
| Extraction p50 | 1.590 ms |
| Extraction p95 | 2.750 ms |
| 250-capture initial render, after progressive hydration | 1,009.730 ms |
| 250-capture full hydration, after progressive hydration | 1,080.995 ms |

The exact production artifact now also runs a second throttled mobile profile
covering one real synthetic capture/photo persistence, the first lazy viewer
open, and export/clear/import of that photo-backed backup. Four repeated samples
were tightly clustered:

| Critical journey | Median | Observed range | Budget |
| --- | ---: | ---: | ---: |
| Synthetic camera ready | 4,438.78 ms | 4,405.92–4,447.23 ms | 10,000 ms |
| Preview RAF interval p95 | 9.99 ms | 9.72–10.07 ms | 100 ms |
| Capture to durable save | 188.48 ms | 172.78–200.93 ms | 2,000 ms |
| First viewer open with usable preview | 1,445.83 ms | 1,440.06–1,449.14 ms | 4,000 ms |
| Backup export | 107.66 ms | 104.22–109.30 ms | 1,000 ms |
| Backup import | 200.59 ms | 193.09–203.89 ms | 2,000 ms |
| Backup export/clear/import round trip | 353.10 ms | 346.60–353.56 ms | 3,000 ms |

The same exact-artifact journey now generates a 1,000-palette, 1,000-photo
schema-v2 backup entirely in memory. It uses a deterministic one-pixel PNG, so
no user photos or large fixture are stored in the repository. The 337,306-byte
`File` passes through the production file-input, Blob worker parser,
acknowledged two-entry worker batches, durable staging store, and atomic commit.
Three focused/exact-release runs imported all 1,000 palettes in
1,974.86–2,064.30 ms under the 4x CPU profile. A 10 ms main-thread sampler
recorded 193–202 responsive ticks and a 53.70–56.65 ms maximum gap. The final
database contained exactly 1,000 metadata and asset records and zero provisional
staging rows. CI enforces conservative 10,000 ms import and 500 ms maximum-gap
ceilings.

This high-cardinality case complements direct deterministic tests proving that
the worker does not acknowledge a batch until its staging callback settles,
that a failed callback receives a negative acknowledgement, and that an abort
during commit rolls back every live-store write. It exercises bounded streaming
and staging behavior without committing a private or artificially huge fixture.

The current reproducible artifact's release run remained within every budget:
camera ready 4,470.385 ms, preview RAF p95 10.265 ms, capture-to-save
177.305 ms, first viewer open 314.210 ms, backup export 85.555 ms, import
223.785 ms, and round trip 350.350 ms. Its generated 1,000-photo import took
3,347.165 ms with a 105.950 ms maximum event-loop gap and 326 responsiveness
ticks.

These conservative ceilings protect interaction-scale regressions for the fixed
one-photo fixture. They do not replace physical peak-memory and maximum-backup
evidence.

The coherent A-to-B fixture also produced four stable service-worker samples:

| Service-worker journey | Median | Observed range | Budget |
| --- | ---: | ---: | ---: |
| Initial install to controlled page | 4,497.57 ms | 4,471.05–4,512.88 ms | 15,000 ms |
| Artifact-B install to waiting | 418.76 ms | 415.99–421.10 ms | 5,000 ms |
| Activation plus artifact-A cache cleanup | 1,926.03 ms | 1,921.45–1,928.94 ms | 5,000 ms |

The current artifact measured 4,530.670 ms to initial control, 413.490 ms to
install artifact B as waiting, and 1,927.840 ms for activation plus artifact-A
cache cleanup.

The large same-day collection result justified progressive card hydration. The
first batch is bounded by view mode (3 list, 12 grid, 24 swatch), followed by
larger idle-time batches (24/48/72). Unit coverage proves that all cards are
eventually mounted and no cards are dropped. The trace also exposed a permission-
denial toast intercepting the camera action dock for its full 4.2-second lifetime;
toasts now render above the dock. The authoritative runtime profile passes both
initial-content and full-hydration budgets.

The production graph now lazily loads collection/community/viewer/backup work
after the camera shell. The first split measured 1,473 ms to first collection
content because viewer, verso, and offline color-name code shared that chunk.
Secondary lazy boundaries reduced it to 463 ms while the PWA suite proves the
collection remains available after an offline reload.

The verified production build contains 103 files. Its exact reproducible hash
is generated in `release-reports/performance.json`; it is intentionally not
hardcoded here because the artifact identity includes the promotion commit.

Stable CI measurements currently cover startup, long tasks, extraction, a
250-card collection, camera readiness/preview cadence, capture-to-save, first
viewer open, one-photo backup export/import, a generated 1,000-photo streaming
import with event-loop responsiveness, and coherent service-worker
install/update/cache cleanup. Maximum-byte backup timing and peak memory remain
physical/field measurement work rather than synthetic CI claims.

## Physical-device release sample

For each supported iPhone/Android tier, record at least five cold sessions and a
250-capture fixture. Report median and p95 for camera readiness, extraction,
capture-to-save, collection first content, collection full hydration, and backup
export. Also record peak observed memory, thermal warnings, browser version,
device model, OS version, and whether the PWA was installed or browser-hosted.
