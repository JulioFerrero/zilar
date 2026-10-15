---
id: T-1585
title: "One-line install step 4 (docs/deploy/one-line-install-plan.md): deploy/install.sh becomes a short bootstrap that fetches the release first, then runs deploy/lib/preflight.sh from it — a printed host report (OS, arch, RAM, disk, ports, virtualization, Docker, Coolify), a clear stop when Docker can't run, a stop pointing to Coolify mode when Coolify is found, and AI computers turned on only after a real gVisor sandbox run passes"
status: merged
milestone: M5
branch: task/T-1585-install-preflight
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1585: Installer check report

## Spec (written by Claude, do not edit)

### Why
This is `docs/deploy/one-line-install-plan.md` step 4. Julio's decisions (2026-10-15):
- the one-liner checks the host first;
- on a server where Docker can't run, it **stops with a clear message** (no bare-metal fallback);
- when Coolify is installed, it uses Coolify mode, which a later task adds.

The script will be served from `get.zilar.app`.

### Facts (the lead read them on main `9a5f54b15`, 2026-10-15)
- **`deploy/install.sh` is exactly 400 lines**, and `deploy/tests/install.test.sh` (point 8 in its header) fails above 400. The flow, in `main()` at `:378-400`, is `phase_check` → `phase_docker` → `phase_fetch` → `phase_configure` → `phase_desks` → `phase_up` → `phase_doctor` → `finish`.
- **`check_host` (`:156-185`)** checks Linux, x86_64 or arm64, `curl`, `tar`, 10 GB disk, 2 GB RAM (a warning under 4 GB) and ports 80 and 443. It detects neither the virtualization type, Coolify, nor whether Docker can actually run.
- **`phase_docker` (`:204-227`)** installs Docker from get.docker.com after a yes, and never runs a container to prove Docker works.
- **`phase_desks` (`:320-340`)** runs `zilar host-setup`, but **never sets `DESKS_ENABLED=true`** in `.env` (the template sets `false`, `deploy/zilar:479`), so `--desks` leaves AI computers off.
  - `host-setup` installs gVisor (`runsc`) and reloads Docker (`deploy/lib/host-setup.sh`). The live VPS has no `/dev/kvm`, so `runsc` uses systrap (`deploy/zilar:488`).
- **Test-only environment variables:** `ZILAR_INSTALL_TARBALL`, `ZILAR_INSTALL_SKIP_CHECKS` and `ZILAR_INSTALL_API_URL` (`:7`). `deploy/zilar` has `env_get` (`:111`).
- **Other tasks running now:**
  - T-1583 runs `install.sh --yes --domain localhost --admin-email ci@example.com --dir /opt/zilar --version main` with `ZILAR_INSTALL_TARBALL`; keep those flags and that variable working;
  - T-1582 makes `./zilar up` pin `DESK_IMAGE` by itself.

### Steps
1. **`deploy/install.sh` becomes a bootstrap** (keep it well under 400 lines). It:
   1. parses the flags (all current ones stay);
   2. checks `curl`, `tar` and Linux;
   3. **fetches and extracts the release into a temp directory first**;
   4. sources `deploy/lib/preflight.sh` from that tree and runs the report;
   5. then follows the existing phases. `deploy/` is copied to `--dir` only on the plain-Docker path.
   - A cut-off download still runs nothing (test point 8).
2. **New `deploy/lib/preflight.sh`** prints one aligned report, one line per item, each `ok`, `warn` or `stop` with a short reason. The items:
   - OS and version (`/etc/os-release`);
   - CPU architecture, RAM and free disk;
   - ports 80 and 443;
   - virtualization (`systemd-detect-virt`, or `unknown`);
   - Docker: installed and running (`docker info`), or missing;
   - Coolify: found when a container named `coolify` runs or `/data/coolify/source` exists.
3. **Decision after the report:**
   - **Coolify found:** say Zilar will install into Coolify, and that Coolify mode needs a Coolify API token. Until the Coolify-mode task lands, print that it is not available in this version and exit 0, **without** touching ports or Docker. Don't fail on ports 80/443 being taken when Coolify owns them.
   - **Virtualization `openvz`, or `lxc` with Docker missing:** stop with a clear message:
     - **why:** a container-based VPS usually can't run Docker unless the provider turns on nesting;
     - **what works:** a VM-based VPS (KVM, Xen, VMware, Hyper-V; most cloud VPS plans), or asking the provider to enable nesting.
   - **Docker can't run** after install, or the existing one fails `docker run --rm hello-world`: the same stop message, with the error's first line.
   - **Otherwise:** the plain path as today.
4. **AI computers in `phase_desks`:**
   1. after `host-setup`, run one real sandbox: `docker run --rm --runtime=runsc` with a tiny image (`hello-world`, or `busybox true`);
   2. **pass:** set `DESKS_ENABLED=true` in `$DIR/.env` (a small helper that replaces the line; no `sed -i` portability traps);
   3. **fail:** leave it `false` and print "AI computers stay off: <reason>". The install continues.
5. **`--dry-run`** prints the report items it would check and the decision branches, with no changes.
6. **Update `deploy/tests/install.test.sh`** for the new order (fetch before the report) and stub the new checks (`systemd-detect-virt`, `docker` and the Coolify probe) the way it stubs today, offline.
   - **New cases:**
     - Coolify found → exits 0 with the message;
     - openvz → the stop message;
     - the sandbox fails → `DESKS_ENABLED` stays false.
7. **`docs/INSTALL.md`:** the list of what the script does matches the new flow.

### Tests
`deploy/tests/install.test.sh` (updated, as in step 6).

### Allowed files
- `deploy/install.sh`
- `deploy/lib/preflight.sh` (new)
- `deploy/tests/install.test.sh`
- `docs/INSTALL.md`
- `work/T-1585-install-preflight.md`

### Checks
```bash
sh deploy/tests/install.test.sh
sh deploy/install.sh --dry-run --yes --domain example.com --admin-email a@example.com
pnpm gate
```

### Acceptance
- **The Report pastes:**
  - the `--dry-run` output;
  - the test summary;
  - the line counts of `install.sh` and `preflight.sh`;
  - the exact stop message text.

---

## Report (written by the worker when done)

### What I did

- **`deploy/install.sh` (400 → 344 lines)** is now a bootstrap: it parses the flags,
  does the bootstrap checks (`Linux`, `curl`, `tar`, root or sudo), fetches and
  extracts the release into a temp dir (`fetch_release`, trap cleans it up), sources
  `deploy/lib/preflight.sh` from that tree and runs the report, then follows the plain
  phases (`docker`, `configure`, `desks`, `up`, `doctor`). `deploy/` is copied to
  `--dir` only on the plain path (`install_deploy`), after the report decides.
  - `phase_docker` now proves Docker really runs with `docker run --rm hello-world`
    (both for an existing Docker and a fresh install) and stops with the shared
    message on failure.
  - `phase_desks` runs one real gVisor sandbox (`docker run --rm --runtime=runsc
    hello-world`) after `host-setup`; on a pass the new `set_env_var` helper rewrites
    `DESKS_ENABLED=true` in `$DIR/.env` (temp-file rewrite, no `sed -i`), on a failure
    it stays `false` and prints `AI computers stay off: <reason>` and the install
    continues.
  - `--dry-run` prints the report items and the decision branches, with no changes.
- **`deploy/lib/preflight.sh` (new, 166 lines):** one aligned line per item
  (`os`, `arch`, `ram`, `disk`, `port 80`, `port 443`, `docker`, `virt`, `coolify`),
  each `ok`/`warn`/`stop` with a short reason, then `preflight_decide`:
  Coolify found → `exit 0` with the Coolify-mode message (host untouched, ports 80/443
  do not fail); `openvz`, or `lxc` without Docker → the shared stop message;
  otherwise it returns and the plain path runs.
- **`deploy/tests/install.test.sh`:** updated the header, the stub tarball (now carries
  the real `preflight.sh`), the step order (`check fetch "host report" docker configure
  up doctor`), the dry-run branch assertions, and test 2d (a failed Docker download now
  stops after the fetch, before configure). Added: Coolify found (2e), openvz (2f), and
  the sandbox fail/pass cases (5d). New checks are stubbed via `PATH` (`systemd-detect-virt`,
  `docker`) so nothing hits the network.
- **`docs/INSTALL.md`:** the numbered "what it does" list and the `--desks` row match the
  new flow (host report and early stops, Docker smoke run, sandbox-gated AI computers).

### Checks run

- `sh deploy/tests/install.test.sh` → **pass=50 fail=0**. (The only test file I ran; no
  vitest suite is near this change.)
- `sh deploy/install.sh --dry-run --yes --domain example.com --admin-email a@example.com`
  → exit 0. Output:

  ```
  zilar-install: dry run: printing the plan, changing nothing

  ==> check
      Linux; curl and tar on PATH; root or sudo.

  ==> fetch
      version: <latest v* tag>
      + curl -fsSL https://codeload.github.com/JulioFerrero/zilar/tar.gz/<latest v* tag> -o <tmp>/zilar.tar.gz
      + tar -xzf <tmp>/zilar.tar.gz -C <tmp>/x

  ==> host report
      items: os and version (/etc/os-release); CPU architecture, RAM and free disk;
             ports 80 and 443; Docker (docker info); virtualization (systemd-detect-virt);
             Coolify (a container named coolify, or /data/coolify/source).
      branch: Coolify found -> Coolify mode (needs a Coolify API token; not in this version)
      branch: container-based VPS (openvz, or lxc without Docker) -> stop and explain
      branch: Docker cannot run (docker run --rm hello-world fails) -> stop and explain
      branch: otherwise -> the plain Docker install below
      + sudo cp -R <tmp>/x/zilar-*/deploy/. /opt/zilar/    (plain path only; an existing .env is kept)

  ==> docker
      Docker with the Compose plugin is already installed.
      + docker run --rm hello-world   # proves Docker really runs

  ==> configure
      + (cd /opt/zilar && sudo ./zilar init --domain example.com --admin-email a@example.com --acme-email a@example.com --push-subject mailto:a@example.com --image-owner julioferrero --image-tag latest)

  ==> up
      + (cd /opt/zilar && sudo ./zilar up)

  ==> doctor
      + (cd /opt/zilar && sudo ./zilar doctor)

  zilar-install: dry run complete — nothing was changed
  ```

- Line counts: `deploy/install.sh` **344** (limit 400), `deploy/lib/preflight.sh` **166**.
- `pnpm gate` (from the repo root) → summary lines:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.5s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.3s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- **Exact stop message** (reproduced with an `openvz` `systemd-detect-virt` stub and a
  Docker stub, against a stub release tarball; exit 1, no `configure`/`up`):

  ```
  zilar-install: Docker cannot run on this host: this host is a container-based VPS (openvz)
    why: a container-based VPS usually cannot run Docker unless the provider turns on nesting.
    what works: a VM-based VPS (KVM, Xen, VMware, Hyper-V; most cloud VPS plans),
                or ask the provider to enable nesting.
  ```

  A failed `docker run --rm hello-world` uses the same message with the first error line
  as the reason (`... hello-world failed: <first line>`).

### Notes for the lead

- **Coolify branch has no test for the `/data/coolify/source` path.** The tests exercise
  the container probe (`docker ps` reports `coolify`), which is the offline-testable half;
  creating `/data/coolify/source` needs root. The probe checks both as the spec asks.
- **Docker probes run unprivileged** (`docker info`, `docker compose version`, `docker ps`,
  `docker run`), matching the spec's wording and today's behavior. A non-root user not in
  the `docker` group can therefore see `docker: installed but not running`, and
  `phase_docker` may re-offer the get.docker.com install; running these under `$SUDO`
  instead would change existing behavior and break the offline tests, so I left them as
  they are. Flag it if you want a follow-up.
- **`ram`/`os`/`disk` "unknown" is a `warn`, not a `stop`,** so a host whose `/proc/meminfo`
  or `/etc/os-release` is unreadable does not fail on a value it could not read (this also
  keeps the offline tests, which run on macOS, on the plain path). On a real Linux host the
  values are read, so the 2 GB/10 GB stops still bite.
- The report's item order is `os, arch, ram, disk, port 80, port 443, docker, virt, coolify`
  (Docker before virt so the `lxc` line can say whether Docker is missing).
- T-1583's flags (`--yes --domain --admin-email --dir --version`) and `ZILAR_INSTALL_TARBALL`
  are unchanged and covered by the tests.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 3 cosmetic nits.
- **Checks the lead ran on the branch:**
  - **`sh deploy/tests/install.test.sh`:** pass=50, fail=0.
  - **Sizes:** `install.sh` 344 lines, `deploy/lib/preflight.sh` 166.
  - **The dry run** (`--dry-run --yes --domain example.com --admin-email a@example.com`) shows the new order:
    - check, fetch, then the host report with its four branches (Coolify, container-based VPS, Docker can't run, plain install);
    - `docker run --rm hello-world` to prove Docker runs;
    - configure, up, doctor;
    - `deploy/` is copied to `--dir` on the plain path only.
- **Read in the code:**
  - **The stop message** (`install.sh:95-102`) says why ("a container-based VPS usually cannot run Docker unless the provider turns on nesting") and what works (a VM-based VPS, or asking the provider to enable nesting).
  - **AI computers:** after `host-setup`, `desk_sandbox` runs `docker run --rm --runtime=runsc hello-world`. It sets `DESKS_ENABLED=true` only on a pass; otherwise it prints "AI computers stay off: <first error line>". This fixes `--desks` never turning desks on.
  - **Coolify found:** exit 0 with the "not in this version" message; the Coolify-mode task replaces it.
- **Left as they are:**
  - the `.env` rewrite is not atomic (the same pattern as T-1582's helper);
  - no test drives the `docker_smoke` failure path;
  - a naming nit in `preflight_run`/`preflight_decide`.
