# Paletcam mobile release checklist

## Supported production matrix

Paletcam is mobile-first. Release support targets the current and previous major
versions of iOS/iPadOS Safari (browser and installed PWA) and current/previous
Chrome for Android (browser and installed PWA). Desktop browsers are useful for
development and fallback access but are not the primary camera support target.

## Automated gates

The checked items below describe the latest working-tree run on 2026-07-17. They
are not release evidence for `HEAD` until the clean promotion commit passes CI.

- [x] Root and log-service frozen installs succeed with Bun 1.3.11; log-service
      tests and its Docker build are part of CI.
- [x] The current preprod build verifier proves 227 debug files (including the
      exact reviewed manifest for 216 images / 76,239,782 bytes) exist only on
      preprod and are absent from the precache. The preprod PWA suite passes all
      ten cardinality-enforced cases and reconfirms the CacheStorage boundary.
- [x] The non-browser portion of
      `PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev bun run verify:release`
      passes: 122 isolated test files, lint, production/strict-core typing,
      artifact verification, and reproducible double-build identity recorded in
      the generated release report.
      The exact 193-photo legacy backup passes parser validation and manual
      Helium import and opened its 193-capture viewer. A prior working-tree
      artifact separately passed a Helium shell/empty-collection smoke. The
      current automated exact-production matrices pass: UI 37/44 with seven
      allowlisted skips, production PWA 9/10 with one preprod-only skip, preprod
      PWA 10/10, and performance 3/3. The corrected current v7 development UI
      matrix passes 45 cases with the seven existing WebKit Blob-fixture skips.
- [x] User-approved service-worker activation remains deferred while capture,
      palette/account deletion, publish/unpublish, remote cleanup, backup import,
      or local-data flush is active, then reloads only after the shared operation
      boundary is idle. A real held-capture PWA case verifies this end to end.
      A coherent immutable artifact A-to-B case proves the changed required bytes,
      content-derived build/cache identity, waiting behavior, activation, and
      removal of the superseded cache in both production and preprod.
- [x] Production contains no debug assets, image corpus, performance HUD source,
      source maps, or filesystem metadata and stays inside all byte/count budgets.
- [x] Production artifact metadata binds the full commit, version, Bun runtime,
      deploy target, approved endpoints, and content build ID. Schema-3 gate
      receipts bind the exact artifact and raw hashes of all four validated
      schema-3 browser reports, including exact inventory identities and the
      measured performance profile. They are emitted only by clean CI after the
      complete release command succeeds.
- [ ] Repeat the manual Helium smoke against the clean promotion artifact. The
      prior working-tree artifact passed the shell and collection-empty-state
      smoke; repeat the full 193-capture import/viewer check on the clean artifact.
- [ ] The clean promotion commit passes the same CI ordering and CI generates
      `release:evidence --verified` for the exact uploaded production artifact.
- [x] The corrected current-schema UI, production PWA, preprod PWA, and
      performance suites pass against the exact working-tree candidate artifact.
      Clean-CI provenance remains required by the separate promotion gate above.

## Physical-device gates

- [ ] First permission grant and denial → retry work.
- [ ] Background/foreground and screen lock/unlock recover the camera.
- [ ] Repeated captures, interrupted capture, rotation, and low-storage failure
      leave no active orphan tracks or partial palette records.
- [ ] Existing collection survives app/browser upgrade.
- [ ] Backup export/import and corrupt-import rollback work with real photos.
- [ ] Import the maximum accepted backup on a representative low-memory iPhone
      and Android device; record peak memory for the 192 MiB streamed JSON /
      128 MiB cumulative decoded-photo / 16 MiB per-photo limits. Larger
      collections require a future chunked format.
- [ ] Community login, publish, unpublish, offline cleanup retry, logout, and
      account deletion work in a test account.
- [ ] Switch between two community test accounts and confirm that v7 owner
      binding refuses cross-account unpublish, moderation, deletion, and account
      cleanup while preserving the foreign palette locally.
- [ ] Online-first then airplane-mode reload works in the installed PWA.
- [ ] Basic mobile usability remains intact: readable labels, operable controls,
      focus does not become trapped, reduced motion is respected, and zoom/text
      scaling do not block core actions. Accessibility beyond blocking mobile
      usability is not a product priority unless product/legal requirements change.
- [ ] Record the physical performance sample described in
      `docs/PERFORMANCE_BASELINE.md` and compare with the previous release.

## Operational and product gates

- [ ] Historical pre-v7 published palettes can be rebound only through a
      server-confirmed ownership claim. Until that backend contract exists,
      ownerless remote-linked palettes intentionally fail closed and cannot be
      safely unpublished or deleted locally.
- [ ] Every collection state accepted by capture and import remains fully
      exportable. Implement a chunked/segmented restorable backup, or enforce a
      collection-wide count/photo-byte policy before writes. The current
      2,000-palette / 128 MiB decoded-photo single-file envelope is an import and
      export boundary but is not yet an application storage boundary.
- [ ] Public privacy notice matches `docs/PRIVACY_DATA_INVENTORY.md`.
- [ ] Log origin allowlist, credentials, retention, rotation, persistent volume,
      TLS, health alert, and disk alert are configured.
      Validate the deployment environment against
      `services/log-server/.env.example`; production startup rejects an
      incomplete or unsafe contract. Confirm the non-root container can write
      the mounted volume, readiness reports `logDirectoryWritable: true`, and
      the dashboard rate limit matches operator refresh traffic.
- [ ] Community backend deduplication is confirmed for the verified
      `Idempotency-Key` request/CORS contract. Client transmission and recovery
      are covered, but exactly-once publication remains external until the
      backend owner supplies enforcement evidence.
- [x] The application production build requires an authorized credential-free
      HTTPS `PALETCAM_LOG_API_BASE_URL`; current health and CORS preflight probes
      pass for `https://cclogs.ludique.dev` and
      `https://app.colorcatchers.co` respectively.
- [ ] Previous verified artifact is available and rollback has been rehearsed.
- [ ] Service-worker and local-data recovery steps have been rehearsed.
- [x] Package version and changelog structure pass the automated semantic-version,
      compatibility, and known-device-limitation contract.
- [ ] Release owner approves the final version and changelog.
- [ ] Release commit, artifact measurements, smoke-test evidence, approver, and
      deployment time are recorded using `docs/RELEASE_EVIDENCE.md`.

Do not sign off while any data-loss, privacy, authentication, camera-start,
service-worker activation, or supported-device blocker remains unresolved.
