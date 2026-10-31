# ADR 0004: Telemetry and privacy boundary

- Status: accepted
- Date: 2026-07-12

## Decision

Camera frames, photo Blobs, credentials, email addresses, URL query/fragment
values, and community tokens are prohibited from telemetry. Telemetry follows a
closed schema in `services/log-server/src/telemetry-contract.js`: it lists every
allowed event name and, per event, the allowed fields and their value rules.
`normalizeTelemetryPayload` drops unknown events and unlisted fields. The client
runs it in `clientLog` before transmission, after recursively redacting error
contexts. The log service runs it again in `sanitizeLogPayload` as an
independent trust boundary. A new event name must be added to the contract
before it can be sent. Requests carry correlation IDs but
not user secrets. Mutating requests are never retried without a dedicated,
idempotent outbox contract.

Operational logs default to 30-day retention, 10 MB segment rotation, 16 KB
bodies (`services/log-server/src/config.js`), origin/access controls, serialized writes, and health failure after a
write error. Production source maps are not public. Operators follow
`docs/PRIVACY_DATA_INVENTORY.md` and `docs/PRODUCTION_OPERATIONS.md`.

## Consequences

Diagnostics are intentionally less detailed than raw application state. Missing
evidence must be addressed with safe event fields or sampled timings, never by
logging photos, tokens, full URLs, or arbitrary object dumps.

