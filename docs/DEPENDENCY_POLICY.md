# Dependency and supply-chain policy

## Package-managed dependencies

JavaScript dependencies are declared in `package.json` and locked by `bun.lock`.
Most use caret ranges. Bun (`packageManager` and `engines`), `@types/bun` and
`typescript` are pinned to exact versions. CI installs with
`bun install --frozen-lockfile` on Bun 1.3.11 and pins each GitHub Action to a
commit SHA. `bun.lock` is the only lockfile, and `.gitignore` keeps a stray
`package-lock.json` out of the repo.

Dependabot opens weekly updates for the root npm dependencies (grouped into
development and production), GitHub Actions, and the log-server's npm
dependencies and Dockerfile.

Every update must pass `bun run verify`, `bun run test:e2e`, `bun run test:pwa`,
and `bun run test:performance`. Review release notes for breaking behavior,
security advisories, license changes, browser-support changes, and bundle growth.
Do not merge an update that regenerates the lockfile without explaining why.
The log-server and sync-server containers use the versioned
`oven/bun:1.3.11-alpine` base, pinned to the Docker Hub multi-architecture index
digest recorded in each Dockerfile. Each service has its own frozen production
lockfile, and both depend only on `hono`. When Dependabot proposes a base
update, verify the tag and index digest against the official registry metadata
before merging both values together. Dependabot and CI cover only the
log-server, so sync-server updates are manual. Do not restore floating major
tags, a tag without its digest, or a non-frozen fallback install in Docker
builds.

## Vendored Dexie

`src/vendor/dexie.mjs` is Dexie 4.3.0, dated 2025-12-20. Its source header
records the upstream project and Apache License 2.0. Exact provenance lives in
`src/vendor/dexie.provenance.json`: the canonical npm archive URL, path inside
that archive, version, license, and SHA-256 of the vendored browser module. CI
recomputes the checksum and rejects metadata/header drift.
`src/palette-storage/db.js` imports it by relative path, and `Bun.build` bundles
it with the app in dev and production.

At least quarterly, and before a production release older than one quarter:

1. Compare the vendored version with the current Dexie release and advisories.
2. Download the recorded upstream archive, extract the recorded artifact path,
   and confirm its license header before replacing the file.
3. Record the old/new version in the changelog.
4. Update the provenance version, URL, archive path, and SHA-256 in the same
   change; run `bun run scripts/verify-vendored-dependencies.js`.
5. Run migration, storage, browser, PWA, and backup round-trip tests.
6. Inspect the production artifact budget after the update.

No manual edits should be made inside the vendored Dexie file. Application-level
workarounds belong in `src/palette-storage/` and require regression tests.
