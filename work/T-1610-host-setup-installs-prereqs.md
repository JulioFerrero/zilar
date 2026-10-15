---
id: T-1610
title: "host-setup installs its own small prerequisites: on the live VPS `--desks-host` died at `tar -xjf gvisor.tar.bz2` (no bzip2); check bzip2 and jq up front and install missing ones with the host's package manager (apt-get/dnf/yum/apk), before anything changes"
status: merged
milestone: M5
branch: task/T-1610-host-setup-installs-prereqs
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1610: host-setup installs bzip2 and jq when they are missing

## Spec (written by Claude, do not edit)

### Why
On 2026-10-15 the lead ran the one host command on the live VPS (Debian or Ubuntu x86_64): `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` (v0.2.1).
- **What happened:** host-setup downloaded and verified `gvisor.tar.bz2`, then failed with `tar (child): bzip2: Cannot exec: No such file or directory`. It stopped before changing `daemon.json`.
- **Why it matters:** many fresh servers have no `bzip2`, and often no `jq` either.
- **Julio's rule:** AI computers need one command, with no hand-made installs. So host-setup must take care of these small prerequisites itself.

### Facts (the lead read them on 2026-10-16, main `df3471bf3`)
- **`deploy/lib/host-setup.sh`** (178 lines):
  - `:62-73`: `cmd_host_setup` checks `curl`, `jq`, `sha512sum`, `tar`, `systemctl` and `docker` with `need_cmd` (only when not a dry run), and dies with hints like "install jq (apt-get install -y jq)";
  - `:17-26`: the pinned release `GVISOR_VERSION="20261005.0"` ships only `gvisor.tar.bz2` (the comment at `:17-21` explains the 2026-07 layout change);
  - `:94-107`: the dry-run plan lines and the real steps: `curl` the bundle and its `.sha512`, `sha512sum -c`, then `tar -xjf … -C /usr/local/bin`.
- **The helpers** `die`, `info`, `run`, `need_cmd` and `DRY_RUN` come from `deploy/zilar`; host-setup is sourced there.
- **The installer's existing pattern for installing a dependency:** `deploy/install.sh:229-240` (Docker from get.docker.com, after consent, with `$SUDO`). host-setup already runs as root (`:66`).
- **`deploy/tests/host-setup.test.sh`** already uses stub binaries on `PATH` (`:292-293`, a stub `docker`).

### Steps
1. **In `host-setup.sh`, add `ensure_host_pkgs`** (or a similar name). It runs before any download, in both dry and real runs. For each command missing from `PATH` among `bzip2` and `jq` (package names `bzip2` and `jq`):
   - **Detect the package manager:**
     - `apt-get`: `DEBIAN_FRONTEND=noninteractive apt-get update -qq` once, then `apt-get install -y -qq <pkgs>`;
     - else `dnf install -y`, else `yum install -y`, else `apk add --no-cache`.
   - **Print first:** one `info` line naming what it installs ("installing bzip2 jq (needed to unpack gVisor)"). In a dry run, print the command instead.
   - **No package manager found:** `die` with a clear message naming the missing commands.
   - **After installing:** re-check with `need_cmd`.
2. **Keep the other `need_cmd` checks as they are.** Move `jq` out of the plain `need_cmd` list, since it is now ensured.
3. **Fail before any change:** the ensure step runs right after the root check, so a host where it fails is left untouched.
4. **Tests in `deploy/tests/host-setup.test.sh`:**
   - with stubs making `bzip2` missing and a stub `apt-get` that records its arguments, a real (non-dry) run calls `apt-get install -y -qq bzip2`, or the dry-run plan prints it, whichever the existing harness supports;
   - with every command present, no package manager is called.

### Tests
The two cases above, in `deploy/tests/host-setup.test.sh`.

### Allowed files
- `deploy/lib/host-setup.sh`
- `deploy/tests/host-setup.test.sh`
- `work/T-1610-host-setup-installs-prereqs.md`

### Checks
```bash
sh deploy/tests/host-setup.test.sh
sh deploy/tests/install.test.sh
pnpm gate
```

### Acceptance
- **A host with no `bzip2` and no `jq`** gets both installed by host-setup, and the gVisor bundle unpacks.
- **Nothing on the host changes when the ensure step fails.**
- `host-setup.sh` stays within 400 lines.

---

## Report (written by the worker when done)

### What I did

- Added `ensure_host_pkgs` to `deploy/lib/host-setup.sh`. It runs right after
  the root check and before any download. It collects the missing commands
  among `bzip2` and `jq`; when none is missing it returns. Otherwise it
  detects the package manager (`apt-get`, else `dnf`, else `yum`, else
  `apk`), `die`s with a message naming the missing commands when none exists,
  prints one `info` line in a real run (`installing bzip2 jq (needed to unpack
  gVisor)`) or the `+ <command>` line(s) in a dry run, installs, then
  re-checks every package with `need_cmd`.
- `cmd_host_setup` now does the root check first, then calls
  `ensure_host_pkgs` (in both dry and real runs), then keeps the remaining
  `need_cmd` checks (`curl`, `sha512sum`, `tar`, `systemctl`, `docker`). `jq`
  was removed from that plain list because it is now ensured.
- Extended `deploy/tests/host-setup.test.sh` with section 5. A fake `PATH`
  (stub `id` reporting root, a recording `apt-get`, a stub `jq`, and
  `dirname`/`sed` linked from the host) proves a real (non-dry) run installs a
  missing `bzip2` with `apt-get update -qq` then
  `apt-get install -y -qq bzip2` and re-checks it; a second case with both
  `bzip2` and `jq` present proves no package manager is called.

### Checks run

- `sh deploy/tests/host-setup.test.sh`: `pass=52 fail=0` (exit 0).
- `sh deploy/tests/install.test.sh`: `pass=58 fail=0` (exit 0).
- `pnpm gate` (from the repo root), summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.2s)
PASS  typecheck  (1.5s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- `wc -l deploy/lib/host-setup.sh`: 247 lines (limit is 400).

Single tests I ran while working: only the two shell scripts above, before the
gate.

### Notes for the lead

- The `info` line names the packages it installs and keeps the spec's exact
  wording `(needed to unpack gVisor)`, even though `jq` is used for the
  daemon.json merge, not the unpack.
- In a dry run the ensure step prints
  `+ DEBIAN_FRONTEND=noninteractive apt-get update -qq` and
  `+ apt-get install -y -qq bzip2 jq` (which `package manager` and which
  packages depend on what is on `PATH`).
- On this machine `bzip2` and `jq` are both present, so `host-setup --dry-run`
  takes the early-return path and the pre-existing dry-run checks are
  unaffected.
- The tests use a real (non-dry) run with a faked root (`id` stub) plus a
  recording `apt-get` stub, matching the file's existing habit of stubbing
  binaries on `PATH`; the run stops at the `need_cmd` re-check and writes
  nothing to the host.
- Deviations from the spec: none.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 2 nits.
- **What the lead read:** `ensure_host_pkgs` in `deploy/lib/host-setup.sh`.
  - It runs right after the root check and before any download, in dry and real runs.
  - It finds the missing `bzip2`/`jq` and the first of `apt-get`, `dnf`, `yum`, `apk`.
  - It prints one `info` line, installs non-interactively, then re-checks with `need_cmd`, so a failed install stops before the gVisor download.
  - With no package manager it dies with a clear message.
- **What the lead ran:** `host-setup.test.sh` pass=52 fail=0 (it had 49) and `install.test.sh` pass=58 fail=0. `host-setup.sh` is 247 lines.
- **Next:** tag v0.2.2, which also checks T-1609: the installer job must run and attach `install.sh`. Then re-run `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` on the VPS.
