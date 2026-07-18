# Release evidence handoff

After all automated gates pass, generate a content-addressed evidence snapshot
from the same production `dist/` that will be promoted:

```sh
PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev bun run verify:release
bun run release:evidence --format markdown --output local-release-evidence.md
```

For the promotion handoff, generate JSON, complete its structured external
sign-offs, then validate the filled artifact:

```sh
bun run release:evidence --verified --output release-evidence.json
# Complete externalSignoffs without changing the generated automated evidence.
bun run release:evidence:validate --input release-evidence.json
```

`release:evidence:validate` requires both exact-artifact automated gates and all
external sign-offs. Each sign-off has the stable fields `status`, `owner`,
`completedAt`, `evidence`, `notes`, and `devices`. Set `status` to `complete`,
use a canonical ISO timestamp, and supply at least one evidence reference.
Physical iOS, physical Android, and exact-production manual-smoke sign-offs also
require device/OS/browser details in `devices`. A newly generated record always
keeps these human sign-offs `pending`, including when `--verified` proves the
separate automated evidence in CI.

The deterministic in-artifact build manifest records the full commit, version,
deploy target, Bun version, approved endpoints, and content-derived service-worker
build ID. On a clean promotion checkout, CI writes a GitHub Actions run-bound
`.release-gate-receipt.json` immediately after `verify:release`, binding that
completed run to the exact artifact SHA-256. `--verified` is CI-only and
requires the receipt and rejects stale/copied `dist`, commit/runtime/version
mismatches, unsafe endpoints, a dirty worktree, forbidden files, or exceeded
budgets. The generated record also includes the static initial-JavaScript graph
and structured, explicitly pending external sign-offs.

The generated sign-off record explicitly tracks physical iOS and Android checks,
production observability configuration, privacy-notice publication,
release/changelog approval, rollback/recovery rehearsal, backend idempotency-key
enforcement, and manual smoke against the exact production artifact.

The current release policy enforces both suite cardinality and the exact immutable
test inventory. The latest completed full-browser baseline after the v7
owner-binding change is 44 exact-production UI cases (37 pass, seven WebKit
Blob-fixture skips), ten production PWA cases (nine pass, one preprod-only
skip), and three passing performance cases: 57 exact-artifact cases total, with
49 applicable passes and eight allowlisted skips. Preprod PWA passes all ten
cases. Any additional, missing, substituted, failed, or flaky release-browser
case fails the gate.

The current candidate's reproducible hash is taken from the generated release
reports so it can bind the exact promotion commit without a self-referential
source edit. Its full current-schema UI, production PWA, preprod PWA, and performance reports
are complete and pass their enforced cardinality, inventory, artifact-identity,
and budget checks. They remain working-tree evidence until clean promotion CI
binds them to the uploaded artifact with a verified receipt.

The exact 148,928,389-byte legacy backup passes bounded streaming validation,
and a manual Helium run reports 193 palettes imported and opens the virtualized
`1 / 193` viewer. A prior working-tree production artifact separately passed a
Helium shell and empty-collection smoke. Physical low-memory iOS/Android
validation and the full exact-artifact repeat against the clean promotion
artifact remain external sign-offs.

Successful release suites write deterministic machine-readable summaries to
`release-reports/e2e.json`, `release-reports/pwa.json`, and
`release-reports/performance.json`; the preprod boundary additionally writes
`release-reports/pwa-preprod.json`. Each schema-3 report binds its exact test
inventory and artifact identity. Performance also records the enforced profile,
budgets, and startup, critical-journey, and service-worker measurements. The
schema-3 CI receipt binds the raw SHA-256 and artifact identity of all four
reports in canonical order. Verified evidence independently rejects missing,
extra, reordered, malformed, stale, substituted, or mutated reports.

Attach the validated JSON record to the release/deployment ticket. The release owner completes
every generated external sign-off with timestamps, owners, applicable device
versions, and evidence links. Backend-owner confirmation of idempotency-key
deduplication belongs in the generated `backendIdempotencyEnforcement` field;
that external confirmation is not inferred from passing client/CORS tests.
Record the unlocked-workstation smoke in
`exactProductionArtifactManualSmoke`. Do not edit a generated record to hide a
dirty worktree, failed forbidden-file count, or mismatched artifact; rebuild and
regenerate it from the exact promotion commit.
