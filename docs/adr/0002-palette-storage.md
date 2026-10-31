# ADR 0002: Palette storage and migration compatibility

- Status: accepted
- Date: 2026-07-12
- Partly superseded on 2026-07-13 by [ADR 0007](0007-preview-assets-and-versioned-maintenance.md):
  previews moved to `palettePreviews` and normal startup no longer runs orphan
  cleanup (code in 4d85a5f).

## Decision

IndexedDB `PaletcamDB` is the primary working store for captures. Since
2026-08-16 the private backup server in `services/sync-server/` keeps a copy of
each palette for restore (backup in b8ba54d, restore in a7d2e45). It is a
backup target, not a sync peer. The `palettes` table stores
metadata and regenerable previews; `paletteAssets` stores one master-photo Blob
per palette, keyed by `paletteId`. Every save, import, deletion, and clear that
touches both records uses one Dexie transaction. The schema in
`src/palette-storage/db.js` runs from version 1 to 9. Schema upgrades are forward-only,
idempotent, and covered by fixtures for every historical version.

Collection reads remain read-only. Expensive backfills and provably safe orphan
cleanup run as explicit startup maintenance. Cleanup may delete an asset only
when no palette key exists; it must never infer deletion from age, quota, MIME,
`hasPhotoAsset`, or missing previews. Imports use a versioned, size-bounded,
allowlisted schema (export version 2, limits in
`src/palette-storage/json-transfer.js`). Validated batches land in
`paletteImportStaging` and reach `palettes` and `paletteAssets` in one
transaction once the whole file is staged (`commitImportSession` in
`src/palette-storage/import-staging.js`). Server restores use the same staged
import.

## Consequences

Master photos survive preview corruption and interrupted rendering. Rollback to
code that cannot read a newer schema is unsupported; deploy a forward fix.
Users should export a backup before support recommends clearing site data.

