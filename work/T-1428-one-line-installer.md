---
id: T-1428
title: "One-line installer: curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh — checks the host, installs Docker if missing (with consent), fetches a pinned Zilar release of deploy/, runs ./zilar init (prompts or flags), optional host-setup for AI computers, then ./zilar up and doctor"
status: merged
milestone: M5
branch: task/T-1428-one-line-installer
model: auto
effort: default
depends_on: [T-1411]
estimate: 0.6 day
---

# T-1428: One-line installer

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-15: "maybe will be a cool idea to have like a sh script like the cool selfhosted one liners". It's also his 2026-10-14 rule: a wiped VPS must come back in "one moment" (`work/` memory "replicable infra"; T-1411 made the AI computers part of `./zilar`).

**The goal:** a fresh Debian or Ubuntu box goes from nothing to a running Zilar with one command.

### Facts (the lead checked them on main, 2026-10-15)
- **The installer CLI** is `deploy/zilar` (POSIX `sh`, about 1,400 lines, `--dry-run`, never prints secrets).
  - `init` takes `--domain`, `--admin-email`, `--acme-email`, `--image-owner`, `--image-tag`, `--http-port`, `--https-port`, `--push-subject`, `--no-push` and `--force` (`deploy/zilar:153-154`, parsed at `:207-235`).
  - The official images are public at `ghcr.io/julioferrero` (`:252`), and `--image-owner` is required (`:275`).
  - The other commands are `up`, `doctor`, `host-setup` (T-1411) and `create-admin`.
- **Compose** is `deploy/docker-compose.yml`, with images from GHCR (`:17-21`).
- **Install docs** are `docs/INSTALL.md`, linked from `README.md:134`.
- **Deploy tests** are `deploy/tests/*.test.sh` (for example `host-setup.test.sh`).
- **The repo is public:** `https://github.com/JulioFerrero/zilar`.

### What to build
1. **`deploy/install.sh`** (new, POSIX `sh`, `set -eu`, at most 400 lines). It's safe to pipe from `curl`: the whole body is a `main` function called on the last line, so a cut-off download runs nothing.
   - **Flags and env:** `--version <tag|main>` (default: the latest `v*` tag, via the GitHub API with a fallback to `main`), `--dir` (default `/opt/zilar`), `--domain`, `--admin-email`, `--desks` (also run `host-setup`), `--yes` (no prompts, for automation) and `--dry-run`.
   - **Checks:**
     - Linux x86_64 or arm64; root or sudo available;
     - free disk of at least 10 GB and RAM of at least 2 GB (warn under 4 GB);
     - ports 80 and 443 free;
     - `curl` and `tar` present.
   - **Docker:** if it's missing, ask "Install Docker with get.docker.com? [y/N]" (`--yes` accepts). Never install anything without consent.
   - **Fetch:** download the release tarball for the chosen version from `codeload.github.com` over https, extract **only `deploy/`** into `--dir`, and print the version and commit.
   - **Configure:** run `./zilar init` with the flags given, or let it prompt; pass `--image-owner julioferrero` and `--image-tag` matching the version.
   - **Optional:** with `--desks` (or a "y" to "Enable AI computers? [y/N]"), run `sudo ./zilar host-setup`. Say clearly that this installs gVisor and changes Docker's config, with a reload and no restart.
   - **Start:** `./zilar up`, then `./zilar doctor`. Finish with the URL and the next step (`./zilar create-admin`).
   - **It never prints secrets** (follow `deploy/zilar`'s rules) and is idempotent: running it again on an installed dir updates `deploy/` and keeps `.env`.
2. **`deploy/tests/install.test.sh`:** `--dry-run --yes --version main --dir <tmp>` prints the planned steps in order; with `--desks` it includes `host-setup`; a missing `--domain` with `--yes` fails clearly. No network in the test: stub the fetch with an env var that points to a local tarball.
3. **Docs:**
   - **The `README.md` install line** becomes `curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh`, with a one-sentence note: "read the script first", and a link to it;
   - **`docs/INSTALL.md`:** a "One line" section at the top, listing what it does, the flags, and how to run it non-interactively.

### Tests
The deploy test above; `shellcheck` if it's installed (say so in the Report).

### Allowed files
`deploy/install.sh`, `deploy/tests/install.test.sh`, `README.md`, `docs/INSTALL.md`, `work/T-1428-one-line-installer.md`.

### Checks
```bash
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- The gate and the test pass, and `deploy/install.sh` is at most 400 lines.
- A `--dry-run` from a clean temp dir reads like a clear plan.

---

## Report (written by the worker when done)

### What I did

- Added `deploy/install.sh` (POSIX `sh`, 395 lines, executable): the whole body is functions
  plus a single `main "$@"` on the last line, so a cut-off download runs nothing. It parses
  `--version`, `--dir`, `--domain`, `--admin-email`, `--desks`, `--yes`, `--dry-run` and
  `--help`, then runs the six phases `check`, `docker`, `fetch`, `configure`, `host-setup`
  (only when enabled), `up` and `doctor`.
  - **checks**: Linux x86_64/arm64, root or `sudo`, >=10 GB free disk, >=2 GB RAM (warns under
    4 GB), ports 80/443 free (`ss`, else `netstat`), `curl` and `tar`.
  - **Docker**: skips when `docker compose version` works; otherwise asks
    "Install Docker from get.docker.com?" (`--yes` accepts) before running the installer.
  - **fetch**: latest `v*` tag from the GitHub API, fallback `main`; downloads
    `https://codeload.github.com/JulioFerrero/zilar/tar.gz/<ref>`, extracts into a temp dir and
    copies **only** `deploy/` into `--dir` (a tarball has no `.env`, so an existing one is kept);
    prints the version and (via the API) the commit, `unknown` when it cannot be resolved.
  - **configure**: `./zilar init` with `--domain`/`--admin-email` only when given (otherwise init
    prompts) plus `--image-owner julioferrero --image-tag <tag>`; an existing `.env` is kept
    untouched, which is what makes a re-run idempotent.
  - **host-setup**: `--desks` or a `y` at the "Enable AI computers?" prompt; says it installs
    gVisor and changes Docker's config, reload (SIGHUP) never restart, then `sudo ./zilar host-setup`.
  - **start**: `./zilar up`, then `./zilar doctor` (a doctor failure warns and exits 1). It never
    prints a secret (it only ever runs `zilar`, which owns the env file), and it never writes one.
- Added `deploy/tests/install.test.sh` (POSIX `sh`, offline, 25 checks): plan order, `--desks`
  adding host-setup before `up`, `--yes` without `--domain` failing clearly, the
  `ZILAR_INSTALL_TARBALL` stub (plan never names codeload), a **real** run end to end with the
  stub tarball + a stub `docker` (asserts `deploy/` is extracted and the stub `zilar` is driven
  with `init … --image-owner julioferrero --image-tag main`, then `up`, then `doctor`, all
  offline), `.env` kept on a re-run, the 400-line limit, `sh -n`, and cut-off safety.
- `README.md`: the Quick start now shows the one-line `curl … | sh`, a "read the script first"
  note with a link to `deploy/install.sh`, and keeps the link to the install guides.
- `docs/INSTALL.md`: a "One line" section at the top — what it does (6 steps), a flag table, and
  a non-interactive `sh -s -- --yes …` example.

### Deviations from the spec (two, both deliberate)

1. **`--yes` also requires `--admin-email`** (the spec only names `--domain`). `zilar init` has no
   default admin email, so without it `--yes` would fall through to an `init` prompt — the opposite
   of "no prompts". Domain is checked first, so the spec's "missing `--domain` with `--yes`" case
   still fails on the domain.
2. **Added one test-only env var, `ZILAR_INSTALL_SKIP_CHECKS=1`**, which skips the host checks. The
   spec asks for a real fetch test stubbed with a local tarball, but those checks (Linux,
   `/proc/meminfo`, free ports) can never pass on the macOS dev/CI machine, so the stub alone
   could not drive a real run. This mirrors `deploy/zilar`'s existing test-only overrides
   (`COMPOSE_FILE_OVERRIDE`, `COMPOSE_PROJECT_NAME`) and is documented in the script header. No
   other env var was added.

I read "with `--desks` it includes `host-setup`" as a variant of the first (plan) invocation, so
the plan tests pass `--domain`; the missing-domain case is a separate invocation.

### Commands I ran (real results)

- `pnpm install` — Done (17 projects).
- `sh deploy/tests/install.test.sh` — `pass=27 fail=0` (all checks; the real-run case is
  offline: stub tarball + stub `docker`).
- `pnpm gate` (from the repo root): `GATE PASS` —

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.5s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

- `sh -n deploy/install.sh` — clean.
- `wc -l deploy/install.sh` — 395 (limit 400).
- `shellcheck` — **not installed on this machine**, so I could not run it (the spec says to say
  so). The scripts are POSIX `sh` and `sh -n` passes.

### Changed files

`deploy/install.sh` (new), `deploy/tests/install.test.sh` (new), `README.md`, `docs/INSTALL.md`,
`work/T-1428-one-line-installer.md` — all inside the Allowed files.

**Lead review fix (image tag):** `main` (and the latest-tag fallback) now installs
`--image-tag latest` while a `v*` release keeps its own tag — CI never publishes `:main` — and the
`deploy/` tarball is still fetched from the chosen version; both cases are covered by new test
cases (`deploy/tests/install.test.sh` now passes 27 checks).

### Not done / not verified

- `shellcheck` (above).
- No live run on a real Debian/Ubuntu host (no such host here); the checks, the get.docker.com
  step, `sudo ./zilar host-setup` and the real codeload download are covered by the dry-run plan
  and by the offline real run with the stubbed tarball, not by a live install.

### Round (fix round, 2026-10-15)

Findings **1** and **2** (both should-fix) fixed; nits 3–5 left alone.

- **Finding 1 (`--yes` still prompts):** `phase_configure` now also passes
  `--acme-email "$ADMIN_EMAIL"` and `--push-subject "mailto:$ADMIN_EMAIL"` under
  `--yes`. I used the finding's `--push-subject` alternative rather than
  `--no-push`: it suppresses the prompt while keeping push on with the same
  default an interactive Enter-through install gets. Tests: the real-run init
  assertion now expects the two flags, plus a dedicated check
  “--yes passes init the ACME email and push subject (no prompts)”.
- **Finding 2 (`finish()` printed localhost):** `finish()` now reads
  `ZILAR_DOMAIN` back from `$DIR/.env` when `--domain` was not given. Test: new
  section 5b runs with no `--domain` and a pre-made `.env`, asserting the final
  message is `https://chat.example.com` and not `https://localhost`.
- `deploy/install.sh` still fits the 400-line limit (now exactly 400; both fixes
  are one-liners with trailing comments).

Tests added: two (one per finding); one existing check updated (the real-run
init flags). `sh deploy/tests/install.test.sh`: `pass=31 fail=0` (was 27).

`pnpm gate` (repo root): `GATE PASS` — 5 changed files against main;
install/format/lint/typecheck PASS; scope clean.

No disagreements. Nits 3–5 (plain-root `sudo` in `phase_desks`, the stubbed-init
test gap, the stale Report numbers above) were left untouched as nits; the new
finding-1 assertion is what closes the practical part of nit 4.

### Round (PREREVIEW fix round, 2026-10-15)

PREREVIEW.md lists must-fix=0, should-fix=1 (S1), nit=2 (N1, N2).

- **S1 (should-fix) fixed:** `phase_desks` prefixed `sudo` unconditionally, so a
  root host without the `sudo` package (a minimal image) passed `check_host`
  and then died at `sudo: command not found` after fetch/configure. The `sudo`
  prefix is now conditional: `if [ "$(id -u)" -eq 0 ]; then run "$DIR/zilar"
  host-setup; else run sudo "$DIR/zilar" host-setup; fi`. One-line change, so
  `deploy/install.sh` stays at 400 lines.
- **S1 reworked by the lead's decision (the get.docker.com way):** `resolve_sudo`
  sets `SUDO` (empty as root, `sudo` when present, else `die`); every privileged
  step is prefixed — the get.docker.com install, `$SUDO mkdir`/`cp` into `--dir`,
  and `init`/`up`/`doctor`/`host-setup` — and `--dry-run` prints the prefix. A new
  non-root test (section 2c) stubs `id` to a non-zero uid; `sh
  deploy/tests/install.test.sh`: `pass=35 fail=0`.
- **N1, N2 (nits) left untouched:** their lines are not lines this change
  touches (`finish()`'s success framing; fail-fast for non-root).
- **Tests added:** one (section 2b in `deploy/tests/install.test.sh`), as the
  finding describes the root path: a stub `id` reports uid 0 and the `--desks`
  dry-run must plan `zilar host-setup` directly, never `sudo zilar host-setup`.
  `sh deploy/tests/install.test.sh`: `pass=32 fail=0` (was 31).
- **Round-2 PREREVIEW (S1, S2) fixed:** S1 downloads get.docker.com to a temp file (`|| die "could not download the Docker installer"`) before running it, so a dead network stops at the docker step instead of sailing on to fetch; S2 makes `finish()` prefer the kept `.env`'s `ZILAR_DOMAIN` and warn when `--domain` differs. Tests 2d and 5c; `sh deploy/tests/install.test.sh`: `pass=40 fail=0`, `pnpm gate`: `GATE PASS` (header trimmed so install.sh stays at 400 lines).

`pnpm gate` (repo root): `GATE PASS` — 5 changed files against main;
install/format/lint/typecheck PASS; scope clean; migration/images checks pass.

No disagreements.

## Review (written by Claude)
Lead, 2026-10-15: approved after 3 lead rounds and 2 auto rounds. Pre-review CLEAN, nit 5.
- Lead round 1: `--version main` used image tag `latest` (CI never publishes `:main`).
- Lead round 2: non-root plus sudo prefixes every privileged step (the get.docker.com pattern).
- Lead round 3: a failed Docker download dies early, and a re-run prints the kept `.env` domain.
- The lead ran `deploy/tests/install.test.sh` locally (40 pass) and read the dry-run plan. `deploy/install.sh` is exactly 400 lines.
- Next: get.zilar.app (a Caddy host rule plus a Coolify domain) once Julio adds the Porkbun A record.
