# Dependency and supply-chain policy

## Package-managed dependencies

JavaScript dependencies are declared in `package.json` and locked by `bun.lock`.
CI installs them with `bun install --frozen-lockfile` on Bun 1.3.11. Dependabot
opens weekly grouped updates for Bun/npm dependencies and GitHub Actions.

Every update must pass `bun run verify`, `bun run test:e2e`, `bun run test:pwa`,
and `bun run test:performance`. Review release notes for breaking behavior,
security advisories, license changes, browser-support changes, and bundle growth.
Do not merge an update that regenerates the lockfile without explaining why.
The log-server container uses the versioned `oven/bun:1.3.11-alpine` base,
pinned to the Docker Hub multi-architecture index digest recorded in the
Dockerfile, and its own frozen production lockfile. When Dependabot proposes a
base update, verify the tag and index digest against the official registry
metadata before merging both values together. Dependabot monitors the
Dockerfile weekly. Do not restore floating major tags, a tag without its digest,
or a non-frozen fallback install in Docker builds.

## Vendored Dexie

`src/vendor/dexie.mjs` is Dexie 4.3.0, dated 2025-12-20. Its source header
records the upstream project and Apache License 2.0. Exact provenance lives in
`src/vendor/dexie.provenance.json`: the canonical npm archive URL, path inside
that archive, version, license, and SHA-256 of the vendored browser module. CI
recomputes the checksum and rejects metadata/header drift. It is deliberately
vendored because the app imports it directly in the browser without a runtime
package loader.

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
