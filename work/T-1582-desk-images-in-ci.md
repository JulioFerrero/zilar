---
id: T-1582
title: "One-line install step 1 (docs/deploy/one-line-install-plan.md): CI publishes the AI computer images zilar-desk-agent and zilar-desk to GHCR; the plain stack pulls desk-agent/desk-egress instead of building from source; ./zilar up pins DESK_IMAGE to the published jail image's digest when desks are on and DESK_IMAGE is empty"
status: merged
milestone: M5
branch: task/T-1582-desk-images-in-ci
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1582: AI computer images in CI

## Spec (written by Claude, do not edit)

### Why
`docs/deploy/one-line-install-plan.md` step 1. Today `--desks` cannot work on the plain install:
- `deploy/install.sh` copies only `deploy/` to `/opt/zilar`;
- `desk-agent` and `desk-egress` are built from source (`deploy/docker-compose.yml:300-305` and `:355-360`: `build: context: ..`, `dockerfile: deploy/desk/Dockerfile.agent`, which copies `packages/desk` and the lockfile);
- no CI job builds the jail image.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **`.github/workflows/images.yml`** ("Production images", 282 lines): the matrix at `:73-87` builds `zilar-server`, `zilar-web`, `zilar-postgres` and `zilar-ejabberd`.
  - It publishes `latest` after a green CI on main (`:8-12`, the `tip` job). Version tags also build arm64 (`:94-99`).
- **The jail image** is `packages/desk/Dockerfile`: a pinned `node:24-bookworm-slim@sha256:…` base, with `COPY dist/desk-tool /opt/desk/desk-tool`. `dist/` comes from `pnpm --filter @zilar/desk build` (`packages/desk/package.json:12`, `node build.mjs`).
- **The sidecar image** is `deploy/desk/Dockerfile.agent` (multi-stage, context = repo root). `desk-agent` and `desk-egress` both run it, with different `command:`.
- **`DESK_IMAGE` must be pinned by digest**, or the agent refuses (`packages/desk/src/agent/config.ts:84-86`, unless `DESK_ALLOW_UNPINNED_IMAGE=true`). The `.env` template in `deploy/zilar:470-490` says to build and push it by hand.
- **Images:** the plain stack's server and web use `ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-server:${IMAGE_TAG:-latest}` (`deploy/docker-compose.yml:110`, `:240`).
- **`./zilar up`** adds `--profile desks` when `DESKS_ENABLED=true` (`deploy/zilar:87-92`).

### Steps
1. **`images.yml`:** add two matrix entries, `zilar-desk-agent` (file `deploy/desk/Dockerfile.agent`, context `.`) and `zilar-desk` (file `packages/desk/Dockerfile`, context `packages/desk`), using the same tagging as the others.
   - The jail image needs `dist/desk-tool` first. Either add a builder stage to `packages/desk/Dockerfile` that runs the desk build, or add a workflow step that builds it only for that entry. **Keep the jail's runtime base image and contents the same.**
2. **`deploy/docker-compose.yml`:** `desk-agent` and `desk-egress` use `image: ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk-agent:${IMAGE_TAG:-latest}`, and the `build:` blocks go. Change nothing else in those services.
3. **New `deploy/lib/desk-image.sh`, sourced by `deploy/zilar`** the way `lib/host-setup.sh` is (`deploy/zilar:50-51`).
   - **When:** `./zilar up` runs with `DESKS_ENABLED=true` and `DESK_IMAGE` empty.
   - **Then:**
     1. pull `ghcr.io/<IMAGE_OWNER>/zilar-desk:<IMAGE_TAG>`;
     2. read its repo digest (`docker image inspect --format '{{index .RepoDigests 0}}'`);
     3. write `DESK_IMAGE=<that>` into `.env`;
     4. print one line saying so.
   - **On failure:** a pull or inspect failure stops `up` with a clear message. Never write a tag without a digest.
4. **`deploy/zilar` `.env` template (`:470-490`):** the `DESK_IMAGE` comment says `up` pins it automatically from the published image. A hand-set value still wins.
5. **`docs/RELEASING.md` §10:** replace "Build and pin the jail image" with the automatic pin, keep the Coolify note, and say the Coolify app still builds `desk-agent` from git until the layout change (plan step 8).
6. **Leave alone:**
   - `deploy/coolify/docker-compose.app.yml` (live; it changes in plan step 8);
   - `deploy/install.sh` (T-1585 changes it).

### Tests
None new. `sh deploy/tests/install.test.sh` and `sh deploy/tests/host-setup.test.sh` must still pass.

### Allowed files
- `.github/workflows/images.yml`
- `packages/desk/Dockerfile`
- `deploy/docker-compose.yml`
- `deploy/zilar`
- `deploy/lib/desk-image.sh` (new)
- `docs/RELEASING.md`
- `work/T-1582-desk-images-in-ci.md`

### Checks
```bash
sh deploy/tests/install.test.sh
sh deploy/tests/host-setup.test.sh
docker build -f deploy/desk/Dockerfile.agent -t zilar-desk-agent:check .
pnpm gate
```
Also build the jail image locally the way the workflow will: the builder stage, or `pnpm --filter @zilar/desk build`, then `docker build -t zilar-desk:check packages/desk`.

### Acceptance
- **Both images build locally:** give their sizes from `docker image ls`.
- **The workflow diff:** two new matrix entries and, if used, the build step.
- **`docker compose -f deploy/docker-compose.yml --profile desks config`** shows both desk services with the ghcr image and no `build:`.
- **The Report gives the pin's dry run:** what the new helper prints and writes, with a stub or a real pull of a public image.

---

## Report (written by the worker when done)

### What I did

Step 1 — `.github/workflows/images.yml`: added two matrix entries, `zilar-desk-agent`
(`file: deploy/desk/Dockerfile.agent`, `context: .`) and `zilar-desk`
(`file: packages/desk/Dockerfile`, `context: packages/desk`), using the same tagging
as the other entries. `dist/desk-tool` is gitignored and no other image needs it, so I
took the spec's second option: three `if: matrix.name == 'zilar-desk'` steps before
the build steps (`pnpm/action-setup@v6`, `actions/setup-node@v7` with
`node-version-file: .nvmrc` + pnpm cache, then `pnpm install --frozen-lockfile` and
`pnpm --filter @zilar/desk build`). `packages/desk/Dockerfile` is unchanged: its
runtime base and contents stay exactly the same, and `packages/desk/.dockerignore`
does not exclude `dist`.

Step 2 — `deploy/docker-compose.yml`: `desk-agent` and `desk-egress` now use
`image: ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk-agent:${IMAGE_TAG:-latest}`;
both `build:` blocks and the `image: zilar-desk-agent:local` lines are gone. Nothing
else in those services changed.

Step 3 — new `deploy/lib/desk-image.sh`, sourced by `deploy/zilar` next to
`lib/host-setup.sh`. It defines `pin_desk_image`, called from `cmd_up` after
`require_env_file`/`require_docker`, before `compose up`. It is a no-op unless
`DESKS_ENABLED=true` and `DESK_IMAGE` is empty; otherwise it pulls
`ghcr.io/<IMAGE_OWNER>/zilar-desk:<IMAGE_TAG>` (defaults `julioferrero`/`latest`),
reads `docker image inspect --format '{{index .RepoDigests 0}}'`, requires an
`@sha256:` in the result, and writes `DESK_IMAGE=<repo>@sha256:<digest>` into the env
file in place (preserving mode 0600). A pull or digest failure calls `die`, so `up`
stops and no tag is ever written. In `--dry-run` it prints the pull, the inspect and
the write without running them.

Step 4 — `deploy/zilar` `.env` template: the `DESK_IMAGE` comment now says `./zilar up`
pins it automatically from the published image and that a hand-set value wins; the
"how to turn desks on" list no longer tells the user to build/pin by hand.

Step 5 — `docs/RELEASING.md` §10: replaced "Build and pin the jail image" with the
automatic pin (plain stack), kept the Coolify paragraph and added that the Coolify app
still builds `desk-agent` from git until the layout change (plan step 8).

Step 6 — untouched: `deploy/coolify/docker-compose.app.yml`, `deploy/install.sh`.

Spec deviation: I did not change `packages/desk/Dockerfile` (it is in Allowed files but
the spec offers a workflow step as an equal alternative), and I changed no tests
(none new, per spec).

### Checks run

- `sh deploy/tests/host-setup.test.sh` → `pass=44 fail=0`.
- `sh deploy/tests/install.test.sh` → `pass=40 fail=0`.
- `docker build -f deploy/desk/Dockerfile.agent -t zilar-desk-agent:check .` → built OK.
- `pnpm --filter @zilar/desk build` (96ms, `dist/desk-tool` 693.9kb) then
  `docker build -t zilar-desk:check packages/desk` → built OK.
- `docker image ls`: `zilar-desk-agent:check 302MB`, `zilar-desk:check 904MB`.
- `docker compose -f deploy/docker-compose.yml --env-file <scratch> --profile desks config`
  → `desk-agent: image: ghcr.io/testowner/zilar-desk-agent:latest` and
  `desk-egress: image: ghcr.io/testowner/zilar-desk-agent:latest`; neither block has a
  `build:` (the two `build:` in the rendered file are the pre-existing ejabberd and
  postgres services). Renders with `config OK`.
- Pin dry run (`--env-file=<scratch> --dry-run up`, `DESKS_ENABLED=true`, empty
  `DESK_IMAGE`), real output:
  ```
  + docker pull ghcr.io/testowner/zilar-desk:latest
  + docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/testowner/zilar-desk:latest
  + write DESK_IMAGE=<repo>@sha256:<digest> to <env file>
  ```
  and the env file is left untouched (only the `# DESK_IMAGE=` template line exists).
- Pin real run with a stub `docker` (pull OK, inspect prints a digest):
  ```
  zilar: desks are on and DESK_IMAGE is empty; pulling ghcr.io/testowner/zilar-desk:latest to pin its digest
  zilar: pinned DESK_IMAGE=ghcr.io/testowner/zilar-desk@sha256:000…000 in <env file>
  ```
  A second `up` prints no pull (hand-set value wins: appending a `DESK_IMAGE=` line
  also suppresses the pull). With the stub's `pull` exiting 1, `up` exits 1 with
  `zilar: error: cannot pull the jail image ghcr.io/testowner/zilar-desk:latest — …`
  and nothing is written to the env file.
- `pnpm exec prettier --check .github/workflows/images.yml deploy/docker-compose.yml` →
  "All matched files use Prettier code style".
- `pnpm gate` (from the repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (0.6s)
  PASS  lint  (2.1s)
  PASS  typecheck  (1.6s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Files changed

- `.github/workflows/images.yml`
- `deploy/docker-compose.yml`
- `deploy/lib/desk-image.sh` (new)
- `deploy/zilar`
- `docs/RELEASING.md`
- `work/T-1582-desk-images-in-ci.md` (status/report)

### Notes for the lead

- The jail build happens on every event the matrix runs (PR included), so a broken
  `@zilar/desk` build fails CI before a tag.
- `zilar-desk`'s image is ~904MB (build-essential, python3, git, ripgrep in the pinned
  `node:24-bookworm-slim` base), so a green-main push publishes a ~904MB layer set per
  commit. That is existing behaviour of the pinned base; flagging it in case you want a
  slimmer jail later.
- The Coolify app still builds `desk-agent` from git (`deploy/coolify/docker-compose.app.yml`,
  unchanged) and never runs `./zilar`, so it does not auto-pin `DESK_IMAGE`; the doc
  now says so. It changes in plan step 8.
- `deploy/install.sh` copies the whole `deploy/` tree, so `deploy/lib/desk-image.sh`
  ships with the plain install (T-1585 owns install.sh itself).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits and 1 follow-up.
- **What the lead checked:**
  - **`images.yml`:** two matrix entries (`zilar-desk-agent` from `deploy/desk/Dockerfile.agent`, `zilar-desk` from `packages/desk`).
    - The desk tool bundle is built only for the jail entry.
    - Its pnpm and setup-node actions are the versions `ci.yml` already uses (`pnpm/action-setup@v6`, `actions/setup-node@v7`).
  - **The plain compose:** `desk-agent` and `desk-egress` pull `ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk-agent:${IMAGE_TAG:-latest}`, with no `build:` left.
  - **`deploy/lib/desk-image.sh`:** `pin_desk_image` acts only when desks are on and `DESK_IMAGE` is empty.
    - It pulls, reads the repo digest, and refuses anything without `@sha256:`.
    - The env rewrite keeps the file's mode (it writes through `cat >`).
  - **Local builds** (worker): `zilar-desk-agent` 302 MB and `zilar-desk` 904 MB.
- **After merge:** the next green-main "Production images" run must publish both images. The lead checks that run.
- **Follow-ups:**
  - `deploy/.env.example:194-213` still says to build and pin by hand. Fix it with the Coolify-mode task;
  - `./zilar update` doesn't pin (nit 2). Fix it in the same task;
  - **arm64 tag builds:** the 904 MB jail image goes through QEMU. Watch the next `v*` tag build for time, since the QEMU leg hung once before (run 37911863834).

