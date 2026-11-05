# Paletcam production operations

## Deployment

Netlify builds both sites from git on every push. Nothing else deploys the PWA.

| Branch | Site | Contents |
| --- | --- | --- |
| `pwa/preprod` | https://preprod-colorcatchers.netlify.app | App, debug pages, source maps, reference image corpus |
| `pwa/prod` | https://app.colorcatchers.co | App only |

`scripts/build.js` reads the branch from Netlify's `BRANCH` variable, or from
`PALETCAM_DEPLOY_BRANCH` (`scripts/git-utils.js`), and `scripts/build-policy.js`
decides the output from it. A `pwa/prod` build fails unless the Netlify
environment sets `PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev`.
Preprod builds leave it empty and send no client logs. Both builds use the
backup server at https://ccbackup.ludique.dev unless
`PALETCAM_BACKUP_API_BASE_URL` overrides it.

1. Push to `pwa/preprod` (`/preprod` does this) and test on the phone.
2. Promote the tested commit: `git push origin <sha>:pwa/prod`.
3. Check what is live. `curl -s https://app.colorcatchers.co/build-manifest.json`
   shows `commit`, `deployBranch` and `buildId`. On the phone, the bottom of
   Settings shows the version and the short commit.
4. Run the smoke test below.

Merge any fix committed directly on `pwa/prod` back into `pwa/preprod`.

To check a production artifact locally, run
`PALETCAM_LOG_API_BASE_URL=https://cclogs.ludique.dev bun run build:production && bun run verify:build`.

GitHub CI (`.github/workflows/ci.yml`) runs `bun run verify:release` on pushes
to both branches. It does not deploy and does not block Netlify.

## Release smoke test

On a phone, against the site you just deployed:

1. Cold-open the site in the browser and from the home-screen app.
2. Deny camera access, then allow it and capture. Send the app to the
   background, bring it back, capture again.
3. Reload and open the saved capture.
4. Export from Settings > Data. Import the file in another browser on the
   phone, which has its own storage.
5. Publish a test capture to the community, then unpublish it.
6. Load the app online, turn on airplane mode, reload.
7. When the update toast shows, start a publication and tap Update now. The app
   should say the update will install when the current operation finishes, and
   reload only after the publication ends.
8. On prod, debug paths return 404:

   ```sh
   for p in /debug-extraction.html /components.html /app.js.map /assets/img/ /__config-preview.html; do
     curl -s -o /dev/null -w "%{http_code} $p\n" "https://app.colorcatchers.co$p"
   done
   ```

## Application rollback

Roll back when the camera fails to start, saved palettes fail to load, the
service worker fails to activate, export or import corrupts data, login loops,
or a change leaks private data.

1. Check the target. IndexedDB is at schema version 9
   (`src/palette-storage/db.js`, since ce64cfb on 2026-08-15). A build from
   before a schema bump cannot open the newer database, so fix forward instead
   of rolling back past one.
2. In Netlify, open the production site's deploys, select the last good
   `pwa/prod` deploy and publish it. Netlify serves that artifact again without
   a rebuild.
3. The old build ships a different `service-worker.js`, so phones pick it up as
   an update (next section).
4. Fix on `pwa/preprod`, test, promote. The next `pwa/prod` push replaces the
   rollback.

Do not clear users' IndexedDB or caches as part of a rollback.

## Bad service-worker recovery

How an update reaches a phone:

- The build names the cache `colorcatcher-<buildId>`, where the build ID hashes
  the precached files (`scripts/build-id.js`). Any content change ships a new
  worker.
- `src/pwa-install.js` checks for an update on load, on focus, when the app
  becomes visible, and every 5 minutes. Install fails unless `index.html`,
  `offline.html` and every precached JS and CSS file download.
- The new worker waits until the user taps Update now in the toast, and until
  any capture, publication, account deletion, backup restore or local-data
  flush ends. It then deletes every other `colorcatcher-*` cache and the page
  reloads.

Steps:

1. Stop promoting. Note the bad `buildId` from `/build-manifest.json`.
2. Publish the last good deploy in Netlify, or push a fix. Both change
   `service-worker.js`, so browsers install it as an update.
3. On a phone that has the bad worker, check that the toast appears, the update
   applies, and offline reload works.
4. Ask affected users to tap Update now, or to close every app window and
   reopen. A waiting worker also activates once no window uses the old one.
5. Clearing site data is the last resort because it deletes local photos and
   palettes. Before suggesting it, have the user export from Settings > Data, or
   check that the online backup shows every palette backed up and that they hold
   the recovery code.

## Local-data recovery

Palettes and photos live in IndexedDB (`PaletcamDB`) on the phone. The OS or a
cleaner app can wipe it. Settings > Data shows whether the browser granted
persistent storage and the date of the last export.

Before any destructive step (flush, clearing site data, reinstalling), export
from Settings > Data or check that the online backup shows N / N palettes
backed up.

Restore from the online backup:

1. In Settings > Data, paste the recovery code (`cc-…`, older codes start with
   `paletcam-`) and connect.
2. The first sync pass downloads every palette the phone lacks. Palettes
   already on the phone stay. Server entries that copy one capture (same
   capture time and colors) land once, under the lowest uid
   (`src/backup-pull.js`). The Data tab shows "Preparing N / M" while it reads
   metadata, then "Restoring N / M" while it downloads photos.
3. Large restores pause for about a minute each time the server's rate limit
   runs out, then resume. Each palette costs about two requests. Palettes are
   committed 25 at a time. An interrupted restore keeps the committed palettes,
   and the next pass downloads the rest.

Restore from an export file:

1. Keep the original file. Import it from Settings > Data > Import palettes.
2. Import adds palettes to the collection. Importing the same file twice
   creates duplicates.
3. Import stages rows in `paletteImportStaging` and commits them in one
   transaction (`src/palette-storage/import-staging.js`). A failed import
   leaves the collection unchanged. Reproduce failures in a separate browser
   profile.
4. File limits are constants at the top of
   `src/palette-storage/json-transfer.js`: 768 MiB per file, 2,000 palettes,
   16 MiB per photo, 512 MiB of photos in total, 12 megapixels per photo.

Flush all local data (Settings > Data, `src/modules/local-data-reset.js`)
clears palettes, photos, previews, storage metadata, import staging and the
community-delete outbox. It also removes every `paletcam:` key from
localStorage and sessionStorage, which includes the backup credentials, so
reconnect with the recovery code afterwards. The flush writes no backup
tombstones, so the server copy survives. It does not delete the community
account or published catches. Those have their own flows.

## Incident handling

1. Find the build: `/build-manifest.json` on the affected site, and the version
   line in Settings on the reporter's phone.
2. Open the log dashboard (https://cclogs.ludique.dev/dashboard, basic auth)
   and look at events over time and bundle versions. Only prod sends logs.
3. Decide:
   - Data loss, a photo or credential leak, or the app failing to start for
     many users: roll back now.
   - Camera, community or offline failure on a group of phones: stop promoting
     and weigh a rollback against a fix.
   - Isolated, recoverable errors: fix in the next push.
4. Write down the timeline, commit and build ID, phone, browser, installed app
   or browser tab, and reproduction steps.
5. Do not paste tokens, email codes, recovery codes, URLs carrying tokens,
   photos or raw exports into tickets or chat.

## Log service operations

`services/log-server` runs at https://cclogs.ludique.dev as a Coolify app built
from `pwa/prod`. `/health` is open. `/dashboard` and `/logs` need basic auth
and allow `DASHBOARD_RATE_LIMIT_MAX` requests per window per IP (30 by
default). `/clientlog` accepts only `ALLOWED_ORIGINS`.

Configure:

1. Start from `services/log-server/.env.example`. Set secrets in Coolify, not
   in git.
2. With `NODE_ENV=production`, startup fails unless `PUBLIC_BASE_URL` is an
   exact HTTPS origin, every `ALLOWED_ORIGINS` entry uses HTTPS, `LOG_DIR` is
   set, the dashboard credentials are set and differ from the example
   placeholders, numeric limits are in range, and `TRUST_PROXY_HEADERS=true`
   (`services/log-server/src/config.js`).
3. `ALLOWED_ORIGINS` must include https://app.colorcatchers.co.
4. Mount a persistent volume at `LOG_DIR`. The container runs as the `bun`
   user (uid 1000). A named volume inherits the image's `/app/logs` ownership.
   A host bind mount needs write access for uid/gid 1000.
5. Keep the container reachable only through the proxy. The server takes the
   client IP from the rightmost `X-Forwarded-For` entry, the one the proxy
   appends (`services/log-server/src/client-ip.js`).

Check after each deploy:

```sh
curl -s https://cclogs.ludique.dev/health
curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: https://app.colorcatchers.co" \
  -H "Access-Control-Request-Method: POST" \
  https://cclogs.ludique.dev/clientlog | grep -i access-control-allow-origin
```

`/health` returns 503 when a log write failed, the 30-second write probe on
`LOG_DIR` failed, or the write queue (`LOG_WRITE_QUEUE_MAX_PENDING`, 1,000) is
full. A full queue also makes `/clientlog` answer 503 with `Retry-After: 1`. Logs are one JSONL
file per UTC day, pruned after `LOG_RETENTION_DAYS` (30). They hold IP
addresses and origins, so back them up only within that period.

## Backup server operations

`services/sync-server` runs at https://ccbackup.ludique.dev as a Coolify app.
`services/sync-server/README.md` has the deploy settings and the API.

- The volume at `/app/data` holds the only off-device copy of every backed-up
  palette. Include it in the VPS backup routine.
- Keep `PAIRING_ENABLED=true` while users create backups from the app
  (Settings > Data > Create online backup). `POST /v1/pair` mints one account
  per call and allows `PAIR_RATE_LIMIT_MAX` (5) calls per IP per hour. Set it to
  `false` to stop new accounts. A user connects another phone with their
  existing recovery code.
- `ALLOWED_ORIGINS` must list every PWA origin that uses the backup.
- A user deletes their account from Settings > Data with `DELETE /v1/account`.
  The server renames the account directory to `<accountId>.deleted` and then
  removes it. When the removal fails, the sweep at startup and every 24 hours
  retries it. Copies in the VPS backup routine stay until that routine expires
  them.
- The server keeps only a hash of each recovery code's secret. A lost code
  cannot be recovered.
- `RATE_LIMIT_MAX` defaults to 240 requests a minute. Raising it to 600 shortens
  the pauses during large restores.
- `curl -s https://ccbackup.ludique.dev/health` should return `"ok":true` and
  `"pairingEnabled":true`.
