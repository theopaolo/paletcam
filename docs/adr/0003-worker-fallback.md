# ADR 0003: Worker isolation and fallback

- Status: accepted
- Date: 2026-07-12

## Decision

Palette extraction and large JSON transfer use dedicated module workers when
available. Controllers own worker creation, request IDs, generation invalidation,
pending work, error handling, and terminal destruction. Extraction keeps at most
one active and one latest queued frame; stale results never replace current UI.

A worker construction/runtime failure disables that worker instance, reports one
bounded diagnostic, releases pending state, and falls back to the tested main-
thread path where one exists. The diagnostic is one `metric:worker-fallback`
event with `worker` and `errorName` fields, plus one error report (`src/app.js`,
`src/modules/palette-json-worker.js`). Since b0524cf the live loop hands the
extraction worker a cropped `ImageBitmap` instead of pixels. iOS keeps the
canvas read, and so does a disabled worker. Mutated/transferred buffers and
bitmaps are not reused. Messages
are accepted only for the current request/generation and malformed result types
must not resolve pending application work.

## Consequences

Heavy work normally stays off the camera UI thread without making worker support
a boot requirement. Fallback can be slower, so it is observable and performance-
budgeted. New worker message fields require validation and contract tests on both
sides.

