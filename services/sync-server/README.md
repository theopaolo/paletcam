# paletcam sync-server

Private, versioned palette backup server. One directory per paired account on a
persistent volume; palettes upload as immutable versioned metadata documents
plus content-addressed photo assets, so backups are incremental by
construction: a photo uploads exactly once, and a routine flush moves only
changed kilobyte-sized metadata.

This is deliberately **backup/restore, not sync**: the server never merges,
restores are explicit, and deletes become tombstones purged only after
`TOMBSTONE_RETENTION_DAYS`.

## API

All `/v1` routes except `/v1/pair` require `Authorization: Bearer <accountId>.<secret>`.

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness + pairing state |
| `POST /v1/pair` | mint an account; returns the recovery code **once** |
| `GET /v1/manifest` | palette uids + hashes, asset hashes, tombstones, usage |
| `PUT /v1/palettes/:uid` | store `{palette, assets:[sha256]}` as a new version |
| `GET /v1/palettes/:uid` | latest metadata document |
| `DELETE /v1/palettes/:uid` | tombstone (idempotent) |
| `PUT /v1/assets/:sha256` | store a photo blob; body must match the hash |
| `GET /v1/assets/:sha256` | stream a photo blob |

The recovery code (`paletcam-<accountId>-<secret>`) is shown to the user once
at pairing and is the only way back in after a device wipe — the server stores
just the secret's hash.

## Deploying on Coolify

Create a **new application** (the log server stays untouched):

- **Source**: this repository, branch `pwa/preprod` while testing.
- **Build Pack**: Dockerfile · **Base Directory**: `/services/sync-server`.
- **Watch Paths**: `services/sync-server/**` — pushes that only touch the PWA
  won't rebuild this service.
- **Domain**: e.g. `https://ccbackup.ludique.dev`, port 3040.
- **Persistent volume**: mount at `/app/data`. This volume is the whole point
  of the service — include it in the VPS backup routine.
- **Environment**: copy `.env.example` and set `ALLOWED_ORIGINS` to the PWA
  origins. After pairing your devices, set `PAIRING_ENABLED=false`.

## Smoke test

```sh
curl https://ccbackup.example.dev/health
curl -X POST https://ccbackup.example.dev/v1/pair
# → { accountId, secret, recoveryCode } — save the recoveryCode, then:
curl -H "Authorization: Bearer <accountId>.<secret>" https://ccbackup.example.dev/v1/manifest
```
