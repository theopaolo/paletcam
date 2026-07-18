# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Production/preprod artifact boundaries, bounded offline caching, deterministic release provenance, and exact-artifact browser gates with enforced skip allowlists.
- Atomic, versioned palette metadata, master-photo, preview, maintenance-marker, and durable leased remote-cleanup outbox storage.
- Versioned, size-bounded palette backup import/export with image-container validation and transactional rollback.
- An exact SHA-256 manifest for the complete 216-image preprod reference corpus and a cardinality-enforced preprod PWA report.
- Bounded streaming reads across active and rotated daily log segments, plus persistent-volume readiness reporting for the log service.

### Changed

- Database schema advances to version 7. Versions 1–6 upgrade forward in bounded transactions; production rollback must use a forward fix rather than an older app that cannot open the newest schema.
- Backup schema remains version 2. Existing valid version-2 backups remain compatible; unsupported or unsafe files fail before writes.
- Incremental backup import/export now accepts a 768 MiB JSON file containing up to 512 MiB of decoded photos, allowing large photo collections without materializing the complete backup in memory.
- Legacy backups with up to 16 colors per palette can be restored without changing the current seven-color capture range.
- Debug pages and the full reference image corpus are preprod/dev-only and are never added to service-worker caches.
- Backup failures now provide separate invalid-file, conflict, interrupted, quota, database, serialization, integrity, and file-handoff recovery guidance with identifier-free metrics.
- The log-service container runs as the unprivileged `bun` user; production rejects the published example credentials and separately rate-limits authenticated dashboard routes.
- Client and server now share an exact telemetry event registry; raw URLs/user agents and unknown events or fields are excluded while a documented ephemeral UUIDv4 supports session-level reliability analysis.

### Fixed

- Camera, service-worker update, worker, publication, deletion, backup, and collection lifecycle races now have explicit ownership and recovery boundaries.
- Service-worker caching rejects query-bearing allowlisted variants, preventing unbounded cache-key growth.
- Backup workers and staged atomic commits terminate with the app lifetime; cancellation rolls back before live data becomes visible.
- Bulk collection deletion now uses a cancellable two-operation concurrency cap instead of launching every IndexedDB and remote-cleanup mutation at once.
- Error telemetry keeps free-form messages and stacks on-device and removes palette, remote-catch, user, and request identifiers at both client and log-service boundaries.
- Capture and collection controls stay disabled until their startup handlers and controllers are bound, preventing lost early taps.
- Community publication sends a CORS-verified operation idempotency key, and remote cleanup uses a cross-tab-safe leased IndexedDB outbox.
- Settings backup operations remain single-flight across locale remounts, malformed remote-cleanup jobs are discarded before API use, and local-data reset cannot race pending capture persistence.
- Corrupt authoritative palette metadata is isolated without deleting user data, and a real interrupted IndexedDB upgrade now proves transaction rollback and clean retry.
- Log-service startup now verifies an exclusive write, fsync, close, and cleanup in `LOG_DIR`; readiness continues probing without exposing filesystem work to public health requests.
- Settings backup errors use the defined high-contrast danger color instead of falling back to unreadable inherited text.

### Known limitations

- Physical iOS Safari/PWA and Android Chrome/PWA validation, including low-memory backup import and camera background recovery, remains required before promotion.
- Blob backups now stream within a 768 MiB file, 512 MiB cumulative decoded-photo, 32 MiB per-entry, and 16 MiB per-photo contract; whole-string compatibility remains capped at 32 MiB.
- Exactly-once publication still requires the community backend to enforce the transmitted idempotency key.
- Deployed observability/operations sign-off and manual exact-artifact browser smoke remain required before promotion.

## [0.1.0] - 2026-07-11

- Initial audited preproduction baseline.
