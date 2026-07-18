# ADR 0007: Isolate preview assets and version startup maintenance

- Status: accepted
- Date: 2026-07-13
- Supersedes: ADR 0002 where it places regenerable previews in `palettes`

## Context

IndexedDB structured-clones complete records before application normalization can
discard fields. Keeping gallery and viewer preview Blobs in `palettes` therefore
makes a metadata listing deserialize every saved preview. Keeping previews in the
master-photo row would similarly make a thumbnail read deserialize unrelated
large assets. Startup maintenance also cannot scan the full palette table on
every page load as collections grow.

## Decision

`PaletcamDB` version 4 separates the three storage concerns:

- `palettes` contains normalized capture and community metadata only.
- `paletteAssets` contains the authoritative master photo keyed by `paletteId`.
- `palettePreviews` contains one regenerable Blob per `[paletteId+variant]`, where
  variant is `gallery` or `viewer`; its fingerprint label travels with the Blob.
- `paletteStorageMetadata` contains durable maintenance completion records.

The version-4 upgrade enumerates palette keys without loading Blobs, then reads
and migrates bounded batches. It copies current and legacy preview variants,
scrubs all preview fields from metadata, and removes assets whose `paletteId` is
not reachable. The upgrade is one Dexie transaction: failure leaves version 3
intact and retryable.

Collection listings remain metadata-only. Gallery and viewer previews hydrate on
demand through variant-keyed reads and bounded UI queues. New saves/imports never
embed previews in metadata. Save, delete, and clear operations include every
affected store in one transaction. Backups continue to omit derived previews,
using them only as a recovery source when the master photo is unexpectedly
missing.

Runtime-dependent legacy render settings are backfilled once. A completed marker
is checked and written in the same IndexedDB transaction as the backfill; an
aborted transaction writes no marker and must retry. Normal startup does not run
orphan scans after version-4 migration. Explicit repair tooling may still perform
key-only orphan cleanup.

## Consequences

Initial collection reads no longer clone image Blobs, and gallery hydration does
not load the master photo or viewer preview. Migration uses temporary memory
proportional to its fixed batch size rather than the collection size.

Rollback to code that writes previews into `palettes` remains unsupported after
version 4. Production recovery uses a forward fix; support should request a user
backup before any site-data reset.
