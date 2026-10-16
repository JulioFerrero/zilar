---
id: T-1644
title: "CI runs the deploy checks: a new ci.yml job runs every offline deploy/tests/*.test.sh and `docker compose config -q` on the four compose files with a throwaway env file, so a broken compose or install script fails CI before it reaches a server (audit OPS-12)"
status: merged
milestone: M5
branch: task/T-1644-ci-deploy-checks
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1644: Deploy checks in CI

## Spec (written by Claude, do not edit)

### Why
Audit finding OPS-12 (`docs/audit/findings-sweep-server.md`): "no CI/gate check validates the compose files". The deploy shell tests in `deploy/tests/` don't run in CI either. `grep` finds no `deploy/tests` or `.test.sh` in `.github/workflows/ci.yml` or the gate, so they run only when a worker remembers to.

Tonight's T-1629 changed all four compose files, and their validity was only checked by hand.

### Facts (the lead read them on 2026-10-16)
- **`.github/workflows/ci.yml`** (142 lines):
  - it runs on `push` to main (`paths-ignore: ['work/**', 'docs/**', '**/*.md']`) and on `pull_request` (`:9-14`);
  - its jobs are `static` (`:26`), `typecheck` (`:45`), `test` (`:74`) and `build` (`:118`);
  - every job is `runs-on: ubuntu-latest` with a `timeout-minutes`, and starts with `actions/checkout@v7` (`:27-32`).
- **`deploy/tests/`** holds `admin-password-log.test.sh`, `connection-resilience.test.sh`, `host-setup.test.sh`, `install.test.sh`, `push-component-host.test.sh`, `push-deploy.test.sh`, `scheduled-backups.test.sh` and `storage-safety.test.sh`. T-1629's worker ran `host-setup.test.sh` and `install.test.sh` with no Docker and no env file, and both passed.
- **The compose files:** `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml` (the live one; needs `--project-directory .`, as T-1629's worker found) and `deploy/coolify/zilar-core.yml`. Required variables use `${VAR:?…}`.

### Steps
1. **Run each `deploy/tests/*.test.sh` locally** with `sh`. Keep the ones that pass offline, with no Docker daemon and no network. List any you exclude in the Report, with the reason.
2. **New script `deploy/tests/compose-config.sh`** (POSIX sh, `set -eu`):
   - write a throwaway env file in a `mktemp` dir, setting every `${VAR:?}` variable found in the four compose files to a dummy value (`x`; a value that must look like a URL or a number gets one);
   - run `docker compose -f <file> --env-file <tmp> config -q` for each of the four files (`--project-directory .` for `docker-compose.app.yml`);
   - exit non-zero on the first failure, naming the file.
3. **New job `deploy` in `.github/workflows/ci.yml`:**
   - `name: Deploy checks`, `runs-on: ubuntu-latest`, `timeout-minutes: 10`, `actions/checkout@v7`;
   - one step per kept test (`sh deploy/tests/<name>.test.sh`);
   - then `sh deploy/tests/compose-config.sh`.

   The runner already has Docker Compose v2. Install nothing else unless a kept test needs it (`jq` is preinstalled on ubuntu-latest).
4. **Change no compose file and no install script.**

### Allowed files
- `.github/workflows/ci.yml`
- `deploy/tests/compose-config.sh`
- `work/T-1644-ci-deploy-checks.md`

### Checks
```bash
sh deploy/tests/host-setup.test.sh
sh deploy/tests/compose-config.sh
pnpm gate
```
If Docker isn't available locally, say so; CI's first run on main is the proof (the lead checks it).

### Acceptance
- **The new job runs every offline deploy test and validates the four compose files.**
- **It passes on main after the merge.**

---

## Report (written by the worker when done)

### What I did

- Ran all eight `deploy/tests/*.test.sh` with `sh` locally (Docker Compose v2 is
  available, v5.5.1). Seven passed; `scheduled-backups.test.sh` failed (see below).
- Added `deploy/tests/compose-config.sh` (POSIX `sh`, `set -eu`). It discovers every
  `${VAR:?}` variable in the four compose files, writes them to a throwaway env file in
  a `mktemp -d` (`ZILAR_DOMAIN` gets `example.test`; the rest are secrets, so `x`), then
  runs `docker compose -f <file> --env-file <tmp> config -q` for each, with
  `--project-directory .` for `docker-compose.app.yml` (its build contexts are relative
  to the repo root). It exits non-zero on the first failure, naming the file.
- Added a `deploy` job to `.github/workflows/ci.yml` (`name: Deploy checks`,
  `runs-on: ubuntu-latest`, `timeout-minutes: 10`): checkout, the standard
  pnpm/action-setup + setup-node + `pnpm install --frozen-lockfile`, one step per kept
  test, then `compose-config.sh`.
- Kept six tests (all pass offline, without a Docker daemon and without network):
  `connection-resilience.test.sh` (pass=4), `host-setup.test.sh` (pass=64),
  `install.test.sh` (pass=58), `push-component-host.test.sh` (pass=2),
  `push-deploy.test.sh` (pass=25), `storage-safety.test.sh` (pass=24).
- Excluded two, with reasons:
  - `admin-password-log.test.sh` — not offline. It exits 0 only because it skips when
    `docker info` fails; with a daemon it builds an ejabberd image and runs
    `postgres:16-alpine`, so it needs a Docker daemon and network.
  - `scheduled-backups.test.sh` — fails on main before this task: `pass=45 fail=1`,
    `FAIL: coolify doc missing the schedule or the NOT-covered volumes`. The test wants
    the literal `NOT covered` in `deploy/coolify/scheduled-backup.md` (last changed in
    T-1439); the doc no longer contains it. The doc and the test are outside my Allowed
    files, so I left both alone.

### Checks run

- `sh deploy/tests/host-setup.test.sh` → `pass=64 fail=0`.
- `sh deploy/tests/compose-config.sh` → `ok` for all four compose files, exit 0. Also run
  from another cwd (absolute path) → same result.
- The other five kept tests via `sh`: `connection-resilience` pass=4, `install` pass=58,
  `push-component-host` pass=2, `push-deploy` pass=25, `storage-safety` pass=24; the six
  together take 26 s locally.
- `docker compose -f deploy/docker-compose.yml --env-file /dev/null config -q` → fails with
  `required variable ZILAR_DOMAIN is missing a value`, so the new check is meaningful.
- `pnpm gate` → `GATE PASS`, exit 0. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.7s)
  PASS  format  (2.2s)
  PASS  lint  (1.4s)
  PASS  typecheck  (1.5s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation from step 3:** the job adds `pnpm/action-setup@v6`, `actions/setup-node@v7`
  and `pnpm install --frozen-lockfile`. The spec named only `actions/checkout@v7`, but
  `push-deploy.test.sh` runs `apps/server/node_modules/.bin/tsx` and
  `storage-safety.test.sh` runs `pnpm --silent prettier`, so both fail without an install.
  The spec's "Install nothing else unless a kept test needs it" covers this. If you would
  rather keep the job dependency-free, drop those two tests and only the four shell-only
  tests plus `compose-config.sh` run.
- I read `offline` as "runs without a Docker daemon and without network". `push-deploy`
  and `storage-safety` meet that but resolve tools from the repo's `node_modules`; that is
  why the job installs. `admin-password-log` does not meet it, so it stays out.
- No compose file and no install script was changed.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.** This addresses audit finding OPS-12 (compose validation).

- **Pre-review:** clean, 1 follow-up.
- **The new `deploy` CI job** runs six offline deploy tests plus the new `compose-config.sh`. That script renders the four compose files with a throwaway env file, removed on exit.
- **The added install step is accepted:** `push-deploy` needs `tsx`, and `storage-safety` needs `prettier`.
- **Excluded, with reasons:**
  - `admin-password-log` (needs a Docker daemon and network);
  - `scheduled-backups`, which already fails on main: the test wants the literal `NOT covered` in `deploy/coolify/scheduled-backup.md`, and the doc dropped it. The lead files a follow-up task to fix the doc (it lists `ejabberd-database` as not covered, OPS-20) and add the test to this job.
- **After the merge:** the lead checks the job's first run on main.
