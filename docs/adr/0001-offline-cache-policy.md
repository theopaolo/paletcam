# ADR 0001: Offline and cache policy

- Status: accepted
- Date: 2026-07-12

## Decision

Paletcam uses one build-addressed service-worker cache. `index.html` and
`offline.html` are mandatory installation assets; optional immutable shell
assets may fail without rejecting installation. Navigation is app-shell-first,
scripts/styles/workers are cache-first with revalidation, and other same-origin
GET resources are stale-while-revalidate. API, manifest, service-worker metadata,
`no-store` requests, debug pages, every `__*` harness, and `assets/img/**` always
bypass runtime caching.

Production builds omit debug pages, the full reference-image corpus, source
maps, and filesystem metadata. Preprod retains debug material for development,
but the same cache exclusion applies there. Activation removes older Paletcam
caches. Required-shell failure prevents an incomplete worker from activating.

## Consequences

The installed camera shell remains usable offline and updates atomically. Debug
data cannot consume user cache storage or leak into production artifacts. This
assumes SPA navigation; route-specific server HTML would require a new strategy.

