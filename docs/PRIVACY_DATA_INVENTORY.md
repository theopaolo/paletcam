# Paletcam privacy and data inventory

This engineering inventory supports jurisdiction-specific legal review and the
public privacy notice. It does not replace them.

| Data | Location / destination | Purpose | Default lifetime / deletion |
| --- | --- | --- | --- |
| Live camera frames | Device memory and canvas | Palette extraction and capture | Replaced continuously; not sent by extraction |
| Master captured photo | Local IndexedDB (`paletteAssets`) | Saved capture, export, share, optional publish and online backup | Until user deletes capture or flushes local data |
| Gallery/viewer previews | Local IndexedDB (`palettePreviews`) | Faster collection/viewer display | Deleted with capture/local flush; regenerable |
| Palette colors and capture metadata (capture time, crop, render settings, favourite date, publication state) | Local IndexedDB (`palettes`) | Collection and rendering | Deleted with capture/local flush |
| Backup ledger: a random `backupUid` per palette with dirty and uploaded stamps, plus `backupTombstones` (uid and deletion time of each locally deleted palette) | Local IndexedDB (`palettes`, `backupTombstones`) | Upload only changed palettes and pass local deletions to the backup server | Ledger fields go with their capture. A tombstone is removed once the server accepts it. Local flush does not clear `backupTombstones`. Delete online backup marks every palette as awaiting upload and clears `backupTombstones` |
| Provisional imported photos and palette records | Local IndexedDB (`paletteImportStaging`) | Validate a complete backup before one atomic commit | Removed after commit/failed import/local flush; stale crash residue is reclaimed after the bounded lease expires |
| App settings, camera grid, performance HUD position, install-prompt dismissal | Local storage (`paletcam:settings:v1`, `paletcam:grid:v1`, `paletcam:performance-hud-position:v1`, `pwa-install-dismissed`) | User preferences | Until local flush/site-data deletion |
| Footer variant picks | Local storage (`paletcam.footerLab.v2`), written only by the debug-build switches | Preprod footer tests | Until site-data deletion. Local flush skips this key because local-data-reset.js only matches the `paletcam:` prefix |
| Community token, email, user ID, and display name | Local storage | Authenticated community actions and account display | Until logout, account deletion, or local flush |
| Account-deletion cleanup marker (hashed account keys) | Local storage (`paletcam:account-deletion-cleanup-pending:v1`) | Finish clearing local publication metadata after a remote account deletion | Removed after cleanup or local flush |
| Backup recovery code (account ID and secret) | Local storage (`paletcam:backup:credentials:v1`), and the clipboard after Copy code | Authenticate backup uploads and restores | Until Disconnect, Delete online backup, or local flush. The server stores only the SHA-256 of the secret |
| Backed-up palettes: the palette metadata record without its local id (colors, capture time and crop, favourite date, publication state including remote catch ID and hashed account key, `backupUid`) and the master photo | Backup server (`services/sync-server`, ccbackup.ludique.dev), one directory per account on a persistent volume | User-connected backup and restore after a device wipe | The server keeps the last 5 versions of each metadata document. A local delete becomes a tombstone, and the daily sweep purges it after 30 days (`TOMBSTONE_RETENTION_DAYS`) along with photos no other palette references. Disconnect and local flush leave the server copy in place. Delete online backup (`DELETE /v1/account`) removes the account directory with every version, tombstone and photo at once |
| Backup account record (account ID, secret hash, creation time) | Backup server (`account.json`) | Verify the bearer credentials | Until the user deletes the online backup or the operator deletes the account directory |
| Remote cleanup outbox (hashed account key, remote catch ID, retry/lease metadata) | Local IndexedDB (`communityDeleteOutbox`); legacy local-storage entries are migrated once | Retry failed unpublish cleanup without retaining raw account credentials | Removed after success or local flush; the legacy local-storage key is removed after migration |
| Publication recovery operation key and remote catch state | Local storage | Reconcile a remote publication when local state persistence and compensating unpublish both fail | Bounded to 20 entries; removed after reconciliation or local flush |
| Published master photo, colors, capture time, aspect ratio, and crop | Community API (colorcatchers.co `/catch/publish`) | User-requested public/community publishing | Governed by community service. The remote controls are unpublish (`/catch/:id/unpublish`) and account deletion (`DELETE /account` with a confirmation code). The app has no call that deletes a single remote catch |
| Capture count | Local-storage pending counter and Community stats API | Aggregate product usage | Local count remains until acknowledged or local flush; server policy applies |
| Sanitized client telemetry: event name, per-event fields from `services/log-server/src/telemetry-contract.js`, app version, commit, environment, client family, correlation ID, timestamp | Log API (`cclogs.ludique.dev/clientlog`, one POST per event), stored as JSONL | Reliability and incident response | 30 days by default (`LOG_RETENTION_DAYS`) |
| Client telemetry correlation ID | Session storage and sanitized log context | Group operational events within one tab session | Removed when the tab session ends locally; server copy follows telemetry retention |
| Request correlation ID | Request header/log context | Trace one failing request | Same retention as relevant server log |
| IP address, origin, coarse browser family | Log service | Abuse control and diagnostics | 30 days by default; raw user-agent strings and app URLs are not sent by the client |
| IP address | Backup server memory | Rate limiting | Not written to disk. The hourly prune drops a rate-limit bucket one to two hours after its last request |
| Exported or shared images | Wherever the user saves or shares them | User-requested export and share | Outside Paletcam once saved. Each image carries its palette as hex colors in an XMP packet (`palette-image-metadata.js`). Canvas encoding drops camera EXIF |
| Backup file | Wherever the user saves it | User-requested export and later import | Outside Paletcam once saved. It holds photos, colors, and capture metadata. Favourites and publication state are left out (`OMITTED_EXPORT_FIELDS` in `json-transfer.js`) |
| App shell files | Cache Storage (`colorcatcher-<build>`) | Offline start | Replaced on each service-worker update. Holds no user data |

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
- Backup uploads start only after the user connects a recovery code. From then
  on `backup-service.js` uploads without asking: on connect, 8 seconds after
  app start, and every 5 minutes. The PWA does not create backup accounts. The
  operator mints one with `POST /v1/pair`, gated by `PAIRING_ENABLED`, and hands
  the recovery code to the user.
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

Deleting a published capture locally requires the owning community login and
queues its unpublish through the cleanup outbox.

The Data tab backup section connects a recovery code and offers Back up now,
Restore backup, Copy code, Disconnect, and Delete online backup. Disconnect only
removes the code from the device. Local flush removes it too, so a later restore
needs the code the user saved. Neither action touches the server copy. Delete
online backup asks for confirmation, then deletes the account on the server.
The recovery code stops working, and the server removes the photos and metadata
at once, without the 30-day grace period. The palettes on the phone stay. If the
request fails, the app keeps the code and the ledger as they were. Deleting a
capture locally sends a tombstone on the next backup run, and the server purges
that capture 30 days later.

The app has no telemetry opt-out. It sends every registered event whenever the
build sets a log endpoint.

Before support recommends clearing browser/PWA site data, instruct the user to
export a backup file, or to check that the online backup shows every palette and
that the recovery code is saved. Site-data deletion removes local photos and
cannot be undone by Paletcam unless the user retained a backup.

## Access and disclosure

Dashboard/log access is limited to operators with a support or incident need.
Do not export raw logs to general collaboration tools. If a sample is required,
remove IP, email, tokens, full URLs, and unique identifiers unless specifically
necessary and approved under the applicable privacy process.

The backup server has no dashboard. It writes photos and metadata as plain files
on the VPS volume without encrypting them, so anyone with access to that volume
can read them. Its README asks for the volume to be included in the VPS backup
routine. Copies made there follow that routine's retention, not the 30-day
tombstone purge or an account deletion.
