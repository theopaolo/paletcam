# ADR 0006: Lazy collection boundary

- Status: accepted
- Date: 2026-07-12

## Decision

The camera capture shell is the only critical application entry graph. Collection,
viewer, community publication, backup, and collection-preview code load through a
dynamic ESM boundary when the collection or saved-capture viewer is opened.
Import failure is a recoverable user-visible error and must not break camera use.

Remote-delete outbox initialization is operational background work rather than a
collection presentation concern. It is loaded during an idle window with a
bounded timeout so retries remain active even when the collection is never opened.

Production builds use ESM splitting. Every emitted chunk remains in the bounded
offline precache. The artifact verifier measures initial JavaScript by recursively
walking static imports and re-exports from `app.js` and `pwa-install.js`; dynamic
imports are excluded only from the initial metric, never from artifact/precache
budgets or debug-content checks.

## Consequences

Camera startup parses substantially less inactive code while collection remains
available offline after installation. New lazy boundaries must preserve required
background lifecycle work explicitly and must have a loading-failure recovery
state. Build changes that introduce shared chunks must extend the static-graph
verifier rather than summing entrypoint filenames alone.
