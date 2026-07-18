# ADR 0002: Palette storage and migration compatibility

- Status: accepted
- Date: 2026-07-12

## Decision

IndexedDB `PaletcamDB` is authoritative for captures. The `palettes` table stores
metadata and regenerable previews; `paletteAssets` stores one master-photo Blob
per palette, keyed by `paletteId`. Every save, import, deletion, and clear that
touches both records uses one Dexie transaction. Schema upgrades are forward-only,
idempotent, and covered by fixtures for every historical version.

Collection reads remain read-only. Expensive backfills and provably safe orphan
cleanup run as explicit startup maintenance. Cleanup may delete an asset only
when no palette key exists; it must never infer deletion from age, quota, MIME,
`hasPhotoAsset`, or missing previews. Imports use a versioned, size-bounded,
allowlisted schema and write only after complete validation.

## Consequences

Master photos survive preview corruption and interrupted rendering. Rollback to
code that cannot read a newer schema is unsupported; deploy a forward fix.
Users should export a backup before support recommends clearing site data.

