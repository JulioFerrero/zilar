# Releasing and deploying to a live install

How a release goes from `main` to a running Coolify install. Written from the releases v0.1.4 to v0.1.11. Replace the placeholders with your own values (`<service-uuid>` is the Coolify service, `<server-ip>` the server, `<domain>` the public host); never put real addresses or secrets in this file.

## 1. Before tagging

1. `main` is pushed and CI is green. Look at the last runs: `gh run list --workflow CI --branch main --limit 6`. A red run needs a reason before a release (we had a flaky runner test and a test with a fixed date that expired).
2. Know what the release contains: `git log vPREV..HEAD --oneline`.
3. Migrations: `git diff vPREV..HEAD --stat -- apps/server/drizzle`. A release with a migration changes the live database on restart. Say so in the tag message and take a backup first (`./deploy/zilar backup` on the host, or the scheduled one).

Note on tagging vs auto-deploy: the live install is a Coolify Application built from git, and it deploys itself on every push to `main` that touches its watch paths (§9), so a tag is not what ships the server. Tags are for named milestones and for the mobile release builds (§7, §8), which are built from a commit; the everyday deploy follows `main`.

## 2. Tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: short list of what changed"
git push origin vX.Y.Z
```

A tag `v*` starts the GitHub Actions workflow "Production images": four images (postgres, ejabberd, server, web); `latest` follows the release. Watch it with `gh run list --limit 3`. It normally takes 3 to 10 minutes. If one job hangs (it once ran 53 minutes), `gh run cancel <id>` and `gh run rerun <id>`.

Once every image is published, the same run attaches `deploy/install.sh` to the tag's GitHub Release as the asset `install.sh` (T-1607). It is race-safe with the "Android release" workflow, which creates or updates that release for the APKs. `get.zilar.app` redirects to `releases/latest/download/install.sh`, so the one-line installer always matches the newest release's images and files, with no landing redeploy.

## 3. Restart an install that runs the published images

This applies only to an install that runs the published images: a Coolify Service, or the plain stack. The git-built Application deploys itself instead (§9).

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
- Named volumes hold state: Postgres, ejabberd database and uploads, stickers, avatars. On Coolify the backup is not `./zilar backup`. A scheduled task dumps both databases nightly at 03:30, and four volume backups copy `postgres-data`, `sticker-data`, `avatar-data` and `ejabberd-uploads` to S3 between 03:40 and 04:15. Background wallpapers live inside the avatars volume, so `avatar-data` covers them. See `deploy/coolify/scheduled-backup.md` for the setup and the restore runbook.
- Do not rotate or print secrets while debugging; read logs through a masking filter.

## 6. If it goes wrong

- **The git-built Application:** revert the bad commit on `main` and push. Coolify builds and deploys the revert like any other push. For a faster rollback, redeploy an earlier deployment from the Application's Deployments list in Coolify.
- **An install on the published images:** set `IMAGE_TAG` to the previous tag (or a `sha-…` tag, §9) and restart again.

Neither undoes a migration: restore the backup if the migration was destructive.

## 7. Android release build (sideload on a phone)

A "prod" Android build is a release APK with the server URL baked in at build time (`EXPO_PUBLIC_ZILAR_API_URL`, see `apps/mobile/src/lib/auth.ts`; the XMPP address comes from the server). It bundles the JavaScript, so it needs no Metro. It is signed with the standard debug key, which is fine for sideloading but not for the Play Store. Never build in the main checkout: `android/` is generated and gitignored, so use a scratch worktree.

```bash
# scratch worktree on its own branch, reset to main
cd ../<scratch-worktree> && git reset --hard main && pnpm install --frozen-lockfile
cd apps/mobile
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=<android sdk>
pnpm exec expo prebuild --platform android --clean --no-install
cd android
# A stale Metro cache drops new expo-router routes; clear it before bundling.
rm -rf "${TMPDIR:-/tmp}/metro-cache"
EXPO_PUBLIC_ZILAR_API_URL=https://<domain> NODE_ENV=production ./gradlew assembleRelease --console=plain
# about 6 minutes; output: app/build/outputs/apk/release/app-release.apk (~120 MB, all ABIs)
adb -s <device> install -r app/build/outputs/apk/release/app-release.apk
```

- Check the URL is inside: extract `assets/index.android.bundle` from the APK and grep it for `https://<domain>`.
- `@babel/plugin-transform-react-jsx` must be a devDependency of `apps/mobile` (a production bundle needs it; pnpm's strict layout does not provide it otherwise).
- A vivo phone may show a confirmation prompt on the phone for a USB install; the first `adb install` can fail with an empty message until it is accepted. A phone that shows as `unauthorized` needs the "Allow USB debugging" prompt accepted.
- Recording needs the microphone permission, which the app asks for on first use.

## 7b. GitHub release APKs

Since T-1354 a `v*` tag (or a manual run of the "Android release" workflow) builds two
release APKs signed with Julio's private release key and publishes them as a GitHub
Release. It is the CI version of §7: no Play Store, installs in place from the browser.

### One-time key setup

The release key is Julio's alone. Create it once, keep a backup (losing it means a new
signature and a reinstall for every phone), and store the signing material as repository
secrets:

```bash
keytool -genkeypair -v -keystore ~/zilar-release.keystore -alias zilar -keyalg RSA -keysize 4096 -validity 10000
base64 -i ~/zilar-release.keystore | gh secret set ZILAR_ANDROID_KEYSTORE_BASE64
gh secret set ZILAR_ANDROID_KEYSTORE_PASSWORD
gh secret set ZILAR_ANDROID_KEY_ALIAS --body zilar
gh secret set ZILAR_ANDROID_KEY_PASSWORD
base64 -i apps/mobile/google-services.json | gh secret set ZILAR_GOOGLE_SERVICES_JSON_BASE64
```

The workflow fails early when any of the five secrets is missing; it never falls back to
debug signing.

### Cut a release

Tag and push, and the tag builds the APKs and the GitHub Release:

```bash
git tag v0.1.14
git push origin v0.1.14
```

Or run it from the Actions tab ("Android release", "Run workflow") with an existing tag.
The release carries `zilar-<tag>-arm64.apk` (any recent phone), `zilar-<tag>-universal.apk`
(all ABIs) and `SHA256SUMS`; the notes list the commits since the previous tag. Before
publishing, the job checks that both APKs are signed with the release certificate (not
`CN=Android Debug`) and that they contain the server URL.

`versionName` is the tag without `v` and `versionCode` is `major*10000 + minor*100 + patch`
(v0.1.14 → 114).

### Warning: the first install needs an uninstall

These APKs are signed with a new key, not the public debug key older builds used. A phone
that already has a debug-signed build refuses the upgrade with a signature mismatch, so
**uninstall the old app once** and then install the release APK. Later releases signed with
this key install over the top.

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

## 9. Auto-deploy from main

Since 2026-10-11 the live install is a Coolify **Application** built from git with `deploy/coolify/docker-compose.app.yml`. The GitHub Actions deploy to a Coolify Service is gone (T-1490).

- **What deploys:** Coolify's GitHub App starts a build on every push to `main` that touches one of the Application's watch paths: `apps/server/**`, `apps/web/**`, `packages/**`, `deploy/**`, the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` and `tsconfig.base.json`.
  - A push that touches only `apps/mobile/**`, `work/` or `docs/` does not deploy, and `/health` keeps the previous commit.
- **It does not wait for CI.** Every merge goes through the gate first, and CI on `main` still runs. Check it after merges with `gh run list --workflow ci.yml --branch main --limit 3`.
- **The commit is visible:** "Include source commit in build" is on, so `/health` reports the deployed commit.
- **Verify a deploy:** `/health` shows the merged commit with `"ok": true`, an authenticated route answers 401, and the server container's name changes.
- **Pause it:** turn off Auto Deploy in the Application's settings in Coolify. That is a Coolify setting, so it is the owner's call.
- **Roll back:** see §6.

### The published images

The "Production images" workflow still builds the four images for installs that run them (the plain stack and `install.sh`). It listens for the CI workflow finishing on `main` and does nothing unless that run concluded `success`:

1. It checks out the exact commit CI verified (`workflow_run.head_sha`) and builds the four images for amd64 only (the arm64 leg hung for 3h18m, run 37911863834), with the GitHub Actions build cache. Version tags still build amd64 and arm64.
2. It pushes each image as `latest` and as `sha-<first 12 characters of the commit>`, and bakes that commit into the server image as `ZILAR_COMMIT` (see `apps/server/Dockerfile`).

Because merges land every few minutes, green-main builds overlap and can finish out of order, so before building a `tip` job compares the triggering sha with the last commit on `main` that changed code (not `work/`, `docs/` or `*.md`, since docs-only pushes skip CI, T-0754) and a stale run skips building (it still ends green). A workflow-level `publish-main` concurrency group (`cancel-in-progress: false`) also serializes green-main runs so a newer one waits behind the run in flight, while tag and PR builds stay independent. On the CI side, a `ci-${{ github.ref }}` concurrency group with `cancel-in-progress: true` cancels an older `main` run as soon as a newer push arrives.

The `GITHUB_TOKEN` that Actions provides logs in to GHCR; no extra registry secret is needed. An image-based install can pin a `sha-…` tag with `IMAGE_TAG` (§6).

Migrations run at server start, so no rollback undoes a migration. Restore the nightly backup if the migration was destructive (see §6).

### Backups

Auto-deploys rely on the nightly backup (see `deploy/coolify/scheduled-backup.md`). A deploy does not take an extra backup, even when it includes a migration (`apps/server/drizzle`). Before you merge a migration that could destroy data, take an immediate backup:

1. In Coolify, open the service's Scheduled Tasks and run the dump task once (run now, or a one-off task with the same command). Check that it ends without error.
2. Run the `postgres-data` volume backup once.
3. Check that the new files are in the bucket.

The dump task covers both databases, and the `postgres-data` backup carries the dumps. The `./zilar backup` command does not apply on Coolify; it works only on the plain stack with a host checkout. Practice a restore before you need it: `docs/ops/restore-drill.md` is the step-by-step drill (both dumps, every volume archive, the secrets, a 60-minute RTO) on a scratch host.

## 10. AI computers (desks)

Desks are sandboxed AI computers (gVisor jails) that run on the install host. The `desk-agent` and `desk-egress` Compose services run in every stack and stay idle until the host has gVisor.

### A new or wiped host (plain stack)

1. The usual install. AI computers need one host prep (needs root):

   ```
   ./deploy/zilar init ...
   sudo ./deploy/zilar host-setup
   ```

   `host-setup` installs the pinned gVisor runtime, reloads Docker (a SIGHUP — the running containers keep running; never a restart), writes the 4 GB `zilar-desks.slice` and creates the workspace root. It is idempotent.

2. That is all: no variable to set and no redeploy. The desk services pick the prepared host up within about a minute.

   The jail image follows the release: the agent runs `ghcr.io/<IMAGE_OWNER>/zilar-desk:<IMAGE_TAG>`, so `./deploy/zilar update` moves it along. A digest an older `./zilar up` had pinned (`DESK_IMAGE=…@sha256:…`) is cleared on `update`; a value set by hand is kept, with a warning that it overrides the release image.

`./deploy/zilar doctor` checks the host prep and that the desk-agent socket answers `status`. A host without gVisor is a warning, not a failure: the stack is fine, computers just stay idle.

### Coolify

`host-setup` runs once on the host (it is not a container), through the same one command: `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`. The stack already runs the desk services, so there is nothing to set on the Service and no redeploy. Until the layout change (plan step 8), the Coolify app still builds `desk-agent` from git (`deploy/coolify/docker-compose.app.yml`), not from the published image.

### How it fits together

- `desk-agent` is the only service with the Docker socket; the app (`server`) never gets it and reaches the sidecar only through the `desk-socket` volume (fixed at `/run/zilar/desk.sock`).
- `desk-egress` is the only way a jail reaches the web; `desk-net` is internal.
- Both desk services run in every stack with `restart: unless-stopped` and stay idle until the host has gVisor, so there is no profile or flag that starts them and no guard.
- The gVisor runtime and the `zilar-desks.slice` pool are host pieces (`host-setup`); everything else is Compose, so a wiped VPS comes back with the usual install plus `host-setup`.

### Roll back

- Undo the host prep: delete the `runtimes.runsc` key from `/etc/docker/daemon.json` and `systemctl reload docker`; remove `/etc/systemd/system/zilar-desks.slice` and `systemctl daemon-reload`. There is a `daemon.json.bak` from the first `host-setup`. The desk services keep running and go idle again.

