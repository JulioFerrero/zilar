---
id: T-1593
title: "Installer, after Julio chose the Coolify template (2026-10-15): remove the token-based Coolify API mode (coolify-mode.sh, coolify-api.sh and its test); when Coolify is found the installer explains the template path and exits; new --desks-host runs only the AI computer host prep and sandbox check and prints the four Coolify variables with the jail image pinned by digest"
status: merged
milestone: M5
branch: task/T-1593-installer-coolify-template-path
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1593: The installer points Coolify users to the template

## Spec (written by Claude, do not edit)

### Why
Julio's decision (2026-10-15, `docs/deploy/one-line-install-plan.md` "Change of course"):
- Zilar ships on Coolify as a standard one-click template (T-1592 writes it);
- the token-based API mode is removed;
- AI computers on a Coolify host need one host command. Coolify can't install gVisor or the memory pool, so that command does the host prep and prints the variables to set in Coolify.

### Facts (the lead read them on main, 2026-10-15)
- **Coolify mode (T-1588) lives in:**
  - `deploy/lib/coolify-mode.sh` (399 lines) and `deploy/lib/coolify-api.sh` (90), with their test `deploy/tests/coolify-mode.test.sh`;
  - in `deploy/install.sh`:
    - the help at `:52-54`;
    - the exit-trap comment for `COOLIFY_TMP` at `:148`;
    - the dry-run branch lines at `:185-187`;
    - the sourcing of both libs at `:210-215`;
  - in `deploy/lib/preflight.sh`: `pf_coolify` (`:119-131`) and the decision calling `coolify_run` (`:140-144`).
- **`deploy/lib/desk-image.sh` (T-1582):** `pin_desk_image` pulls `ghcr.io/<owner>/zilar-desk:<tag>`, reads its repo digest and writes `DESK_IMAGE` into `.env`. `_desk_image_ref` builds the reference from `IMAGE_OWNER` and `IMAGE_TAG`.
- **The host prep:** `zilar host-setup` installs gVisor and the slice (`deploy/lib/host-setup.sh`).
  - T-1585's `desk_sandbox` in `deploy/install.sh` runs `docker run --rm --runtime=runsc hello-world` and keeps the first error line.
- **The four variables** the template (T-1592) reads to turn AI computers on: `DESKS_ENABLED=true`, `COMPOSE_PROFILES=desks`, `DESK_IMAGE=<repo>@sha256:<digest>` and `DESK_AGENT_SOCKET=/run/zilar/desk.sock`.
- **Keep:** `docs/deploy/coolify-api-notes.md` (CI will call `POST /deploy` for our own live site), and the `cmd_update` pin T-1588 added to `deploy/zilar`.

### Steps
1. **Delete** `deploy/lib/coolify-mode.sh`, `deploy/lib/coolify-api.sh` and `deploy/tests/coolify-mode.test.sh`. Remove every hook listed in Facts from `install.sh` and `preflight.sh`, including `ZILAR_COOLIFY_*` mentions.
2. **When Coolify is found**, after the report, print and exit 0, changing nothing:
   - "Coolify found. Install Zilar from Coolify: New Resource → Docker Compose Empty → paste https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/coolify/docker-compose.yml (or pick "Zilar" once it is in Coolify's catalog), set the domain on `web`, deploy.";
   - "AI computers on this host: `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`".
3. **New flag `--desks-host`:**
   1. on any Linux host with Docker, skip the install and run only `host-setup` (from the fetched tree), then the sandbox check;
   2. **pass:** pin the jail image the same way `pin_desk_image` does, but print the result instead of writing `.env`. Reuse `_desk_image_ref` and the pull and inspect, factoring a small "resolve the digest" helper out of `desk-image.sh` if needed. Then print the four variables as `KEY=value` lines and "set these on the Zilar service in Coolify, then redeploy";
   3. **fail:** "AI computers can't run on this host: <first error line>", exit 1;
   4. `--dry-run --desks-host` prints the plan.
   - It also works without Coolify; plain-stack users still use `--desks`.
4. **Help and docs:**
   - the `install.sh` help lists `--desks-host`;
   - `docs/INSTALL.md` describes the Coolify branch and `--desks-host`, and no longer mentions an API token.
5. **Tests in `deploy/tests/install.test.sh`:**
   - **Coolify found:** prints the template path and exits 0;
   - **`--desks-host`, sandbox passes:** prints the four variables with an `@sha256:` image, using a stub `docker` like the existing stubs;
   - **`--desks-host`, sandbox fails:** exit 1 with the reason.
6. **Size:** every shell file stays at most 400 lines.

### Tests
As in step 5.

### Allowed files
- `deploy/install.sh`
- `deploy/lib/preflight.sh`
- `deploy/lib/desk-image.sh`
- `deploy/lib/coolify-mode.sh` (delete)
- `deploy/lib/coolify-api.sh` (delete)
- `deploy/tests/coolify-mode.test.sh` (delete)
- `deploy/tests/install.test.sh`
- `docs/INSTALL.md`
- `work/T-1593-installer-coolify-template-path.md`

### Checks
```bash
sh deploy/tests/install.test.sh
sh deploy/install.sh --dry-run --desks-host
pnpm gate
```

### Acceptance
- **The Report pastes:**
  - the Coolify-found message;
  - the `--dry-run --desks-host` output;
  - the test summary;
  - `git grep -n -i "coolify_run\|ZILAR_COOLIFY\|coolify-mode"` with no hits outside `work/`.

---

## Report (written by the worker when done)

### What I did

**Deleted the token-based Coolify mode:** `deploy/lib/coolify-mode.sh`,
`deploy/lib/coolify-api.sh` and `deploy/tests/coolify-mode.test.sh`.

**`deploy/install.sh`:** removed every Coolify hook (help text, the `COOLIFY_TMP`
trap comment, the dry-run Coolify-API branch, the sourcing of both libs) and the
`ZILAR_COOLIFY_*` mentions. Added `--desks-host` (a new state flag, the arg case,
help line, and `validate_args` skips the `--yes` prompt check for it) and a
`desks_host()` step that `main()` runs instead of the install phases. On a Linux
host with Docker it runs `$_root/deploy/zilar host-setup`, the gVisor sandbox
check, then pulls the jail image and prints the four Coolify variables.
`--dry-run --desks-host` prints the plan. 399 lines (limit 400).

**`deploy/lib/preflight.sh`:** `preflight_decide` now, when Coolify is found,
prints the template path and the `--desks-host` command and exits 0 without
touching the host; `pf_coolify`'s report line was reworded. No `coolify_run`.

**`deploy/lib/desk-image.sh`:** `_desk_image_ref` now takes optional owner/tag
arguments (defaults still from the env file), and the pull + inspect + digest
check moved into a small `resolve_desk_digest` helper that `pin_desk_image` and
`install.sh --desks-host` both use. `pin_desk_image` behaviour is unchanged.

**`deploy/tests/install.test.sh`:** the Coolify-found case now checks the
template path and exit 0 and that no API token is mentioned; added a
`--desks-host` pass case (four variables with an `@sha256:` image, via a stub
`docker`), a `--desks-host` fail case (exit 1 with the sandbox reason), and
removed the obsolete "old release without the Coolify libs" case. 57 checks.

**`docs/INSTALL.md`:** the Coolify branch now describes the one-click template
and `--desks-host`; no API-token text remains; the flags table has `--desks-host`.

### Checks run

`sh deploy/tests/install.test.sh` → `pass=57 fail=0`.

`sh deploy/install.sh --dry-run --desks-host`:

```
zilar-install: dry run: printing the plan, changing nothing

==> check
    Linux; curl and tar on PATH; root or sudo.

==> fetch
    version: <latest v* tag>
    + curl -fsSL https://codeload.github.com/JulioFerrero/zilar/tar.gz/<latest v* tag> -o <tmp>/zilar.tar.gz
    + tar -xzf <tmp>/zilar.tar.gz -C <tmp>/x

==> host-setup
    + sudo <tmp>/deploy/zilar host-setup
    + sudo docker run --rm --runtime=runsc hello-world   # proves the sandbox runs
    + docker pull ghcr.io/julioferrero/zilar-desk:<version tag>, then inspect for its digest
    + prints DESKS_ENABLED=true, COMPOSE_PROFILES=desks, DESK_IMAGE=<repo>@sha256:<digest>,
             DESK_AGENT_SOCKET=/run/zilar/desk.sock
```

Coolify-found message (run offline with a stub `docker ps` and a stub
`ZILAR_INSTALL_TARBALL`; exits 0, host untouched):

```
zilar-install: Coolify found. Install Zilar from Coolify: New Resource → Docker Compose Empty → paste https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/coolify/docker-compose.yml (or pick "Zilar" once it is in Coolify's catalog), set the domain on web, deploy.
zilar-install: AI computers on this host: curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host
```

`git grep -n -i "coolify_run\|ZILAR_COOLIFY\|coolify-mode" | grep -v '^work/'` →
`NO HITS OUTSIDE work/` (the remaining hits are task/board files under `work/`).

`pnpm gate` (from the repo root):

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (1.2s)
PASS  typecheck  (1.3s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No package tests ran: no file under `apps/` or `packages/` changed (shell/docs
only). I ran no other package test.

### Notes for the lead

- The Coolify-found message used the spec's arrows; the backticks around `web`
  and around the `curl` in the spec are markdown, so the shell prints the plain
  words.
- `--desks-host` uses `IMAGE_OWNER` (default `julioferrero`) and the same
  version→tag rule as `phase_configure` (`v*` keeps its tag, else `latest`), and
  needs an existing Docker (it does not install one).
- `resolve_desk_digest` returns non-zero instead of dying, so each caller words
  its own failure; `pin_desk_image`'s messages now fold "pull failed" and "no
  digest" into one line.
- I left `docs/deploy/coolify-api-notes.md` and the `cmd_update` pin alone.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits and 1 follow-up.
- **Checks the lead ran on the branch:**
  - `sh deploy/tests/install.test.sh`: pass=57 fail=0;
  - sizes: `install.sh` 399 lines, `preflight.sh` 166, `desk-image.sh` 78;
  - `git grep` for `coolify_run`, `ZILAR_COOLIFY` and `coolify-mode` outside `work/`: no hits;
  - `sh deploy/install.sh --dry-run --desks-host` plans: fetch, `zilar host-setup`, the `--runtime=runsc` sandbox run, the jail image pull and digest, then the four `KEY=value` lines (`DESKS_ENABLED`, `COMPOSE_PROFILES`, `DESK_IMAGE`, `DESK_AGENT_SOCKET`).
- **Coolify found** (`preflight.sh:142-144`): the installer prints the template path (Docker Compose Empty plus the raw file URL) and the `--desks-host` line, then exits 0.
- **Removed:** `coolify-mode.sh`, `coolify-api.sh` and their 524-line test.
- **The follow-up** (the plan doc still described API mode) is fixed by the lead in this commit: `docs/deploy/one-line-install-plan.md` steps 5–8 now record the removal, `get.zilar.app` done, the template rehearsal done, and the volume-prefix finding for the cutover.
- **Left as they are:**
  - `--desks --desks-host` silently ignores `--desks`;
  - a test header comment doesn't name T-1593.
