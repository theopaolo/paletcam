# Paletcam production operations

## Deployment contract

Every release is built from an immutable commit with Bun 1.3.11. Set the
credential-free HTTPS `PALETCAM_LOG_API_BASE_URL` authorized by the production
CSP, then run `bun install --frozen-lockfile` and
`PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev bun run verify:release`.
An exact production build rejects a missing, unsafe, or unauthorized telemetry
or community endpoint before touching the existing artifact. A production
artifact must pass `scripts/verify-build.js`; never promote a manually modified
`dist/`. The release command also rebuilds twice and rejects byte or file-list
drift. It runs development and exact-production UI journeys, the production PWA
suite, and the throttled performance profile with an enforced allowlist for the
known WebKit Blob-fixture and preprod-only skips. The clean promotion CI then
writes its run-bound receipt and runs
`release:evidence --verified`; attach that generated record to the deployment
ticket after completing its structured external sign-offs and running
`bun run release:evidence:validate --input release-evidence.json`. Local evidence is intentionally unverified. Verified evidence requires
the commit-bound build manifest and the artifact-bound gate receipt written in
the next CI step. CI uploads the verified `dist/` and JSON evidence together.

Deploy to `pwa/preprod` first. Preprod intentionally contains debug pages and the
full reference image corpus, but neither may enter service-worker precache or
runtime caches. Promote the same reviewed commit to `pwa/prod` after smoke tests.
Prefer a small traffic canary when the hosting platform supports it, then expand
after camera-start, client-error, and service-worker-install rates remain normal.

## Release smoke test

1. Cold-open browser and installed PWA on one supported iPhone and Android phone.
2. Deny camera, retry, capture, background/foreground, and capture again.
3. Reload and open the saved capture; export a backup and import it into a clean
   test profile.
4. Publish and unpublish a test capture, then repeat once offline/reconnected.
   Confirm the backend deduplicates repeated requests carrying the same
   `Idempotency-Key`; successful client/CORS transmission alone is insufficient.
5. Load once online, enable airplane mode, and verify offline reload.
6. With an update waiting, accept it during a capture or test publication and
   verify the reload occurs only after the operation completes.
7. Confirm production has no `/assets/img/`, `/debug-extraction.html`, `/__*`,
   `components.html`, source maps, or `.DS_Store` responses.
8. Record commit, artifact sizes, device/browser versions, and smoke-test owner.
   Complete the external sign-offs in the generated release-evidence record.

## Application rollback

Keep the previous verified production artifact and commit addressable. Roll back
by redeploying that artifact, not by rebuilding the old source with new tools.
Current IndexedDB schema version 7 keeps palette metadata, master photos,
previews, maintenance markers, the durable leased community-delete outbox, and
isolated provisional import rows in separate stores. Version 7 additionally
binds new remote publications to a stable non-secret account key; pre-v7 remote
rows remain owner-unknown and fail closed for remote mutations. Its changes are
additive and reads normalize missing fields; do not ship a rollback that cannot open
schema version 7. If a future migration is not
backward-compatible, require a forward-fix release instead.

Rollback triggers include sustained camera-start failure, inability to open
existing IndexedDB data, failed service-worker activation across multiple real
devices, corrupt export/import, authentication loops, or a material privacy leak.

After rollback, repeat cold/upgrade/offline smoke tests and preserve incident
logs. Do not clear users' IndexedDB or caches globally as part of rollback.

## Bad service-worker recovery

1. Stop promotion and identify the affected build ID/cache name.
2. Deploy the previous known-good worker and shell as one immutable artifact with
   a new build ID so browsers detect an update.
3. Verify required-shell installation, activation, old-cache deletion, and
   offline reload in a fresh profile and an upgraded profile.
4. Ask affected users to fully close and reopen the PWA. Browser-level worker
   unregistration is a last resort because it removes offline availability.
5. Never instruct users to clear site data until they have exported a backup;
   clearing site data deletes local photos and palettes.

## Local-data recovery

Backup import is schema-versioned, size-limited, and atomic. Preserve the original
backup file and reproduce failures in a disposable profile. A failed import must
leave the existing collection unchanged. Before any destructive support step,
export a backup and verify that it contains photo data.

The current version-2 format accepts Blob backups up to 192 MiB, with at most
32 MiB per JSON palette entry, 16 MiB per decoded photo, 128 MiB decoded photos
in total, 12 megapixels per photo, and 2,000 palettes. Blob import is incremental
and worker batches are acknowledged only after durable staging. Blob export uses
the same restorable limits; the whole-string compatibility API remains capped at
32 MiB. Record peak memory on representative low-memory devices before release.
Do not raise these limits without new physical evidence and an updated bounded
format design.

The in-app data flush removes Paletcam-owned local settings, session/outbox data,
palettes, master photos, derived previews, storage metadata, and provisional
import rows. Clearing the import lease in the same transaction makes a
cross-tab importer fail closed instead of repopulating cleared data. It does not
delete the remote community account or guarantee removal of already published
remote catches. Account deletion and remote unpublish use their dedicated
authenticated flows.

The community-delete outbox is durable and lease-based so tabs do not process the
same cleanup item concurrently. Publication requests carry an idempotency key and
the required CORS header is verified, but promotion still requires backend-owner
evidence that duplicate keys are enforced as one remote publication.

## Incident handling

- **SEV-1:** data corruption/loss, credential or photo disclosure, widespread
  startup failure. Stop rollout immediately and page the release owner.
- **SEV-2:** camera/community/offline failure affecting a material device group.
  Freeze promotion, assess rollback, and publish a support note.
- **SEV-3:** degraded performance or isolated recoverable errors. Track and fix
  in the next patch unless rates increase.

Capture timeline, commit/build ID, device/browser/PWA mode, reproduction steps,
and sanitized correlation IDs. Never paste tokens, email codes, full sensitive
URLs, photos, or raw IndexedDB exports into tickets or chat.

## Log service operations

`services/log-server` exposes `/health`, authenticated `/dashboard` and `/logs`,
and origin-restricted `/clientlog`. Production must set `ALLOWED_ORIGINS`, strong
dashboard credentials, persistent `LOG_DIR`, `LOG_RETENTION_DAYS`,
`MAX_LOG_FILE_BYTES`, body limits, rate limits, `RATE_LIMIT_MAX_BUCKETS`, and the
bounded `LOG_WRITE_QUEUE_MAX_PENDING` disk-write backlog.
Terminate TLS at a trusted proxy and restrict dashboard routes at the network
layer where possible.

The current public application origin is `https://app.colorcatchers.co` and the
configured log service is `https://cclogs.ludique.dev`. On 2026-07-13 the health
endpoint returned HTTP 200 and CORS preflight allowed the application origin
while denying unrelated origins. Repeat both probes during every deployment;
this dated check does not replace continuous health, disk, and error-rate alerts
or the still-pending deployed observability/operations sign-off.

Production startup now fails unless `PUBLIC_BASE_URL` is an exact HTTPS origin,
every allowed app origin uses HTTPS, dashboard credentials meet the minimum
contract and are not the public example placeholders, `LOG_DIR` is explicit,
numeric limits are in safe ranges, and
`TRUST_PROXY_HEADERS=true`. The proxy must be the only direct network path to the
container and must discard client-supplied `X-Forwarded-For` / `X-Real-IP`
headers before writing one canonical client address. The service intentionally
uses the first forwarded value and does not infer a trusted multi-hop chain;
allowing clients to prepend values permits rate-limit evasion. Retained IP
buckets expire after five rate windows and are deterministically LRU-evicted at
the configured capacity. Start from
`services/log-server/.env.example` and inject real secrets through the deployment
platform rather than committing them.

`DASHBOARD_RATE_LIMIT_MAX` defaults to 30 requests per configured rate-limit
window and uses a separate bounded per-IP bucket set for `/dashboard` and
`/logs`. A rejected request returns HTTP 429 with `Retry-After`; keep ordinary
manual refresh traffic below that boundary and continue restricting these
routes at the network layer.

Writes are serialized through a memory-only backlog capped by
`LOG_WRITE_QUEUE_MAX_PENDING` (1,000 by default, including the active write).
When it is full, new valid telemetry receives HTTP 503 with `Retry-After: 1`
instead of retaining unbounded work in memory. Daily files rotate at the
configured size, and expired segments are pruned every six hours. Dashboard
reads stream every strictly validated same-day rotated segment followed by the
active file in 64 KiB chunks, cap individual lines at 64 KiB, and retain only
the requested tail in memory. Symlinks and unrelated filenames are ignored.

Startup fails unless `LOG_DIR` can exclusively create, write, fsync, close, and
remove a private probe file. The same probe refreshes readiness every 30 seconds
without making public `/health` requests perform filesystem writes. `/health`
returns 503 after a log write or volume-readiness failure, or while the write
backlog is saturated. It reports write health, volume readiness, pending/max
backlog depth, and saturation separately. Alert on 5xx health, disk usage,
repeated 429/413/503 ingestion responses, sustained queue depth, and sudden
changes in camera, storage, worker, or uncaught-error categories.

The image runs as the unprivileged `bun` user. A new named volume inherits the
prepared `/app/logs` ownership; a host bind mount must grant equivalent write
access to container uid/gid 1000 before deployment. Verify this with the actual
orchestrator and storage class rather than relying only on the image build.

Back up logs only within the declared retention period. Treat IP addresses,
origins, coarse browser families, and ephemeral correlation IDs as
personal/operational data. Raw user-agent strings and app URLs are not accepted
by the current telemetry contract.
