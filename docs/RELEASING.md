# Releasing and deploying to a live install

How a release goes from `main` to a running Coolify install. Written from the releases v0.1.4 to v0.1.11. Replace the placeholders with your own values (`<service-uuid>` is the Coolify service, `<server-ip>` the server, `<domain>` the public host); never put real addresses or secrets in this file.

## 1. Before tagging

1. `main` is pushed and CI is green. Look at the last runs: `gh run list --workflow CI --branch main --limit 6`. A red run needs a reason before a release (we had a flaky runner test and a test with a fixed date that expired).
2. Know what the release contains: `git log vPREV..HEAD --oneline`.
3. Migrations: `git diff vPREV..HEAD --stat -- apps/server/drizzle`. A release with a migration changes the live database on restart. Say so in the tag message and take a backup first (`./deploy/zilar backup` on the host, or the scheduled one).

Note on tagging vs auto-deploy: since T-0260 the live install updates itself on every green `main` (§9), so a tag is not what ships the server. Tags are for named milestones and for the mobile release builds (§7, §8), which are built from a commit; the everyday deploy follows `main`.

## 2. Tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: short list of what changed"
git push origin vX.Y.Z
```

A tag `v*` starts the GitHub Actions workflow "Production images": four images (postgres, ejabberd, server, web); `latest` follows the release. Watch it with `gh run list --limit 3`. It normally takes 3 to 10 minutes. If one job hangs (it once ran 53 minutes), `gh run cancel <id>` and `gh run rerun <id>`.

## 3. Restart the live service

Note the server container's hostname first (it appears as `hostname` in every server log line). Then restart with `pull_latest` so Coolify pulls the new images:

- Coolify MCP: `control` with resource `service`, action `restart`, `pull_latest: true`, uuid `<service-uuid>`; logs via `logs` with container `server`.

## 4. Verify the swap really happened

The old container keeps answering while the new one starts, so a 200 from `/health` proves nothing.

- Wait for the `hostname` in the server logs to change. That is the proof of a new container.
- Probe from outside, without DNS: `curl --resolve <domain>:443:<server-ip> https://<domain>/health` should be 200.
- Probe a route that only exists in the new version: an unauthenticated call that answers 401 (route exists) instead of 404 (old image). Examples: `/api/handles/check`, `/api/directory`.
- A migration shows in the server's startup log.

## 5. Coolify facts that cost time

- Coolify stores the compose variables as environment variables, and `env_file: .env` injects ALL stored variables into every container. Removing a variable from the compose file does not remove it from the containers: delete the stored variable too (we hit this with the old ejabberd admin password variable).
- Magic variables are `SERVICE_PASSWORD_<ID>`, `SERVICE_FQDN_WEB`, `SERVICE_URL_WEB`, with no underscore inside the id.
- Named volumes hold state: Postgres, ejabberd database and uploads, stickers, avatars. The scheduled backup (`deploy/backup-cron.example`) runs `./zilar backup`, which covers both databases and the uploads, stickers and avatars volumes; background wallpapers live inside the avatars volume, so they ride `avatars.tgz`.
- Do not rotate or print secrets while debugging; read logs through a masking filter.

## 6. If it goes wrong

Set `IMAGE_TAG` to the previous tag and restart again. A migration is not undone by that: restore the backup if the migration was destructive.

## 7. Android release build (sideload on a phone)

A "prod" Android build is a release APK with the server URL baked in at build time (`EXPO_PUBLIC_ZILAR_API_URL`, see `apps/mobile/src/lib/auth.ts`; the XMPP address comes from the server). It bundles the JavaScript, so it needs no Metro. It is signed with the standard debug key, which is fine for sideloading but not for the Play Store. Never build in the main checkout: `android/` is generated and gitignored, so use a scratch worktree.

```bash
# scratch worktree on its own branch, reset to main
cd ../<scratch-worktree> && git reset --hard main && pnpm install --frozen-lockfile
cd apps/mobile
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=<android sdk>
pnpm exec expo prebuild --platform android --clean --no-install
cd android
EXPO_PUBLIC_ZILAR_API_URL=https://<domain> NODE_ENV=production ./gradlew assembleRelease --console=plain
# about 6 minutes; output: app/build/outputs/apk/release/app-release.apk (~120 MB, all ABIs)
adb -s <device> install -r app/build/outputs/apk/release/app-release.apk
```

- Check the URL is inside: extract `assets/index.android.bundle` from the APK and grep it for `https://<domain>`.
- `@babel/plugin-transform-react-jsx` must be a devDependency of `apps/mobile` (a production bundle needs it; pnpm's strict layout does not provide it otherwise).
- A vivo phone may show a confirmation prompt on the phone for a USB install; the first `adb install` can fail with an empty message until it is accepted. A phone that shows as `unauthorized` needs the "Allow USB debugging" prompt accepted.
- Recording needs the microphone permission, which the app asks for on first use.

## 8. iOS release build (install on an iPhone)

A Release build for a real iPhone with the server URL baked in. It needs Xcode, an Apple Development certificate in the keychain, and the iPhone paired and unlocked. With a free Apple account the app stops opening after 7 days (rebuild and reinstall) and the first launch needs **Settings, General, VPN and Device Management, your Apple ID, Trust**.

```bash
cd <scratch-worktree> && git checkout --detach main && pnpm install --frozen-lockfile
cd apps/mobile
EXPO_PUBLIC_ZILAR_API_URL=https://<domain> NODE_ENV=production pnpm exec expo prebuild --platform ios --clean --no-install
cd ios && LANG=en_US.UTF-8 pod install
# find the signing team id (the OU of your certificate) and the phone's hardware id
security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
xcrun devicectl list devices -j devices.json   # hardwareProperties.udid
EXPO_PUBLIC_ZILAR_API_URL=https://<domain> NODE_ENV=production \
  xcodebuild -workspace Zilar.xcworkspace -scheme Zilar -configuration Release \
  -destination "id=<hardware-udid>" -derivedDataPath <dir> \
  DEVELOPMENT_TEAM=<team-id> CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build
# the first build compiles every pod: about 10 minutes
xcrun devicectl device install app --device <coredevice-id> <dir>/Build/Products/Release-iphoneos/Zilar.app
```

Facts that cost time: `xcodebuild -destination` wants the hardware id (`00008140-…`), `devicectl` wants the CoreDevice id (a UUID); `expo prebuild --no-install` skips CocoaPods, so run `pod install`; the Whistle transcription module is Android only and does nothing on iOS.

## 9. Auto-deploy on green main

Since T-0260, the live install updates itself after every push to `main` whose CI passes, instead of waiting for a hand-made tag. The "Production images" workflow listens for the CI workflow finishing on `main` and does nothing unless that run concluded `success`:

1. It checks out the exact commit CI verified (`workflow_run.head_sha`) and builds the four images for amd64 and arm64.
2. It pushes each image as `latest` and as `sha-<first 12 characters of the commit>`, and bakes that commit into the server image as `ZILAR_COMMIT` (see `apps/server/Dockerfile`).
3. The `deploy` job restarts the live Coolify service with "pull latest", so Coolify pulls the new `latest` images.
4. It then polls `<ZILAR_PUBLIC_URL>/health` every 15 s for up to 10 minutes until the response has `"ok": true` and `"commit"` equal to the merged sha. The job fails if that never happens.

Because merges land every few minutes, green-main builds overlap and can finish out of order, so before building a `tip` job compares the triggering sha with the current tip of `main` and a stale run skips building and deploying (it still ends green). A workflow-level `publish-main` concurrency group (`cancel-in-progress: false`) also serializes green-main runs so a newer one waits behind the run in flight, while tag and PR builds stay independent. On the CI side, a `ci-${{ github.ref }}` concurrency group with `cancel-in-progress: true` cancels an older `main` run as soon as a newer push arrives, so only a green run on the tip builds and deploys.

A `deploy-live` concurrency group (`cancel-in-progress: false`) means two merges never deploy at once: the newer run waits for the one in flight.

### Secrets and variables

Set these as repository secrets (names only):

- `COOLIFY_URL` — base URL of the Coolify instance, no trailing slash.
- `COOLIFY_TOKEN` — a Coolify API token allowed to restart the service.
- `COOLIFY_SERVICE_UUID` — the uuid of the live service.
- `ZILAR_PUBLIC_URL` — optional; defaults to `https://chat.zilar.app`. A repository variable of the same name is also accepted.

The `GITHUB_TOKEN` that Actions provides logs in to GHCR; no extra registry secret is needed.

### Pause auto-deploy

Any of these stops only the `deploy` job, while the images are still built and published:

- set a repository variable `AUTO_DEPLOY=off`; or
- delete (or rename) `COOLIFY_URL`, `COOLIFY_TOKEN` or `COOLIFY_SERVICE_UUID`.

The job logs a clear line whenever it skips.

### Roll back

`latest` follows every green `main`, so a bad merge is live shortly after. Every green build also pushes an immutable `sha-…` tag:

1. Pick the last good `sha-…` tag from the workflow run or the GHCR package page.
2. In Coolify set the stack variable `IMAGE_TAG` to that tag and restart the service.
3. Revert the bad commit on `main`; the revert's green CI publishes and deploys `latest` again.

Migrations run at server start, so rolling back the image does not undo a migration. Restore the nightly backup if the migration was destructive (see §6).

### Backups

The Coolify API can queue an immediate database backup only for a standalone database (`PATCH /databases/{uuid}/backups/{scheduled_backup_uuid}` with `backup_now: true`). A database that lives inside a service — as Zilar's Postgres does — has no "backup now" endpoint at all: `POST /services/{uuid}/databases/{database_uuid}` exposes only start, restart, stop, update, logs and import, and the service's only immediate backup is a storage-volume backup, not an engine-aware dump. Auto-deploys therefore rely on the nightly Coolify schedule in `deploy/coolify/scheduled-backup.md`; a deploy that includes a migration (`apps/server/drizzle`) does not take an extra backup. So run `./zilar backup` on the host before merging a migration that could destroy data — the deploy will not take one for you.

