# ADR 0001: Offline and cache policy

- Status: accepted
- Date: 2026-07-12

## Decision

Paletcam uses one build-addressed service-worker cache, named
`colorcatcher-<build id>`. `index.html`, `offline.html`, and every emitted `.js`
and `.css` file are mandatory installation assets (`collectRequiredShellUrls` in
`scripts/build.js`). Fonts, icons, and branding are optional and may fail
without rejecting installation. Root and `index.html` navigations are
app-shell-first. Other navigations try the network first, then fall back to the
cached shell and `offline.html`, and do not overwrite the shell.
Scripts/styles/workers are cache-first with revalidation, and other GET
resources listed in `precache-manifest.json` are stale-while-revalidate.
Requests outside that manifest, or with a query string, stay network-only
(`public/service-worker.js`). API, manifest, service-worker metadata,
`no-store` requests, debug pages, every `__*` harness, and `assets/img/**` always
bypass runtime caching.

Production builds omit debug pages, the full reference-image corpus, source
maps, and filesystem metadata. Preprod retains debug material for development,
but the same cache exclusion applies there. Activation removes older
`colorcatcher-` caches. Required-shell failure prevents an incomplete worker from activating.

## Consequences

The installed camera shell remains usable offline and updates atomically. Debug
data cannot consume user cache storage or leak into production artifacts. This
assumes SPA navigation; route-specific server HTML would require a new strategy.

