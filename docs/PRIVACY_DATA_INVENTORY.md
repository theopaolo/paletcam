# Paletcam privacy and data inventory

This engineering inventory supports—not replaces—jurisdiction-specific legal
review and the public privacy notice.

| Data | Location / destination | Purpose | Default lifetime / deletion |
| --- | --- | --- | --- |
| Live camera frames | Device memory and canvas | Palette extraction and capture | Replaced continuously; not sent by extraction |
| Master captured photo | Local IndexedDB | Saved capture, export, share, optional publish | Until user deletes capture or flushes local data |
| Gallery/viewer previews | Local IndexedDB | Faster collection/viewer display | Deleted with capture/local flush; regenerable |
| Palette colors and capture metadata | Local IndexedDB | Collection and rendering | Deleted with capture/local flush |
| Provisional imported photos and palette records | Local IndexedDB (`paletteImportStaging`) | Validate a complete backup before one atomic commit | Removed after commit/failed import/local flush; stale crash residue is reclaimed after the bounded lease expires |
| App settings | Local storage | User preferences | Until local flush/site-data deletion |
| Community token, email, user ID, and display name | Local storage | Authenticated community actions and account display | Until logout, account deletion, or local flush |
| Remote cleanup outbox (hashed account key, remote catch ID, retry/lease metadata) | Local IndexedDB (`communityDeleteOutbox`); legacy local-storage entries are migrated once | Retry failed unpublish cleanup without retaining raw account credentials | Removed after success or local flush; the legacy local-storage key is removed after migration |
| Publication recovery operation key and remote catch state | Local storage | Reconcile a remote publication when local state persistence and compensating unpublish both fail | Bounded to 20 entries; removed after reconciliation or local flush |
| Published photo/colors/metadata | Community API | User-requested public/community publishing | Governed by community service; unpublish/account deletion flows |
| Capture count | Local-storage pending counter and Community stats API | Aggregate product usage | Local count remains until acknowledged or local flush; server policy applies |
| Sanitized client telemetry | Log API JSONL | Reliability and incident response | 30 days by default; configurable |
| Client telemetry correlation ID | Session storage and sanitized log context | Group operational events within one tab session | Removed when the tab session ends locally; server copy follows telemetry retention |
| Request correlation ID | Request header/log context | Trace one failing request | Same retention as relevant server log |
| IP address, origin, coarse browser family | Log service | Abuse control and diagnostics | 30 days by default; raw user-agent strings and app URLs are not sent by the client |

## Data-minimization invariants

- Extraction runs locally. Camera frames and local photo blobs must never enter
  client telemetry, error context, query strings, or capture-stat requests.
- Telemetry accepts only registered event names and per-event fields; keeps
  free-form error messages, filenames, stacks, URLs, and raw user-agent strings
  on-device; drops palette, remote-catch, user, and request identifiers;
  recursively redacts credential-like keys; truncates strings/collections/depth;
  and bounds request bodies. The disclosed ephemeral UUIDv4 tab correlation ID
  is the sole identifier exception.
- Mutating community requests are user-initiated and are not automatically
  replayed without a dedicated outbox/idempotency contract.
- Capture-count delivery is best-effort at-least-once. A successful request
  followed by a crash before the acknowledged local count is removed can replay
  that batch, so server-side reporting must tolerate occasional duplicates.
- Debug/reference imagery exists only in development/preprod and never enters an
  app/service-worker cache.
- Production source maps are not publicly deployed.

## User controls

Users can delete individual local captures, export/import a backup, flush local
Paletcam data, log out, unpublish community captures, and request account
deletion. Product copy must distinguish local deletion, remote unpublish, and
remote account deletion; they are not equivalent operations.

Before support recommends clearing browser/PWA site data, instruct the user to
export a backup. Site-data deletion removes local photos and cannot be undone by
Paletcam unless the user retained a backup.

## Access and disclosure

Dashboard/log access is limited to operators with a support or incident need.
Do not export raw logs to general collaboration tools. If a sample is required,
remove IP, email, tokens, full URLs, and unique identifiers unless specifically
necessary and approved under the applicable privacy process.
