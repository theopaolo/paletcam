# Paletcam observability event contract

## Privacy and delivery boundary

Operational events use the existing `clientLog` endpoint. One shared registry,
`services/log-server/src/telemetry-contract.js`, is loaded by both the app and
the log service. It accepts only registered event names, each with its own
closed field list. Unknown client events are not sent, unknown server events receive
HTTP 400, and non-allowlisted fields are dropped at both trust boundaries.
Identifiers, email, credentials, RGB values, photos, blobs, arbitrary error
messages, URLs, filenames, stacks, query strings, and fragments are not accepted.
The UUIDv4 tab-session correlation token described below is the sole explicit
identifier exception.

All client logs include the immutable app version and commit, the release
environment (`production`, `preprod`, or `development`), an ephemeral tab-session
correlation ID, a closed coarse browser family, and timestamp. Raw user-agent
strings and app URLs are not sent. The correlation ID is kept only in
`sessionStorage`, survives reloads in that tab, and disappears when the tab
session ends. Invalid stored values are replaced and the server accepts only a
strict UUIDv4. Logs follow the
30-day default retention in `PRIVACY_DATA_INVENTORY.md`; production may shorten
that period but must not extend it without updating the privacy inventory.

Delivery is best effort. The app posts one JSON request per event to
`/clientlog` under the build-time `PALETCAM_LOG_API_BASE_URL`. `pwa/prod` builds
require it to be `https://cclogs.ludique.dev` (`scripts/log-api-config.js`).
Other builds without it send nothing. The app never blocks camera, capture,
storage, or PWA work on telemetry. It serializes requests through a memory-only
queue capped at 20 deliveries, the in-flight request included, with a 10-second
timeout per request. It counts capacity drops and failed attempts in memory
(`getClientLogDeliveryStats()`, which no app code reads yet), and never retries
or persists telemetry. The server also bounds its serialized
disk-write backlog and rejects excess telemetry with a retryable 503 response;
server body, rate, origin, retention, rotation, health, and access controls are
defined in `PRODUCTION_OPERATIONS.md`.

## Operational events

| Event | Allowed fields | Sampling | Operational meaning |
| --- | --- | --- | --- |
| `metric:session-started` | none | 100% | One denominator per browser-tab session, preserved across reloads by `sessionStorage`. |
| `metric:camera-start` | `operation`, `outcome`, `durationMs`, `errorName` | 100% | Owned camera start/rotation attempt; deduplicated callers do not emit duplicates. |
| `metric:capture-save` | `outcome`, `durationMs`, `hasPalette`, `errorName` | 100% | Capture export plus local palette persistence. `hasPalette=false` means the photo was exported but no palette record was written. |
| `metric:backup-transfer` | `direction`, `outcome`, `category`, `durationMs` | 100% | Import/export outcome using only closed recovery categories. No filename, palette count, parser message, photo metadata, or collection identifier is accepted. |
| `metric:worker-fallback` | `worker`, `errorName` | Once per failed controller | Extraction or JSON worker disabled and the application used/retained its safe fallback path. |
| `metric:indexeddb-failure` | `operation`, `errorName` | 100% failures | Public palette/asset/maintenance operation failed, including a blocked schema upgrade. |
| `metric:service-worker-registration` | `outcome`, `durationMs`, `errorName` | 100% | Service-worker registration attempt outside local development. |
| `metric:service-worker-update` | `outcome`, `durationMs`, `errorName` | 10% successes; 100% failures | Explicit service-worker update check. |
| `metric:service-worker-activation` | `outcome` | 100% | A new controller took control and the application is reloading. |
| `uncaught:error` / `uncaught:rejection` | `name`, `lineno`, `colno` / `name`, `reasonType` | 100%, not throttled | Unhandled JavaScript failure observed before the page stopped running. Free-form messages, filenames, and stacks stay on-device. |

Durations are integer milliseconds clamped to five minutes. `operation`,
`outcome`, and `worker` are fixed categories. `errorName` belongs to a closed
set; unrecognized names become `OtherError` and never include the free-form
error message.

The registry also accepts diagnostic events outside this table. They cover
`reportAppError` messages such as `Failed to save palette.`, storage and
collection timings (`getSavedPalettes:*`, `loadCollectionUi:*`,
`paletteStorageMaintenance:*`), `storage:health` quota and persistence readings,
camera resume (`Restarting camera after app resume.`), backup-server
failures (`backup:flush-failed`, and `backup:restore-failed` from app versions
before sync), and `backup:pull-delete-guard` when a sync pass refuses to delete
more than half the collection. The registry file is
the authoritative list of names and fields.
`src/modules/telemetry-contract-coverage.test.js` fails when app code emits a
name the registry lacks.

## Dashboard derivations and limitations

The bundled dashboard (`GET /dashboard`, `services/log-server/src/dashboard.html`)
loads the last 5,000 entries of one UTC day. It shows the event count, the
error count, distinct correlation IDs, app versions, one p50/p95 pooled over
every `durationMs`, the top 20 event names, and the last 50 errors. The
derivations below are not built in. They need a separate query over `/logs`
output.

- Observed error-free session rate: correlation IDs with
  `metric:session-started` and without an uncaught event, divided by observed
  session-started correlation IDs.
- Camera-start success and p50/p95 latency: `metric:camera-start`, segmented by
  operation, environment, version, and coarse user-agent family.
- Capture/save success and p50/p95 latency: `metric:capture-save`.
- Backup import/export success and p50/p95 latency: `metric:backup-transfer`, grouped by direction and recovery category.
- Worker fallback incidence: distinct correlation IDs with
  `metric:worker-fallback`, divided by observed session correlation IDs. This is
  a session incidence rate, not a per-frame rate.
- IndexedDB failure incidence: distinct correlation IDs with
  `metric:indexeddb-failure`, grouped by operation and error name.
- Service-worker health: registration failure rate, sampled update-check latency,
  and activation count by version/environment.

“Observed error-free sessions” must not be presented as a true crash-free rate:
hard browser, OS, or process termination can prevent both the crash event and
any final beacon. Release decisions combine these signals with physical-device
smoke tests and server health.
