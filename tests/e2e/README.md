# Browser tests

These tests exercise the real browser application, workers, canvas, and IndexedDB.
Camera behavior is replaced per journey with either a deterministic denial or a
synthetic media stream, so the suite does not depend on host camera hardware or
permission state.

Install `@playwright/test`, install its browsers, then run:

```sh
bunx playwright install --with-deps chromium webkit
bunx playwright test
```

The default configuration starts the Bun development server on port 4173. Set
`E2E_BASE_URL` to reuse an already running server.

Offline and service-worker update tests must use a production build served from
a secure, non-local test hostname. The development app explicitly unregisters
service workers on `localhost`, `127.0.0.1`, and `0.0.0.0`, so an offline test on
the default server would be a false positive. Add that suite once the production
artifact server and required-shell cache semantics are finalized in P0.1.
