# paletcam sync-server

Private, versioned palette backup server. Each paired account gets one
directory on a persistent volume. Palettes upload as immutable versioned
metadata documents plus content-addressed photo assets, so backups are
incremental by construction: a photo uploads exactly once, and a routine flush
moves only changed kilobyte-sized metadata.

Several devices can share one account and sync through it. The server does
not merge. A device sends each write with a precondition on the version it
last saw, and the server refuses the write with `409` when another device
changed the palette first. The device then merges locally and retries. A
deleted palette leaves a permanent tombstone in the manifest.

## API

All `/v1` routes except `/v1/pair` require `Authorization: Bearer <accountId>.<secret>`.

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness + pairing state |
| `POST /v1/pair` | mint an account and return the recovery code **once** |
| `GET /v1/manifest` | palette uids + hashes, asset hashes, tombstones (purged ones included), usage |
| `DELETE /v1/account` | delete the account and all its data |
| `PUT /v1/palettes/:uid` | store `{palette, assets:[sha256]}` as a new version, with an optional `If-Match` or `If-None-Match: *` precondition |
| `GET /v1/palettes/:uid` | latest metadata document, its hash in `ETag` |
| `DELETE /v1/palettes/:uid` | tombstone (idempotent) |
| `PUT /v1/assets/:sha256` | store a photo blob whose bytes match the hash |
| `GET /v1/assets/:sha256` | stream a photo blob |

Deleting an account renames its directory to `<accountId>.deleted`, which
revokes the credentials in one atomic step, then removes it. If the removal
fails, the sweep finishes it. The sweep runs at startup and every 24 hours.

The recovery code (`cc-<accountId>-<secret>`) is shown to the user once
at pairing and is the only way back in after a device wipe. The server stores
just the secret's hash.

## Write preconditions

`PUT /v1/palettes/:uid` takes one optional precondition header. The server
checks it under the account lock, in the same step as the write. When two
devices write against the same version, the first write succeeds and the
second gets `409`. A uid is live when it is listed in the manifest's
`palettes`. A tombstoned uid is not live.

| Header | The write succeeds when |
| --- | --- |
| `If-Match: <hash>` | the uid is live and its current hash is `<hash>`. The server accepts a bare or quoted (`"<hash>"`) hash, upper or lower case. |
| `If-None-Match: *` | the uid is not live. A tombstoned uid is revived. |
| neither | always. Older app versions rely on this. |

A failed precondition answers `409`. `current` is `null` when the uid is not
live, and `tombstoned` tells whether the uid was deleted:

```json
{ "ok": false, "error": "conflict", "current": { "hash": "<sha256>", "updatedAt": "<ISO date>" }, "tombstoned": false }
```

Any other value in these headers, or both headers at once, answers `400` with
`invalid_precondition`.

`GET /v1/palettes/:uid` returns the document hash as `ETag: "<hash>"`. The
client sends that hash back in `If-Match`, because the manifest it read earlier
may be stale by then. CORS allows both request headers and exposes `ETag` and
`Retry-After` to the PWA.

## Tombstones

`DELETE /v1/palettes/:uid` moves the uid from `palettes` to `tombstones`. Its
files and photos stay until the sweep finds the tombstone older than
`TOMBSTONE_RETENTION_DAYS`. The sweep then deletes the palette files, and
deletes the photos no other palette references, which frees their quota. The
tombstone uid stays in the manifest for good, with its `deletedAt`. A device
that was offline longer than the retention window still learns the palette was
deleted. A `PUT` on a tombstoned uid revives it, purged or not.

## Deploying on Coolify

Create a **new application** (the log server stays untouched):

- **Source**: this repository, branch `pwa/preprod` while testing.
- **Build Pack**: Dockerfile.
- **Base Directory**: `/services/sync-server`.
- **Watch Paths**: `services/sync-server/**`, so pushes that only touch the PWA
  won't rebuild this service.
- **Domain**: e.g. `https://ccbackup.ludique.dev`, port 3040.
- **Persistent volume**: mount at `/app/data`. This volume holds every
  account's data. Include it in the VPS backup routine.
- **Environment**: copy `.env.example` and set `ALLOWED_ORIGINS` to the PWA
  origins. Keep `PAIRING_ENABLED=true` while the app's Create online backup
  button should work. Set it to `false` to stop new accounts.

## Smoke test

```sh
curl https://ccbackup.example.dev/health
curl -X POST https://ccbackup.example.dev/v1/pair
# → { accountId, secret, recoveryCode }. Save the recoveryCode, then:
curl -H "Authorization: Bearer <accountId>.<secret>" https://ccbackup.example.dev/v1/manifest
```
