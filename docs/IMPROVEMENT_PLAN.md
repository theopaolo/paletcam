# Paletcam production-readiness improvement plan

Status: audit baseline created 2026-07-11 on `pwa/preprod`.

## Execution status (2026-07-18)

### Final review delta

- Native capture regression fixed: the shutter path now freezes a dedicated
  native-resolution frame synchronously (bounded to 2048 px wide) before
  yielding for UI paint, rather than persisting the viewport-sized analysis
  canvas. Rapid direct-viewer taps share one pending surface acquisition, and a
  failed collection chunk load is retryable without restarting the app.
- Publication recovery records now include the local palette id. Known remote
  creations reconcile on startup/session/online/foreground and before deletion;
  outcome-unknown reserved publications fail closed. Backup export now rejects a
  missing master photo with an integrity error instead of silently substituting
  a derived preview. Successful unchanged moderation checks persist their check
  timestamp without inflating the changed-status count.
- Preprod components and verso harness scripts are now bundled and exercised as
  executable pages. They remain excluded from production and from every
  service-worker cache. Client telemetry aborts a stalled delivery after ten
  seconds so one hung request cannot block the bounded single-flight queue.
- **Publication remains blocked on two product/backend decisions:** historical
  pre-v7 remote-linked palettes need a server-verified ownership claim contract;
  the client must not infer ownership from the active login. In addition, normal
  captures/imports can currently grow beyond the 2,000-palette / 128 MiB decoded
  photo envelope of the only full backup format. Promotion requires either a
  chunked/segmented restorable backup or a clearly enforced collection-wide
  storage policy that guarantees every accepted state remains exportable.

- **P0.1 implemented:** production excludes debug harnesses and `assets/img/**`;
  preprod retains them. Debug content is excluded from both precache generation
  and runtime service-worker caching. One shared debug-path policy drives
  production copying, precache selection, artifact/release-evidence rejection,
  and the generated service-worker bypass lists. The latest verified working-tree
  production artifact is 1,154,861 bytes across 103 files; initial JavaScript is 456,068
  bytes and the precache is 1,137,095 bytes across 99 entries. The preprod
  verifier finds 227 debug files, including an exact manifest for 216 image
  files / 76,239,782 bytes, and proves none are precached. The previously ignored
  corpus is now intentional source input so clean preprod CI can reproduce it.
  The performance HUD implementation is compiled only for dev/preprod
  and is absent from production JavaScript.
- **P0.2 substantially implemented:** Bun 1.3.11 is pinned in CI; the repository
  now has a non-mutating `verify` command covering 122 isolated test files, JS/CSS
  lint, production build, unresolved placeholders, forbidden debug files, and
  artifact/precache budgets. CI covers main, preprod, prod, and pull requests.
  TypeScript 5.9 is pinned and the default `typecheck` command validates the
  production source contract as a required release gate. The broader
  `typecheck:all` diagnostic remains available for progressively typing test
  infrastructure; tests and preprod-only debug tooling remain outside the
  production gate.
  CI restores a lockfile-keyed Bun download cache through immutable-pinned
  `actions/cache` v4.2.0, while both dependency graphs still run frozen installs
  on every build rather than trusting cached `node_modules`.
- **P0.3 substantially implemented:** deterministic camera-denial boot and real
  IndexedDB persistence/reload flows pass in Chromium and mobile WebKit. The
  production artifact additionally passes Chromium tests for bounded cache
  contents, offline reload, stale-cache cleanup, required-shell install failure,
  and optional-precache failure. Corrupt-import rollback passes in Chromium and
  mobile WebKit. A real app capture with a synthetic camera proves extraction,
  photo encoding, and atomic palette/asset persistence in Chromium. A forced
  quota failure proves the visible recovery state, absence of partial records,
  and successful retry. Community mock browser flows and a successful full
  export/import round trip pass. Mocked community coverage now verifies login
  failure recovery and session persistence, publish/unpublish state and payloads,
  plus a failed cleanup outbox surviving reload and flushing after reconnect.
  Photo-backed publish and successful backup round trips run in Chromium; their
  Playwright WebKit variants are skipped because that engine rejects the
  Blob-backed IndexedDB fixture. The same limitation affects synthetic capture
  persistence and quota recovery, so real iOS Safari validation remains a
  release checklist item.
- **Startup interaction hardening implemented:** capture and collection controls
  remain disabled until their handlers and controllers are bound. Early taps can
  no longer disappear during the asynchronous startup window, and the controls
  become available only when the corresponding action can run.
- **Service-worker update safety implemented:** the generated manifest is the
  complete runtime-cache allowlist. `index.html`, `offline.html`, and every
  production JavaScript/CSS output (including lazy chunks) are required install
  assets; other manifest assets are optional. Requests outside the manifest are
  network-only. Updates remain waiting until the user accepts an in-app action.
  Capture, palette deletion, publish/unpublish, remote community cleanup,
  account deletion, backup import, and local-data flush each hold a shared
  reload-sensitive lifecycle lease. The accepted update remains deferred until
  every lease releases. Controller changes reload only after an activation
  requested by this app instance, and a new critical operation that starts after
  activation but before `controllerchange` also defers the reload. Deterministic
  controller and operation tests cover both races; a real byte-changing worker
  fixture now starts a real held capture, accepts the update, proves the worker
  remains waiting, then observes activation/navigation only after capture save.
  A coherent immutable artifact A-to-B regression additionally gives artifact B
  byte-changed required application code, a newly derived build/cache identity,
  and matching build-manifest/service-worker identities. It proves artifact A
  remains active while B waits, B installs into a separate cache, acceptance
  activates B, and activation removes A's cache. The same regression passes for
  production and preprod without allowing preprod debug content into CacheStorage.
  The verifier also proves the precache manifest exactly matches the policy-selected
  artifact set: missing, extra, duplicate, aliased, or non-canonical entries fail
  the build. Direct `offline.html` and unknown document navigations cannot replace
  the canonical cached app shell.
- **Mobile camera lifecycle substantially implemented:** overlapping starts are
  deduplicated; stale acquisitions cannot overwrite newer streams; playback
  failure releases acquired tracks; destruction permanently invalidates pending
  work; and interruption listeners are removed with their stream. iOS
  backgrounding stops camera tracks and foregrounding reacquires them, while
  non-iOS keeps healthy tracks warm and restarts unhealthy streams. Chromium and
  mobile WebKit verify denial recovery through the capture action and the
  platform background policy. Captures now export the already-frozen canvas
  frame, so a stream interruption between shutter and persistence cannot change
  or invalidate the saved photo. Opening the collection or viewer now suspends
  active camera work before the lazy surface opens and resumes only after the last
  full-screen surface closes; inactive cameras are not prompted on return.
  Physical iOS Safari remains a release check.
- **P1.1 partially implemented:** backup imports now enforce the supported schema
  version and limits for JSON bytes, palette count, and per-photo decoded bytes
  before opening the write transaction. Imported palettes are constructed from
  an explicit field allowlist with bounded RGB/crop/RAL/date contracts and only
  JPEG, PNG, or WebP master photos; untrusted object fields cannot flow into
  IndexedDB. Image dimensions and complete PNG/JPEG/WebP container boundaries are
  validated before persistence, and malformed, truncated, zero-size, or
  over-12-megapixel photos are rejected without invoking a decoder, bounding
  decompression memory independently of the 16 MiB decoded-photo ceiling. Startup
  requests durable storage where
  supported and records normalized usage/quota diagnostics. Version 2/3 migration
  transforms are directly tested, including malformed legacy records and photo
  extraction into the asset store. Legacy render-setting backfill is now an
  explicit, atomic, idempotent startup maintenance job instead of N+1 writes in
  collection and single-palette reads. Concurrent initialization is deduplicated;
  interrupted maintenance is reported and retryable. Normal startup no longer
  runs an orphan scan. Versioned migration and explicit repair prune only asset
  keys with no matching palette metadata, without loading Blob payloads or using
  age/quota/type heuristics. Chromium and mobile WebKit verify
  the persisted maintenance result after reload. Cross-tab blocked upgrades now
  emit a bounded storage failure, close obsolete connections on version change,
  and show actionable reopen/close-other-tab recovery guidance; the coordinator
  is covered by direct lifecycle tests. Normal file imports preflight `File.size`
  against a 192 MiB streaming ceiling and pass the Blob handle into the JSON
  worker without creating a whole-file string. The parser retains at most one
  32 MiB JSON entry plus a bounded batch, validates 16 MiB per-photo, 128 MiB
  cumulative decoded-photo, 12-megapixel, and 2,000-palette limits, and uses an
  acknowledgement after each worker batch for backpressure. The legacy string
  API remains capped at 32 MiB because it still uses `JSON.parse`; UTF-8 byte
  counting does not allocate a second full encoded buffer before parsing. Blob
  export uses the same 192/128 MiB restorable contract, while string export stays
  at 32 MiB; a stable error code drives specific oversized-backup guidance in
  English and French. Export now reads metadata, master assets, and
  recovery previews from one read-only IndexedDB snapshot in bounded batches;
  it refuses to report success if any palette lacks a restorable photo source.
  Actual version-1 and version-2 IndexedDB databases
  are upgraded in Chromium through the registered Dexie migrations, including
  master-photo separation. A same-origin version-3 migration browser regression
  passes against both the development server and exact production artifact,
  proving preview separation, metadata scrubbing, master-photo preservation, and
  the durable maintenance marker. Database version 5 adds the durable leased
  community-deletion outbox without changing backup schema compatibility.
  Database version 6 adds an isolated import-staging store and durable cross-tab
  lease. Batches remain invisible until trailing JSON validation succeeds; the
  final metadata/asset copy and staging cleanup share one transaction, so parse,
  worker, quota, or commit failures expose no partial import. Abandoned staging
  is recovered after the refreshed five-minute lease expires. The provided
  148,928,389-byte legacy version-2 backup streams successfully in the local
  compatibility check (193 photos, 111,625,886 decoded bytes) without entering
  source control. Representative low-memory iPhone and Android peak-memory
  evidence at the supported ceiling remains a physical release gate.
  Portable backups validate legacy community fields for compatibility but strip
  all remote publication identifiers and moderation authority on import/export,
  so a backup cannot make the current account mutate someone else's remote catch.
- **P1 account ownership and authentication races implemented:** database version
  7 stores a non-secret stable owner key with every new remote publication.
  Remote delete, unpublish, republish, cleanup, and moderation paths fail closed
  for ownerless legacy rows or a different active account. Moderation persistence
  atomically rechecks both owner and remote catch id; account deletion clears only
  the captured account and its historical aliases in one transaction. Historical
  email-key outbox jobs migrate to the canonical user-id key and duplicates merge
  before execution. OTP verification and account deletion cannot overwrite or
  clear a newer cross-tab session. Account deletion reserves owner-bearing
  recovery before its irreversible request, and logout writes a durable tombstone
  so a failed storage removal cannot resurrect a bearer token. Portable exports
  omit every remote authority field.
- **P1.2/P1.3 substantially implemented:** telemetry recursively redacts credential
  fields and URL query/fragment data, bounds messages/context/arrays/depth, and
  safely handles circular values. Global uncaught handlers are idempotent and
  removed during app destruction. Community and capture-stat traffic now share
  a bounded JSON request boundary with timeout classification, caller
  cancellation, correlation IDs, response-size limits, strict successful JSON
  parsing, and structured HTTP failures. Mutating requests are never retried
  automatically. Account UI teardown cancels in-flight requests and releases
  listeners/subscriptions. Capture-stat delivery is single-flight and removes
  only acknowledged counts, preventing rapid captures from being double-counted.
  The log service now independently redacts and bounds untrusted payloads,
  stream-limits oversized bodies without trusting `Content-Length`, serializes
  writes through a validated bounded backlog, rejects saturation with a
  retryable 503 response, exposes queue depth/saturation through health, rotates
  10 MB segments, and prunes records only after their entire final UTC day is
  outside the 30-day window. Client telemetry uses a single-flight
  in-memory queue capped at 20 accepted deliveries, bounds throttle state, and
  accounts for capacity drops and delivery failures without retrying or persisting
  events. The log service reports write failures through its health check.
  Deployment, rollback, bad-service-worker, local-data recovery, incident, and
  release-smoke procedures are documented in `docs/PRODUCTION_OPERATIONS.md`.
  The allowlisted contract in `docs/OBSERVABILITY_EVENTS.md` now measures observed
  sessions, camera-start outcome/latency, capture/save outcome/latency, extraction
  and JSON worker fallback, IndexedDB failures, and service-worker registration,
  update, and activation. Every log carries release environment and an ephemeral
  correlation ID; timing/category fields are bounded and update successes are
  sampled. A deployed dashboard/alerting destination and enough production field
  data to establish device-specific baselines remain external release work.
  The in-app local-data flush also clears Paletcam-owned telemetry/session keys
  from `sessionStorage` while preserving unrelated site data.
  The log service now fails production startup unless HTTPS public/app origins,
  explicit persistent storage, bounded numeric controls, strong dashboard
  credentials, and trusted-proxy policy are configured. Forwarding headers are
  ignored by default to prevent rate-limit spoofing. Per-IP rate state now has a
  validated hard cap, idle expiry, and deterministic LRU eviction; trusted
  proxies must overwrite inbound forwarding headers with one canonical address.
  A production-like runtime
  probe verified health, allowed/denied origin handling, proxy IP attribution,
  persisted redaction, and JSONL writes. Its Docker image pins Bun 1.3.11 and no
  longer falls back from a frozen dependency install. Exact `pwa/prod`
  application builds also fail before touching `dist/` unless telemetry is the
  exact credential-free root `https://cclogs.ludique.dev` endpoint. The
  community target is independently restricted to the credential-free root
  `https://colorcatchers.co`; general CSP membership can no longer authorize
  either destination, and unused third-party connection origins were removed.
  The current
  `https://cclogs.ludique.dev/health` endpoint returned 200 on 2026-07-13, and a
  preflight probe confirmed that `https://app.colorcatchers.co` is allowed while
  unrelated origins are denied. Ongoing health alerting and production field
  baselines remain operational sign-offs.
- **Community consistency hardened:** publication retries a transient local state
  write, compensates a persistent write failure by unpublishing remotely, and
  records a bounded account-scoped recovery journal if compensation also fails.
  A writable journal slot is reserved before POST, so a full or unavailable
  recovery store prevents publication instead of creating an untracked remote
  catch. Single and bulk actions capture immutable session identity/token at
  intent time, stop on account replacement, compensate with the originating
  token, and cannot let a stale 401 clear a newer login.
  Remote deletion retry jobs are durable in the version-5 IndexedDB outbox,
  account-bound, identifier/count bounded, cross-tab leased, and use exponential
  backoff; current-store rows are normalized at the IndexedDB boundary and
  malformed jobs are transactionally discarded with count-only reporting before
  they can be sorted, claimed, or sent. Published palette deletion now reserves
  its account-bound outbox intent and removes palette metadata, master photo, and
  previews in one IndexedDB transaction; reservation/capacity/storage failure
  rolls the entire deletion back. The outbox is the sole remote executor.
  Remote account deletion clears only its originating authentication session and
  reports local metadata cleanup independently. An owner-bearing durable marker
  is reserved before the remote deletion and retries exact account-scoped cleanup
  on later community initialization if IndexedDB was temporarily unavailable.
  Magic-link capabilities are restricted to the
  configured community origin, require a future expiry, are bound to the session
  that requested them, and are aborted/reset on logout, account replacement, or
  app teardown. Stale completions and capabilities that expire before click are
  never opened. Cross-tab logout and account replacement invalidate existing
  consumers immediately, while malformed remote session state fails closed.
  Exactly-once publication still requires documented backend
  idempotency support.
- **Log dashboard hardened:** it has no CDN/runtime third-party script, applies
  no-store and restrictive CSP/framing/referrer/permissions/MIME headers, and CI
  runs its frozen dependency tests plus a Docker image build.
- **Community response contracts implemented:** login verification, magic links,
  publication, moderation status, unpublish, and account/login acknowledgement
  responses are validated and reduced to explicit normalized shapes before
  reaching application services. Invalid responses become secret-free structured
  502 failures; magic links must be absolute HTTPS URLs with valid expiry dates.
  Login credentials and identity fields are length-bounded, numeric identifiers
  must be finite, and moderation work is capped at the supported 2,000-palette
  import ceiling in sequential 100-ID batches. Responses reject excessive, duplicate,
  cross-listed, or unrequested IDs before database/UI fan-out.
- **Worker lifecycle implemented:** extraction and JSON worker controllers have
  explicit terminal cleanup, pending-work rejection, crash fallback, stale
  response rejection, and latest-wins queue tests. A stale extraction response
  bug that released the active job slot was fixed. Request dimensions, transferred
  buffer size, RGB/origin/presence result shapes, JSON progress, and export/import
  result types are validated before application code consumes worker messages.
- **P2.1 app composition root partially extracted:** `app.js` no longer queries
  static DOM directly. A typed `app-view` factory owns lookup, app-created
  surfaces, and the required-element startup contract, with characterization
  tests. A lifecycle-owned panel-camera controller now coordinates camera
  controls across overlapping drawers and always releases its compact preview.
  A separate collection-entry controller owns the lazy collection import,
  mini-output/deletion synchronization, event listeners, stale completion
  suppression, and exactly-once late-module teardown. App-owned DOM listeners,
  including capture-mode switching, now share the terminal abort signal.
  `app.js` is now 744 lines;
  camera/live-preview composition continues incrementally.
- **P2.1 live-preview timing extracted:** frame scheduling/cancellation, the
  monotonic clock, extraction cadence, and camera-settings refresh cadence now
  live behind an injected 66-line timing module with deterministic boundary and
  single-flight tests. Rendering, camera reads, extraction, and frozen-pin policy
  remain behaviorally isolated for later increments.
- **P2.1 live-preview frame acquisition extracted:** a 244-line browser adapter
  now owns canvas/context acquisition, frame/palette/analysis sizing, DPR overlay
  sizing, centered source cropping, preview/analysis drawing, and bounded pixel
  readback. Its drawing and geometry dependencies are injected and
  deterministically tested. The controller retains capture-mode, extraction,
  RAL, frozen-pin, origin-overlay, and performance policy and is now 590 lines,
  down from the 875-line audit baseline without changing its public API.
- **P2.1 live-preview extraction pipeline extracted:** worker delegation and
  synchronous fallback now share one strict, DOM-free service that owns raw
  extraction state, option construction, origin tracking, frozen-color presence,
  worker-duration handoff, and reset/invalidation. Nine deterministic tests cover
  transferred-buffer ownership, exact worker/fallback normalization, raw-color
  stability bias, one-shot metrics, and failure propagation. Cadence, smoothing,
  rendering, haptics, and frozen-pin release policy remain in the controller.
- **P2.1 live-preview origin-marker state extracted:** a strict DOM-free model
  owns smoothed and frozen marker positions, pop/fall physics, live/falling
  ordering, CSS-pixel hit testing, and terminal reset. Twelve deterministic
  tests preserve the prior animation and interaction math. The controller keeps
  drawing, haptics, RAL policy, frozen-pin release decisions, and performance
  integration.
- **P2.1 collection selection/deletion extracted:** selection activation,
  suppression, toggling, pruning, and policy-filtered queries now live in a
  DOM/storage/network-free state boundary. Irreversible deletion now runs through
  a dependency-injected use case that coordinates local IndexedDB deletion,
  remote cleanup intent, retry outbox, preview disposal, and deletion notification
  with deterministic tests. The storage boundary atomically reserves remote
  cleanup before deleting all local records, and refuses the operation when safe
  authenticated cleanup cannot be guaranteed.
- **Deletion settlement hardened:** staged single and bulk deletions now use an
  exact-once coordinator. Undo restores data; timeout, user close, swipe, and
  interruption commit once; programmatic teardown cancels without deleting
  durable data. Toast settlement occurs when dismissal begins rather than after
  its exit animation, so bulk cancellation stops scheduling work immediately.
  Detached-card restoration explicitly falls back to a reload and releases the
  abandoned preview resources. Direct and browser tests cover settlement races,
  durable swipe deletion, and teardown preservation.
- **P2.1 bulk publication extracted:** sequential publish/unpublish aggregation,
  cancellation boundaries, authentication short-circuiting, already-done reload
  policy, and unexpected adapter rejection now live in a strict, DOM-free service
  with deterministic tests. `collection-ui.js` retains only toast, reload, login,
  and moderation-scheduling presentation effects.
- **P2.1 moderation synchronization extracted:** polling cadence, single-flight
  execution, close/destroy cancellation, generation invalidation, and stale
  result/error suppression now live in an injected controller with deterministic
  tests. Closing a collection can no longer let an older request reload hidden UI
  or reschedule polling. Transport-level `AbortSignal` cancellation now reaches
  the HTTP boundary, and cancellation errors are suppressed as lifecycle events
  rather than reported as failures.
  Moderation persistence is now one normalized, bounded IndexedDB bulk
  transaction for as many as 2,000 changes, instead of an unbounded fan-out of
  per-record writes followed by per-record reads.
- **P2.1 collection viewer ownership extracted:** a small injected coordinator
  now owns viewer lazy-import deduplication, failed-import retry, stale-open and
  latest-direct-intent guards, close/refresh adapters, and terminal destruction.
  The overlay retains only its own presentation/session resources. Deterministic
  tests cover pending-import teardown, guard suppression, exact forwarding,
  overlay refusal, retry, and idempotent cleanup.
- **P2.1 collection loading extracted:** an injected DOM/storage/network-free
  coordinator now owns latest-wins load revisions, live pending-delete filtering,
  stale resolve/reject suppression, viewer-open guards, teardown invalidation,
  timing metrics, and failure dispatch. Deterministic tests cover overlapping
  loads, panel close, destroy, filter timing, render/storage errors, adapter
  refusal, and best-effort telemetry. `collection-ui.js` retains the storage,
  rendering, and French error-presentation adapters; its current 1,639 lines
  reflect the broader lifecycle/publication work completed since the 1,473-line
  audit baseline, so further extraction remains severity-driven rather than a
  line-count target.
- **P2.1 collection view contract extracted:** `collection-ui.js` no longer owns
  scattered top-level DOM lookup. An injected typed view factory now centralizes
  the panel/grid and optional toolbar/selection controls, while a deterministic
  required-element contract prevents collection initialization when either the
  panel or grid is absent. Focused tests preserve lookup ownership, stable
  missing-element reporting, and optional-control tolerance without changing the
  collection module's public API.
- **P2.1 collection output commands extracted:** front export, lazy verso export,
  and share-with-export-fallback policy now run through a strict DOM/storage/
  network-free command service with closed outcomes. Sixteen deterministic tests
  cover lazy dependency loading, exact verso order/filename, unsupported-only
  fallback, malformed results, and synchronous/asynchronous adapter failures;
  `collection-ui.js` retains translations, toasts, and local error presentation.
- **Settings/data-operation ownership hardened:** backup import/export uses a
  shared single-flight coordinator that survives locale-driven controller
  remounts. Replacement controls remain busy, object URL ownership stays with
  the operation, and detached completions cannot mutate stale DOM or emit
  duplicate toasts. Local-data reset now requires exclusive ownership: it is
  refused while capture/save, backup, publication, or deletion work is active,
  and new captures cannot persist while reset holds the data boundary.
- **P3 publication encoding hot path hardened:** supported mobile browsers now
  use the asynchronous native `FileReader` data-URL encoder instead of appending
  one JavaScript character per photo byte on the main thread. Non-browser and
  legacy environments retain a bounded 32 KiB chunk fallback with byte-exact
  tests.
- **P3 collection code splitting implemented:** the camera composition root no
  longer statically imports the collection/community/viewer/backup graph.
  Collection entry and mini-output viewer actions load it on demand with a
  user-visible recovery path. Remote-delete outbox initialization remains
  guaranteed as deferred idle work even when the collection is never opened.
  Bun ESM splitting is enabled, and the build verifier recursively counts every
  static entrypoint dependency while excluding only true dynamic imports, so
  shared chunks cannot make the initial-JS budget under-report. All chunks stay
  in the bounded offline precache; debug pages/images remain excluded. Verified
  initial JavaScript is now 456,068 bytes, down from 662,648 bytes, while total
  production output is 1,154,861 bytes. Viewer, verso, and offline color-name
  work form secondary lazy boundaries, restoring first collection content from
  1,473 ms in the first split to 463 ms with 763 ms full hydration.
- **P3 collection lifecycle hardened:** lazy gallery previews share an observer
  pool per scroll root instead of allocating one observer per card. Virtualized
  day teardown explicitly unobserves targets and releases per-card listeners and
  timers, bounding retained browser resources as large collections are scrolled.
  The lazy collection module now has an idempotent terminal destroy boundary:
  event bindings share an abort signal; settings/panel subscriptions, polling,
  stale loads, viewer opens, virtualizers, undo work, detached cards, and preview
  caches are invalidated or released. App teardown also destroys a collection
  module whose dynamic import is still pending. The viewer now has its own
  idempotent terminal destroy boundary for DOM/window listeners, subscriptions,
  RAF/idle/timeout preloads, return-focus work, and late slide/verso operations.
  Download object URLs are tracked, revoked on natural expiry, and immediately
  revoked on collection teardown. Palette preview queues, expansion-reveal
  timers, and settings backup object URLs are also cancelled/revoked by their
  owning terminal lifecycle. The viewer windows a 2,000-palette collection to
  at most five real slides plus two spacers, reuses overlap state, and loads
  verso/color-name code only on first flip. Late preview, persistence, and verso
  completions cannot repopulate disposed cache or DOM state.
- **Preview storage and maintenance hardening implemented:** current database version 7
  keeps collection metadata, authoritative master photos, regenerable gallery/
  viewer previews, durable maintenance markers, the leased community-delete
  outbox, and provisional backup-import rows in separate stores. Upgrade
  work reads palette keys first and migrates Blob-bearing records in batches of
  at most 25 inside the schema transaction, preserving both preview variants and
  pruning only unreachable asset keys. Collection listings are metadata-only;
  visible previews hydrate on demand, corrupt derived previews are invalidated
  durably, and backup export bulk-reads assets without an N+1 pattern. The legacy
  render-settings backfill checks and writes a versioned completion marker
  atomically, so repeated startups do not rescan the palette table. Normal
  startup no longer performs an orphan scan. Unit regressions cover batching,
  atomic save/delete/clear, lazy legacy repair, marker rollback/retry, and repeat
  startup. A real Chromium IndexedDB regression aborts the actual version-change
  transaction after its first preview write, proves native version/data/stores
  roll back intact, then reloads and proves the current-schema retry succeeds. Current
  palette rows are parsed through an allowlisted metadata contract; corrupt
  authoritative rows are omitted from UI reads without mutation/deletion and
  produce only throttled count-level reporting. ADR 0007 records the forward-fix
  rollback policy.
- **Additional critical browser journeys authored:** successful synthetic capture
  checks the complete extraction/photo/persistence path, and quota exhaustion
  checks user-visible failure, atomic rollback, and retry. The real extraction
  worker ignores an invalidated result and delivers the next job in Chromium and
  mobile WebKit. Its construction/runtime fallbacks leave the capture shell
  usable. Staged local deletion/undo
  and committed deletion both check palette metadata, its master photo, and both
  preview variants across reload. The development Chromium/mobile-WebKit matrix
  schedules 52 cases. The artifact-bound release subset schedules 44 cases:
  37 pass and seven are intentionally skipped because Playwright WebKit rejects
  Blob-backed IndexedDB fixtures (capture, quota recovery, publish, backup round
  trip, two historical photo migrations, and the preview-separation migration).
  The skip allowlist is enforced by the release reporter; physical iOS remains
  mandatory.
- **P2.2 partially implemented:** ambient contracts were updated to reflect current hybrid
  settings, preview variants, collection lifecycle, and viewer export behavior.
  The default `bun run typecheck` uses a production-only configuration that
  excludes tests and preprod debug tooling and passes with zero diagnostics as
  part of `bun run verify`. `bun run typecheck:all` intentionally exposes the
  remaining test-infrastructure typing backlog without making it a release
  blocker. The official pinned `@types/bun` package now supplies the test/runtime
  contracts instead of a hand-written incomplete `bun:test` shim.
  Strict null/implicit-any checking is additionally enforced for the app-view,
  live-preview timing, frame-acquisition, extraction, and origin-marker services;
  collection lifecycle, load, viewer, selection, deletion, output, and toast settlement
  services; critical-operation and service-worker-update boundaries; community
  response/session/account-owner contracts, operational metrics/client-log, and
  raster-header modules;
  modules join this strict island incrementally instead of hiding a global error
  backlog.
- **Basic mobile usability foundation implemented:** shared dialogs trap focus,
  restore keyboard openers, expose named actions, honor reduced motion, and keep
  underlying dialogs inert/hidden while a nested viewer is open. These journeys
  pass in Chromium and mobile WebKit. Accessibility beyond blocking mobile
  usability is not a product priority for this camera-first mobile PWA; blocking
  usability, contrast, motion, and screen-reader defects are still handled by
  severity.
- **Current working-tree gate result:** frozen Bun 1.3.11 install is unchanged;
  all 122 isolated test files, lint, production/strict-core typing, production
  build, artifact verification, and deterministic double-build comparison pass.
  The two identical builds produce the same hash, recorded in the generated
  release report rather than hardcoded into the source commit.
  The real interrupted-migration journey passes in development Chromium and
  against the exact current `dist`; WebKit retains its existing Blob-fixture
  skip. A manual Helium run imported the exact 148,928,389-byte backup and
  reported 193 palettes imported and opened the `1 / 193` viewer. A prior
  working-tree production artifact passed a Helium shell/empty-collection smoke;
  the clean-promotion exact-artifact repeat remains a release sign-off. The current
  exact-production automated browser baseline passed: exact-production
  UI scheduled 44 cases with 37 passes and seven WebKit Blob-fixture skips;
  production PWA passed nine cases with its preprod-only case skipped; preprod
  PWA passed all ten; and all three exact-production performance cases passed.
  The first current-schema development rerun found two stale E2E fixtures (v6
  expected instead of v7, and an ownerless remote-delete seed); both were fixed,
  and the corrected development matrix passes 45 cases with the seven existing
  WebKit Blob-fixture skips. The current exact production UI rerun passes 37
  applicable cases with seven allowlisted WebKit skips; production PWA passes
  nine applicable cases with one preprod-only skip; preprod PWA passes all ten;
  and performance passes all three cases. The self-contained `verify:release`
  command builds and verifies preprod first, including its PWA/cache-boundary
  report, then rebuilds and verifies the exact production artifact. The release
  reporter
  writes deterministic JSON summaries for every exact suite and CI retains them
  with the artifact. A current preprod build contains 227 debug files, including
  the reviewed manifest and 216 images, while its precache contains none of them;
  its non-browser verifier
  passes. The restored production build contains none of those files and passes
  the artifact verifier. `git diff --check` is clean. These results describe the
  dirty working tree, not `HEAD`; verified release evidence must be generated by
  CI from the clean promotion commit and exact artifact.
- **P3 performance baseline implemented:** production no longer deploys public
  source maps, `.DS_Store`, unused Museum/Air fonts, legacy WOFF duplicates, or
  unused font weights. The measured artifact fell from 4.24 MB to 1,080,521
  bytes and precache from 2.10 MB to 1,063,688 bytes. CI budgets now cover
  initial JS, CSS, fonts,
  cold mobile startup, long tasks, 320x240 extraction p95, and 250-capture
  collection rendering. The first throttled baseline measured 5.44 s to usable
  UI, 197 ms maximum long task, 2.70 ms extraction p95, and 4.39 s to render a
  same-day 250-capture collection. That result drove progressive idle-time card
  hydration with bounded initial batches. A prior throttled gate reached first
  collection content in 542 ms and hydrated all 250 cards in 974 ms after
  fetching the lazy collection chunk. The latest complete gate measured 250-card
  initial rendering in 911.535 ms, full hydration in 952.29 ms, usable
  UI in 4,034.98 ms, and one 64 ms long task, all inside the enforced budgets.
  Its trace also found and fixed a denial toast blocking the camera action dock
  for 4.2 seconds. The latest exact production artifact remains inside every
  budget at 4,482.370 ms to usable UI, a 137 ms maximum long task, 2.750 ms
  extraction p95, 1,009.730 ms initial 250-card rendering, and 1,080.995 ms full
  hydration. Additional exact-artifact
  profiles now enforce conservative camera-ready/preview-cadence,
  capture-to-save, first-viewer-open, one-photo backup, generated 1,000-photo
  streaming-import time/main-thread responsiveness, and coherent
  service-worker install/update/cache-cleanup budgets after four stable repeated samples. See
  `docs/PERFORMANCE_BASELINE.md`.
- **P4 release policy substantially implemented:** the supported mobile browser
  matrix and physical-device sign-off live in `docs/RELEASE_CHECKLIST.md`; the
  camera/local-photo/community/email/telemetry inventory and deletion semantics
  live in `docs/PRIVACY_DATA_INVENTORY.md`. Physical device execution, public
  privacy-notice publication, release version/changelog, and a rollback rehearsal
  remain release-owner sign-offs. Production builds now emit a deterministic
  manifest binding the artifact to the full commit, version, deploy target, Bun
  runtime, endpoints, and content-derived service-worker build ID. The release
  gate is followed in clean CI by an ignored schema-3 receipt bound to the exact
  artifact and the raw SHA-256 of all four schema-3 browser reports. Reports
  bind their exact test inventory and artifact identity; verified evidence
  independently rejects missing, extra, stale, substituted, or mutated reports,
  failed/flaky/expected-failure outcomes, and artifact/commit mismatches.
  CI uploads that record with the exact verified production `dist/`.
- **P2.2 dependency governance implemented:** package and GitHub Actions updates
  are monitored weekly, frozen-lockfile CI remains mandatory, and
  `docs/DEPENDENCY_POLICY.md` records review gates plus the exact provenance,
  license, and update procedure for vendored Dexie 4.3.0. CI grants read-only
  repository contents access and pins every third-party action to an immutable,
  version-commented commit SHA. Dexie's exact bytes are checksum-verified in CI,
  and the log-server Bun image is pinned to its reviewed multi-architecture
  registry digest with weekly Docker update monitoring.
- **P2.2 architecture decisions implemented:** `docs/adr/` records the enforced
  offline/debug-cache boundary, storage/migration invariants, worker fallback,
  telemetry/privacy boundary, and supported mobile browser contract.

> The requested plan was not present in this branch, any local branch, or any
> fetched `origin/*` ref at audit time. This document is therefore a new,
> evidence-based baseline rather than an edit of an earlier plan.

## Executive assessment

The working tree is substantially hardened rather than the unbounded initial
build, but release-candidate status still requires physical low-memory evidence
for the bounded 192 MiB streaming backup format and the clean promotion CI gate to pass.
Artifact/cache policy, the full CI gate, critical browser/PWA
journeys, storage maintenance and recovery boundaries, worker/network/camera lifecycles, telemetry
redaction, operational runbooks, privacy inventory, and synthetic performance
budgets are implemented. Release sign-off still requires executing the physical-
device matrix, publishing the public privacy notice, completing deployed
observability/operations sign-off, validating backend publication deduplication,
and validating the 192 MiB file/128 MiB decoded-photo import ceilings on
representative low-memory phones, plus severity-based review of remaining large
composition modules. The production
deployment must set `PALETCAM_LOG_API_BASE_URL`; exact production builds now reject
an absent or unsafe endpoint before modifying the artifact. Those modules
should be decomposed incrementally; their size alone is not a reason to delay a
safe release.

### Remaining engineering risks identified in the 2026-07-13 audit

These are explicit production-readiness decisions, not hidden refactoring debt:

- **P1 publication recovery/idempotency:** the client sends and validates the
  operation idempotency header, its CORS contract is verified, and local recovery
  uses a durable leased outbox. Exactly-once publication still requires external
  confirmation that the community backend enforces deduplication for that key.
- **P1 legacy remote-owner recovery:** owner binding is persisted and enforced
  for new publications. Historical remote-linked rows that predate database v7
  deliberately remain owner-unknown and cannot trigger remote mutation. A future
  backend ownership-verification contract may offer explicit recovery; the client
  must not infer ownership from the current login or from a concealed 404.
- **P1 publication encoding evidence:** the per-byte JavaScript loop is removed,
  but a throttled and physical-device benchmark at the maximum supported
  capture/request size must confirm that native data-URL encoding stays within
  the interaction budget. Move the entire request construction to a worker if
  that evidence still shows a long task or unacceptable peak memory.
- **P1 storage migration evidence:** version-5 upgrade and repeated-startup
  behavior have deterministic unit coverage, and the historical preview migration
  passes against the exact release artifact. Validate an existing large photo
  collection and the forward-fix recovery procedure on
  physical iOS Safari and Android Chrome before promotion.
- **P1 backup physical memory/quota evidence:** the module-global JSON worker now
  terminates with the app lifetime, staged commit cancellation rolls back
  atomically, and stable recovery categories provide bilingual guidance plus
  identifier-free outcome metrics. Physical low-memory Safari/Android evidence
  is still required because staging plus final commit can temporarily consume
  two logical Blob copies near the 128 MiB decoded-photo ceiling.
- **P1 log-service hardening:** production rejects the public example
  credentials, dashboard routes have a separate bounded per-IP limit, the
  container runs as the unprivileged `bun` user, and startup plus periodic
  readiness probes verify the persistent volume. Dashboard queries stream all
  strictly validated same-day rotated segments and the active file while
  retaining only their bounded tail. Deployment still must prove bind-mount
  ownership, TLS/network isolation, disk alerts, and health alerts in the target
  orchestrator.
- **P1 telemetry contract enforcement:** one app/server registry now rejects
  unknown event names, drops every non-allowlisted field at both boundaries,
  maps error names and browser families to closed categories, and keeps raw
  messages, stacks, filenames, URLs, user agents, and account/palette/request
  identifiers on-device. A strict ephemeral UUIDv4 tab-session correlation token
  is the documented sole identifier exception for reliability derivations.
- **P2/P3 follow-up evidence:** continue severity-driven extraction of the
  remaining collection renderer and live-preview origin/frozen-pin policy only
  where it reduces coupling. High-cardinality CI coverage now generates 1,000
  photo-backed entries in memory and measures the real Blob worker/staging/commit
  path without storing user images. Extend physical evidence to maximum-byte
  backup timing and peak memory on supported low-memory devices.

The phases below are ordered release gates. Do not start broad architectural
rewrites before Phase 0 has measurable acceptance criteria and regression tests.

## Initial verified baseline (before execution)

- JavaScript: 106 production source files and 39 test files.
- Largest orchestration modules: `collection-ui.js` (1,473 lines),
  `live-preview-controller.js` (875), and `app.js` (720).
- Static lint: Biome passes (198 files); Stylelint passes.
- Type checking is configured (`checkJs: true`) but TypeScript is not declared in
  `devDependencies`, so the documented/static gate cannot currently run from a
  clean install.
- All 39 unit-test files pass with Bun 1.3.11. CI currently runs tests only; it
  does not lint, type-check, build, inspect the artifact, or run browser tests.
- `public/` is about 75 MB; `public/assets/img/` is about 73 MB. The build copies
  all of it and generates a precache manifest containing every output file.
- Community API calls have a 15-second timeout. IndexedDB palette/asset writes
  and deletes use transactions. Global uncaught error reporting exists.

## Phase 0 — release blockers

### P0.1 Bound the production artifact and offline cache

Problem: `scripts/build.js` copies all public files, including approximately
73 MB of extraction/reference imagery, and then adds every output file (except
source maps and two runtime files) to `precache-manifest.json`. Install and
update can consume excessive bandwidth/storage, fail under quota pressure, and
delay service-worker activation.

Actions:

1. Define explicit production and preproduction asset allowlists. Move lab-only
   images/pages outside the production public tree or copy them only for the
   preproduction debug build.
2. Use the generated production manifest as the complete cache allowlist. Make
   HTML and every production JS/CSS output required, keep cosmetic manifest
   assets optional, and leave every path outside the manifest network-only.
   This avoids an open-ended runtime image cache while remaining bounded by the
   artifact/precache budgets.
3. Make installation fail if required shell assets cannot be cached; report
   optional precache failures separately. The present `Promise.allSettled`
   permits a partially populated cache to activate silently.
4. Add CI budgets for total `dist/`, initial JS/CSS, precache entry count, and
   precache bytes. Record the chosen thresholds in the build output.

Acceptance:

- A production build contains no debug/preview pages or extraction corpus.
- The app shell installs offline after one successful load.
- A forced optional-asset failure does not break the shell; a required-shell
  failure prevents activation of the incomplete worker.
- Artifact and precache budgets are enforced in CI.

### P0.2 Make CI the complete release gate

Actions:

1. Pin the Bun version (and document the supported version).
2. ~~Add `typescript` as a dev dependency and a `typecheck` script.~~ Done;
   resolve the existing diagnostics before adding it to `verify`.
3. Run frozen install, unit tests, Biome lint, Stylelint, typecheck, production
   build, unresolved-placeholder scan, and artifact-budget checks in CI.
4. Trigger CI for release branches (`pwa/preprod`, `pwa/prod`) as well as pull
   requests and the default branch.
5. Upload build output and test reports on failure; use dependency caching.

Acceptance: a clean checkout has one documented verification command and CI
runs the same non-mutating checks. (`check --write` must not be the CI command.)

### P0.3 Automate critical browser journeys

Unit tests cannot validate camera lifecycle, IndexedDB, service workers, canvas,
workers, or mobile viewport behavior together.

Add deterministic browser tests using a synthetic video/static image source for:

- first launch, denied permission, retry, camera switch, background/resume;
- palette capture, persistence, reload, delete/undo, export/import and corrupt
  import rollback;
- worker success, stale result rejection, worker crash/fallback;
- offline reload, update from an old service worker, and storage quota failure;
- community login/publish/unpublish with a mock server and offline retry/outbox;
- keyboard/focus behavior and reduced motion for dialogs/drawers/viewer.

Run a small cross-browser matrix (Chromium, WebKit/mobile-sized viewport) in CI
and keep real iOS Safari device smoke tests on the release checklist.

Synthetic capture, quota recovery, and real-worker success/stale-result journeys
are now covered. The browser camera-controller handoff test verifies rear-to-front
stream replacement and old-track cleanup, but the production product intentionally
has no camera-switch control, so app-level switch wiring is not applicable unless
that product decision changes. The service-worker suites perform coherent
immutable artifact A-to-B promotion in production and preprod, including
byte-changed required code, distinct build/cache identities, waiting/acceptance
behavior, and old-cache cleanup.

## Phase 1 — robustness and data safety

### P1.1 Define storage lifecycle and recovery

- Request persistent storage when appropriate and expose quota/usage diagnostics.
- Specify retention and cleanup rules for master, gallery, and viewer blobs.
- Add migration fixtures for every historical DB version and test interrupted
  migrations, corrupt records, blocked upgrades, and quota exhaustion.
- Replace read-time schema backfill in `getSavedPalettes()` with an explicit,
  idempotent migration/maintenance job. The current read path can issue one
  update per legacy palette, increasing latency and failure surface.
- Version backup schemas, validate inputs before writes, cap import size/count,
  and guarantee atomic rollback or a documented partial-import result.

### P1.2 Standardize async operations and failures

- Introduce a small shared request primitive for timeout, cancellation, safe
  response parsing, retry classification, and request correlation. Do not retry
  non-idempotent operations without idempotency support.
- Connect view/controller lifetimes to `AbortSignal`; verify all timers, media
  tracks, object URLs, worker listeners, subscriptions, and observers are
  released by `destroy()`.
- Replace silent catches in production paths with either an explicit documented
  best-effort policy or structured reporting. Never include tokens, email,
  photo data, or full URLs containing sensitive parameters in telemetry.
- Add user-facing recovery states for quota, database, worker, camera, network,
  and export failures rather than relying on console logs.

### P1.3 Establish observability and operational readiness

- Define event names and a redaction/data-retention policy for client logs.
- Add release/environment, correlation ID, failure category, and sampled timing
  metrics; cap payload and queue size.
- Measure crash-free sessions, camera-start success/latency, capture/save
  latency, worker fallback rate, IndexedDB failures, and service-worker updates.
- Add health checks, rate/body-size limits, retention/rotation, access controls,
  and deployment documentation for `services/log-server`.
- Write rollback, bad-service-worker recovery, data recovery, and incident
  runbooks. Add release smoke tests and a staged/canary rollout procedure.

## Phase 2 — clean architecture and maintainability

### P2.1 Split large modules along behavior boundaries

Refactor incrementally behind characterization tests:

- `collection-ui.js`: separate collection coordinator, data loading, selection,
  viewer orchestration, import/export commands, and DOM rendering adapters.
- `live-preview-controller.js`: separate scheduler/cadence, frame acquisition,
  extraction pipeline, origin overlay renderer, frozen-pin integration, and
  performance instrumentation.
- `app.js`: retain it as the composition root, but move DOM querying/validation
  into a typed view factory and app lifecycle/bootstrap into a testable module.

Rules:

- Domain functions do not import DOM, storage, network, or global settings.
- Adapters own browser APIs; application services coordinate use cases.
- Dependencies and clocks/schedulers are injected where deterministic tests
  need them. Avoid a generic service-locator or a framework rewrite.
- Each extraction must reduce coupling or add a testable seam; line count alone
  is not the goal.

### P2.2 Strengthen contracts and dependency governance

- Enable stricter JS checking progressively (`strict`, null checks) and remove
  broad ambient types as modules gain local contracts.
- Validate untrusted API, import, localStorage, worker-message, and IndexedDB
  payloads at boundaries. Keep internal data normalized.
- Keep Dexie deliberately vendored and follow `docs/DEPENDENCY_POLICY.md`, which
  records its exact version, license, update process, and vulnerability review.
- Dependabot monitors packages and GitHub Actions weekly. Keep CI actions pinned
  to immutable, version-commented revisions when accepting its updates.
- Keep the accepted records in `docs/adr/` current by superseding decisions with
  new ADRs when the offline, schema, worker, privacy, or browser contract changes.

## Phase 3 — measured performance and UX quality

### P3.1 Set budgets before optimizing

Measure representative low/mid-range phones and large collections. Track:

- app-shell bytes, startup/interactive time, service-worker install/update time;
- camera start, preview frame time and long tasks;
- extraction p50/p95, worker queue drops/fallbacks, capture-to-save latency;
- collection first render, scroll frame rate, blob decode memory, viewer open;
- export/import time and peak memory at defined collection sizes.

Store reproducible fixtures and baseline results. Fail CI only on stable synthetic
budgets; use field telemetry to guide device-specific work.

### P3.2 Likely optimizations after profiling

- Continue the now-established lazy-boundary pattern for settings/config and RAL
  data only when traces show startup benefit. Collection/community/viewer/backup
  code is already split from the camera entry graph, and debug features remain
  preprod-only.
- Keep metadata queries paginated/virtualized; hydrate image blobs only near the
  viewport and revoke object URLs promptly.
- Batch any remaining N+1 IndexedDB writes/reads and move heavy serialization,
  image resizing, and extraction off the main thread where measurements justify it.
- Keep the enforced import header/pixel ceiling and 2048px capture-export ceiling
  covered as formats evolve; add measured downscaling instead of raising either
  bound when legitimate device inputs require larger sources.

## Phase 4 — mobile compatibility, privacy, and release policy

- Maintain basic mobile accessibility for blocking use cases: named controls,
  focus restoration in dialogs, readable contrast, practical touch targets,
  orientation/zoom tolerance, and reduced motion. Accessibility beyond blocking
  mobile usability is not a product priority for this camera-first mobile PWA.
- Publish a supported-browser/device matrix and test camera/PWA limitations and
  graceful fallback per platform.
- Add privacy policy/data inventory for camera frames, local photos, community
  publishing, email login, and client telemetry; document deletion semantics.
- Establish semantic release versioning, changelog, migration compatibility,
  backup compatibility, and rollback criteria.

## Recommended execution order

1. P0.1 artifact/precache containment.
2. P0.2 reproducible full CI gate.
3. P0.3 browser tests for capture/storage/offline/update.
4. P1 storage recovery and lifecycle cleanup.
5. P2 incremental module extraction with characterization tests.
6. P3 profiling-driven code splitting and collection optimization.
7. P4 mobile-device, privacy, and operational release sign-off.

Production-ready means every P0 and P1 acceptance criterion is met, browser
smoke tests pass on the supported matrix, performance budgets are recorded and
met, and rollback/data-recovery procedures have been rehearsed. Phases P2–P4
may continue iteratively, but any privacy, security, supported-device, or blocking
mobile-usability defect discovered there becomes a release blocker according to
severity.
