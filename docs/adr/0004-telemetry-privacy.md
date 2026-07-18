# ADR 0004: Telemetry and privacy boundary

- Status: accepted
- Date: 2026-07-12

## Decision

Camera frames, photo Blobs, credentials, email addresses, URL query/fragment
values, and community tokens are prohibited from telemetry. The client recursively
redacts and bounds context before transmission; the log service repeats redaction
and bounds as an independent trust boundary. Requests carry correlation IDs but
not user secrets. Mutating requests are never retried without a dedicated,
idempotent outbox contract.

Operational logs default to 30-day retention, 10 MB segment rotation, bounded
bodies, origin/access controls, serialized writes, and health failure after a
write error. Production source maps are not public. Operators follow
`docs/PRIVACY_DATA_INVENTORY.md` and `docs/PRODUCTION_OPERATIONS.md`.

## Consequences

Diagnostics are intentionally less detailed than raw application state. Missing
evidence must be addressed with safe event fields or sampled timings, never by
logging photos, tokens, full URLs, or arbitrary object dumps.

