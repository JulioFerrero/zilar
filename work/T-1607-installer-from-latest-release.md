---
id: T-1607
title: "get.zilar.app can never drift again: on a version tag, images.yml attaches deploy/install.sh to the GitHub Release once every image is published; the landing redirects get.zilar.app (and /install.sh) to releases/latest/download/install.sh instead of baking the script into its image"
status: merged
milestone: M5
branch: task/T-1607-installer-from-latest-release
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1607: The installer comes from the latest release

## Spec (written by Claude, do not edit)

### Why
On 2026-10-15, `https://get.zilar.app` served the installer from `54633f5b9` (T-1590), from before T-1593. It had no `--desks-host`, the command the README and docs give.

**The cause:** the landing app (Coolify `uw0o7skftrbzoi7zladjn3ac`) copies `deploy/install.sh` into its image at build time (`apps/site/Dockerfile:28-29`). It is connected through Coolify's public-repo source (`source_id: 0`, no webhook), so it only rebuilds when someone deploys it by hand.

**Julio chose the fix** (2026-10-15): `get.zilar.app` redirects to the installer attached to the latest GitHub Release. The served script then always matches the newest release's images and files, with no landing redeploys.

### Facts (the lead read them on 2026-10-15, main `1f421cc28`)
- **`apps/site/Caddyfile`:**
  - `@installer host get.zilar.app` → `rewrite * /install.sh` plus `file_server`, with `Content-Type: text/x-shellscript` (`:13-19`);
  - the landing's own hosts serve `/install.sh` (`:23-27`).
- **`apps/site/Dockerfile:28-29`:** "# The one-line installer served at /install.sh (see the Caddyfile)." / `COPY deploy/install.sh /srv/zilar-site/install.sh`.
- **`.github/workflows/images.yml`** (310 lines):
  - runs on `push: tags` (`:5-6`), with top-level `permissions: contents: read` (`:21-22`);
  - jobs `tip` (`:27`) and `build` (`:57`, a matrix over the six images, `permissions: contents: read` `:68-69`);
  - the version-tag publish steps are around `:271-273`.
- **`.github/workflows/android-release.yml:206-210`** creates or updates the GitHub Release for a tag: `gh release view`, then `edit` plus `upload --clobber`, else `create`. **Both workflows run on the same tag push.**
- **The one-liner** is `curl -fsSL https://get.zilar.app | sh`. `-L` follows redirects.

### Steps
1. **`images.yml`:** add a job `installer` that runs only for a `v*` tag push, with `needs: [build]` (so it runs only after every image is published), `permissions: contents: write`, and `env: GH_TOKEN: ${{ github.token }}`.
   - It checks out the tag and uploads `deploy/install.sh` as the release asset `install.sh`.
   - **Race-safe with `android-release.yml`:** if the release exists, `gh release upload <tag> deploy/install.sh --clobber`; if not, `gh release create <tag> deploy/install.sh --title <tag> --notes "Zilar <tag>"`. If `create` fails because the release appeared meanwhile, retry once with `upload --clobber`.
   - Name the asset exactly `install.sh`. Use `deploy/install.sh#install.sh`, gh's display-label syntax, only if needed; the file name is already `install.sh`.
2. **`apps/site/Caddyfile`:**
   - for `@installer` (get.zilar.app, any path) **and** for `/install.sh` on the landing hosts: `redir https://github.com/JulioFerrero/zilar/releases/latest/download/install.sh 302`;
   - keep `Cache-Control: no-cache` on the redirect;
   - update the comments.
3. **`apps/site/Dockerfile`:** remove the `COPY deploy/install.sh` line and its comment.
4. **Docs:** in `docs/RELEASING.md`, add one paragraph to the release steps: the tag attaches `install.sh` after the images, and `get.zilar.app` follows the latest release. In `docs/INSTALL.md`, one sentence: `get.zilar.app` redirects to the latest release's `install.sh`; pin a version with `--version`.

### Tests
None (CI config and a static redirect). The lead verifies on the next tag: the release has `install.sh`, and `curl -fsSL https://get.zilar.app` equals that asset.

### Allowed files
- `.github/workflows/images.yml`
- `apps/site/Caddyfile`
- `apps/site/Dockerfile`
- `docs/RELEASING.md`
- `docs/INSTALL.md`
- `work/T-1607-installer-from-latest-release.md`

### Checks
```bash
pnpm gate
```
Also validate the Caddyfile if a `caddy` binary or image is at hand (`docker run --rm -v $PWD/apps/site/Caddyfile:/etc/caddy/Caddyfile caddy:2 caddy validate --config /etc/caddy/Caddyfile`). Say in the Report if you could not.

### Acceptance
- **The `installer` job runs only on `v*` tags**, after `build`, with `contents: write` on that job only.
- **No `COPY deploy/install.sh` is left** in `apps/site/Dockerfile`.

---

## Report (written by the worker when done)

### What I did

- **`.github/workflows/images.yml`** — added a `installer` job: `needs: [build]` (waits for the whole six-image matrix), `if: startsWith(github.ref, 'refs/tags/v')`, job-level `permissions: contents: write`, `env: GH_TOKEN: ${{ github.token }}`, `timeout-minutes: 5` (the file bounds its jobs, e.g. `tip`). It checks out the tag and attaches `deploy/install.sh` (asset name is the file's basename, `install.sh`) with the race-safe logic from the spec: `gh release view` → `gh release upload --clobber`; else `gh release create "$TAG" deploy/install.sh --title "$TAG" --notes "Zilar $TAG"`, and if `create` fails (e.g. `android-release.yml` created the release in the meantime) it retries once with `upload --clobber`.
- **`apps/site/Caddyfile`** — both the `@installer` host (`get.zilar.app`, any path) and `/install.sh` on the landing hosts now answer `redir https://github.com/JulioFerrero/zilar/releases/latest/download/install.sh 302`, each keeping `header Cache-Control "no-cache"`; removed the old `rewrite`/`Content-Type`/`file_server` lines and updated the comments.
- **`apps/site/Dockerfile`** — removed the `COPY deploy/install.sh /srv/zilar-site/install.sh` line and its comment.
- **`docs/RELEASING.md`** — added one paragraph to §2 (Tag): the run attaches `install.sh` to the tag's release once the images are published, it is race-safe with the Android release, and `get.zilar.app` follows the latest release.
- **`docs/INSTALL.md`** — added one sentence after "Running it again updates …": `get.zilar.app` redirects to the latest release's `install.sh`, pin with `--version vX.Y.Z`.

### Checks run

- `pnpm install` → `Done in 11.6s` (only the pre-existing `@types/react-dom` peer warning).
- Caddyfile validation via Docker (`caddy` binary is not installed): `docker run --rm -v $PWD/apps/site/Caddyfile:/etc/caddy/Caddyfile caddy:2 caddy validate --config /etc/caddy/Caddyfile` → `Valid configuration`. It also logs a pre-existing `caddy fmt` "not formatted" warning: the repo file uses 2-space indentation while `caddy fmt` wants tabs (the pre-change file warns identically). I kept the existing style and did **not** run `fmt --overwrite`, which would have reformatted the whole file.
- `caddy adapt` on the same file confirms the two redirects: hosts `get.zilar.app` and the landing `/install.sh` both emit `Location: https://github.com/JulioFerrero/zilar/releases/latest/download/install.sh` with the `Cache-Control: no-cache` header handler applied to the response.
- `pnpm gate` (repo root) → `GATE PASS`. Summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (2.4s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/site (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No unit tests were run: there are none near this change (the gate reports `SKIP tests @zilar/site (no nearby test files)`), as the task says.

### Notes for the lead

- The `installer` job uses a plain `actions/checkout@v7`: on a tag push the default ref is the pushed tag, as the spec asks.
- The fallback `upload --clobber` triggers on *any* `create` failure, not only the "release already exists" case. That is the spec's "retry once"; if `create` failed for another reason the `upload` fails too and the job goes red, which is the desired loud failure.
- Asset name: `deploy/install.sh` uploads as `install.sh` (basename), so the `#install.sh` display-label form is not needed.
- I could not validate with a local `caddy` binary (not installed); I used the `caddy:2` Docker image, as the task's Checks section allows.
- `get.zilar.app` now depends on the GitHub Release existing for the latest `v*` tag. Both `images.yml` and `android-release.yml` create/update it on the same tag push, and each path tolerates the other having run first, so either job finishing first is fine.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits, 1 follow-up.
- **What the lead read:**
  - **The `installer` job:** it runs only on `refs/tags/v*`, `needs: [build]` (the whole image matrix), and has `contents: write` on that job only. It uploads when the release exists, else creates it, and on a failed create falls back to upload.
  - **The Caddyfile:** both `get.zilar.app` (any path) and `/install.sh` redirect `302` to `releases/latest/download/install.sh`. The worker validated it with the `caddy:2` image.
  - **The Dockerfile:** the `COPY deploy/install.sh` line is gone.
  - **The docs** each gain one paragraph.
- **The follow-up, filed as T-1608:** `android-release.yml:206-211` has no create-lost fallback. If the installer job creates the release between Android's `view` and its `create`, the APK job fails (a rerun fixes it). Unlikely in practice: the images take about 15 minutes and the APK job about 22, so the installer job normally finishes first and Android takes its `edit`+`upload` path.
- **Rollout order (lead):**
  1. tag v0.2.1;
  2. wait until its release has `install.sh`;
  3. only then redeploy the landing by hand.
  - Before that, the redirect would point at v0.2.0, which has no `install.sh` asset.
