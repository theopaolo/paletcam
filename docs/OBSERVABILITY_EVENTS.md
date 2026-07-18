# Paletcam observability event contract

## Privacy and delivery boundary

Operational events use the existing `clientLog` endpoint. One shared registry,
loaded by both the app and log service, accepts only the event names and fields
listed below. Unknown client events are not sent, unknown server events receive
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

Delivery is best effort. The app never blocks camera, capture, storage, or PWA
work on telemetry. It serializes requests through a memory-only queue capped at
20 deliveries, counts capacity drops and failed attempts for local diagnostics,
and never retries or persists telemetry. The server also bounds its serialized
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
| `metric:service-worker-registration` | `outcome`, `durationMs`, `errorName` | 100% | Production service-worker registration attempt. |
| `metric:service-worker-update` | `outcome`, `durationMs`, `errorName` | 10% successes; 100% failures | Explicit service-worker update check. |
| `metric:service-worker-activation` | `outcome` | 100% | A new controller took control and the application is reloading. |
| `uncaught:error` / `uncaught:rejection` | error name/type and numeric source position only | 100%, throttled | Unhandled JavaScript failure observed before the page stopped running. Free-form messages, filenames, and stacks stay on-device. |

Durations are integer milliseconds clamped to five minutes. `operation`,
`outcome`, and `worker` are fixed categories. `errorName` belongs to a closed
set; unrecognized names become `OtherError` and never include the free-form
error message.

## Dashboard derivations and limitations

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
