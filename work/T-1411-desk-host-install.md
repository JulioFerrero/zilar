---
id: T-1411
title: "P2 task D: AI computers install and run like the rest of Zilar: desk-agent and desk-egress as compose services (self-host and Coolify), a one-command host prep (`./zilar host-setup`: pinned gVisor via docker reload, the 4 GB zilar-desks.slice), doctor checks, and the docs; nothing is run on the VPS by this task"
status: merged
milestone: M5
branch: task/T-1411-desk-host-install
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1411: Desks install like the rest of Zilar

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, about setting up AI computers on the VPS: **"this needs to be easy replicable like all the other parts of zilar please, nothing just doing it, if tomorrow we wipe the vps, needs to be one moment to install and run all zilar"**.

So there are **no hand-run steps and no hand-written systemd units.** The desk pieces ship in the same compose files and the same `deploy/zilar` installer as everything else. A wiped VPS comes back with the usual install plus one `./zilar host-setup`.

The design is `docs/design/agent-system.md` §2.3 and §7: jails on the current VPS with gVisor, one shared 4 GB memory pool that can't take the VPS down, a disk image file per AI, open web through the egress proxy. The plan is `docs/audit/desk-runner-plan.md` §4-5 and Appendix A. The code is `packages/desk` (T-1403, T-1407; T-1410 adds the egress proxy in `packages/desk/src/egress/`).

### Facts (the lead checked them, 2026-10-14)
- **The installer** is `deploy/zilar`: one POSIX `sh` script, 1363 lines. Its commands are `init`, `up`, `down`, `logs`, `status`, `update`, `doctor`, `backup`, `restore` and `create-admin`, dispatched at `:1352-1361`. `--dry-run` is supported, and the script never prints secrets. Its tests are `deploy/tests/*.test.sh`.
- **The compose files:**
  - self-host `deploy/docker-compose.yml` (services `postgres`, `ejabberd`, `server`, `web` and `caddy` from `:30` to `:251`, volumes from `:296`);
  - Coolify `deploy/coolify/docker-compose.app.yml` (services from `:43` to `:251`), which **auto-deploys on every green `main`**.
- **The live VPS:** Debian 13, kernel 6.12, x86_64, 8 vCPU, about 7.2 GB RAM free, ext4 root, **no `/dev/kvm`** (so gVisor uses systrap). Docker's default runtime is runc; `/etc/docker/daemon.json` has only log options and address pools. **38 containers run, so a Docker restart is not acceptable;** use `systemctl reload docker`, since runtimes reload on SIGHUP.
- **The sidecar** needs root inside its container (`mount`, `losetup`, the Docker CLI) and the host Docker socket. **The app (`server`) must never get the socket** (plan §4.4). It reaches the sidecar only through the unix socket on a shared volume.

### What to build
1. **Images:** a `deploy/desk/Dockerfile.agent` that builds the desk-agent and desk-egress from `packages/desk` (one image, two entry points, or two small images; say which). It's built the same way the `server` image is built for each compose file (follow the existing `build:` or `image:` pattern; read how `server` does it).
2. **Compose services, in both** `deploy/docker-compose.yml` and `deploy/coolify/docker-compose.app.yml`:
   - **`desk-agent`:**
     - privileged, with `/var/run/docker.sock`, the workspace root volume (`/var/lib/zilar/desks`, a bind path, because loop images need a real host path) and `/dev` for loop devices;
     - it serves `/run/zilar/desk.sock` on a **named volume `desk-socket`** that's also mounted into `server`;
     - `DESK_RUNTIME` defaults to `runsc`, `--cgroup-parent zilar-desks.slice`, `DESK_MAX_RUNNING=12`, and the pinned desk image digest.
   - **`desk-egress`:** unprivileged, the only member of the internal `desk-net` network that also has a route out.
   - **`server`** gets `DESK_AGENT_SOCKET=/run/zilar/desk.sock` and the `desk-socket` volume.
   - **A switch `DESKS_ENABLED`** (default `false` in both files): when false, the desk services don't start (use a compose `profiles: [desks]` entry or an equivalent the installer turns on), and `server` runs exactly as today. **So merging changes nothing in production** until the flag is set.
3. **`./zilar host-setup`** (a new command; put its body in a new file `deploy/lib/host-setup.sh` that `deploy/zilar` sources, so the main script doesn't grow by more than the dispatch line). It's idempotent, needs root, and supports `--dry-run`:
   - installs a **pinned, dated** gVisor `runsc` with its `.sha512` checked (not `latest`);
   - merges the `runsc` runtime into `/etc/docker/daemon.json` with `jq`, after a backup, keeping the existing keys, then runs `systemctl reload docker`. **Never a restart.**
   - writes `/etc/systemd/system/zilar-desks.slice` (`MemoryMax=4G`, `MemoryHigh=3500M`, `MemorySwapMax=0`, `TasksMax=4096`, `CPUWeight=50`) and runs `systemctl daemon-reload`;
   - creates `/var/lib/zilar/desks` (0700);
   - prints the smoke `docker run --rm --runtime=runsc alpine uname -r` (expect `4.4.0`).
4. **`./zilar doctor`** gains desk checks when `DESKS_ENABLED=true`: the `runsc` runtime is registered, the slice exists with `MemoryMax`, `/var/lib/zilar/desks` exists, and the desk-agent socket answers `status`. Use the existing check style.
5. **`./zilar init`** writes `DESKS_ENABLED=false` and the desk variables (with comments) into the generated `.env`. Update `deploy/.env.example` too.
6. **Docs:**
   - `docs/RELEASING.md` (or the install doc it points to): a short "AI computers (desks)" section. On a new or wiped VPS: the usual install, then `sudo ./zilar host-setup`, then `DESKS_ENABLED=true` and `./zilar up`. For Coolify: `host-setup` once on the host, then set `DESKS_ENABLED=true` in the app's env.
   - Also the rollback (`DESKS_ENABLED=false`; remove the runtime key and reload).
7. **Tests:** `deploy/tests/host-setup.test.sh`, in the style of the existing deploy tests: run `host-setup --dry-run` and assert it prints the pinned version, the `jq` merge, `reload` (and never `restart`), and the slice values. Also run `docker compose config` on both compose files with `DESKS_ENABLED` false and true. **Run shellcheck** on the new scripts if it's installed.

### Read first
`AGENTS.md`, `deploy/zilar` (the structure, `cmd_doctor`, `cmd_init`), `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/tests/push-deploy.test.sh` (test style), `docs/RELEASING.md`, `docs/audit/desk-runner-plan.md` §4-5, and `packages/desk/README.md`.

### Allowed files
`deploy/desk/**`, `deploy/lib/**`, `deploy/zilar`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/.env.example`, `deploy/tests/host-setup.test.sh`, `docs/RELEASING.md`, `packages/desk/**`, `work/T-1411-desk-host-install.md`.

### Checks
```bash
sh deploy/tests/host-setup.test.sh
pnpm gate
```

### Acceptance
- The gate and the new deploy test pass.
- With `DESKS_ENABLED=false` (the default), `docker compose config` for both files shows the same services as today.
- With it set to true, it shows `desk-agent` and `desk-egress`, and `server` has the socket volume and env.
- No other change in production when this merges.

---

## Report (written by the worker when done)

### Round 1 (old scope: host systemd units and a runbook; superseded by the new Spec above, kept for reference)

### What I built

Seven files under a new `deploy/desk/` folder. Nothing was run on the VPS; this is
files only. No Coolify compose file was touched.

| File | Summary |
| --- | --- |
| `install-gvisor.sh` | pinned, dated gVisor install, SHA-512 verified; merges `runtimes.runsc` into `/etc/docker/daemon.json` with `jq` (fixed `.bak` backup, existing keys kept); `systemctl reload docker` (SIGHUP, no restart) then verifies via `docker info`; prints the smoke command. Idempotent (skips download and leaves an already-correct `daemon.json` alone). |
| `zilar-desks.slice` | `MemoryMax=4G`, `MemoryHigh=3500M`, `MemorySwapMax=0`, `TasksMax=4096`, `CPUWeight=50`. |
| `desk-net.sh` | idempotent internal (`--internal`) bridge `desk-net`, fixed subnet `172.31.0.0/24`; refuses an existing network of the wrong shape; prints the gateway the proxy binds to. |
| `desk-agent.service` | sidecar as root (`mount`/`losetup` + Docker socket), `Group=zilar`, `UMask=0117`, `RuntimeDirectory=zilar`, `Restart=on-failure`, env from `/etc/zilar/desk-agent.env`; hardening `NoNewPrivileges`, `ProtectHome`, `PrivateTmp`. |
| `desk-egress.service` | proxy as unprivileged `zilar-egress`, `Restart=on-failure`, `RuntimeDirectory=zilar-egress` for the registry socket, hardening plus `ProtectSystem=strict`. |
| `desk-agent.env.example` | every sidecar and proxy variable, safe defaults, no secrets (the image digest is a `CHANGE_ME` placeholder). |
| `RUNBOOK.md` | steps 0–9, each with a check and a rollback, the Appendix A pre-flight, the socket smoke, the single Coolify production change last, and the cost. |

Two choices the spec left open:

- **Sidecar artifact.** `desk-agent.service` runs the **built bundle** `node /opt/zilar/packages/desk/dist/desk-agent` (not `src/agent/main.ts`). `build.mjs` (T-1403) only bundles `src/serve.ts` into `dist/desk-tool`, so the runbook's step 6 builds the sidecar and proxy bundles with the same esbuild settings (`RUNBOOK.md` step 5/6). See "Deviations".
- **`desk-agent.env.example` is one file** read by both units, as spec item 6 words it ("every variable the sidecar and proxy read"). It holds no secrets, so sharing it is safe.

### Commands and real results

- `pnpm install` — done, 11.2s, 1137 packages; one pre-existing peer-dependency warning (`@types/react-dom` vs `@types/react` in `apps/mobile`), unrelated to this task.
- `bash -n deploy/desk/install-gvisor.sh deploy/desk/desk-net.sh` — syntax OK (both).
- `jq` merge/equality snippets from `install-gvisor.sh`, run against a sample `daemon.json` — the merged file keeps `log-driver`, `log-opts` and `default-address-pools` and adds `runtimes.runsc`; the idempotency equality check returns `true`.
- `shellcheck` — **not run: not installed** (`command -v shellcheck` empty). Per the task I checked `brew list shellcheck`, but the harness refused the `brew` command ("No Homebrew installs from a worker"), so I could not install it. Manual review + `bash -n` only.
- `pnpm gate` (from the repo root) — exit 0:

  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

No tests were run individually: no package source was touched, and the gate selected none.

### Files changed

`deploy/desk/install-gvisor.sh` (new, 0755), `deploy/desk/desk-net.sh` (new, 0755),
`deploy/desk/zilar-desks.slice` (new), `deploy/desk/desk-agent.service` (new),
`deploy/desk/desk-egress.service` (new), `deploy/desk/desk-agent.env.example` (new),
`deploy/desk/RUNBOOK.md` (new), `work/T-1411-desk-host-install.md` (status + report).

### Deviations from the spec (please confirm)

1. **gVisor download uses the tarball, not a bare `runsc`.** The spec (and plan
   §4.1) say "download … verify its `.sha512` … install `runsc` to
   `/usr/local/bin`". gVisor **changed its release layout in 2026-07**: releases
   from `latest` and from `20260714.0` onward ship a `gvisor.tar.{zstd,bz2}`
   bundle (checked on the bucket: `20261005.0/x86_64/` has `gvisor.tar.bz2`,
   `gvisor.tar.bz2.sha512`, `gvisor.tar.zstd`, `gvisor.tar.zstd.sha512` and **no**
   standalone `runsc`). Earlier releases (`20260622.0`) still have `runsc` +
   `runsc.sha512`. I pinned the newest release **`20261005.0`** and download +
   SHA-512-verify `gvisor.tar.bz2` (bz2 needs no `zstd`), extracting `runsc`,
   `containerd-shim-runsc-v1` and `gvisor-bin/` into `/usr/local/bin` as the
   gVisor docs prescribe. This keeps every stated requirement (pinned/dated, not
   `latest`; `.sha512` verified; `runsc` in `/usr/local/bin`) but not the literal
   old URL. **Consequence:** `GVISOR_VERSION` must be a release with the tarball
   layout (`20260714.0` or newer); the script fails loudly for older ones. If you
   want the exact legacy single-binary method, say so and I will pin a pre-July
   release instead.

2. **The registry/env names for the egress proxy are provisional.** T-1410 (the
   egress proxy, `packages/desk/src/egress/main.ts`) is not merged here, so its
   env names are unknown. I used `DESK_EGRESS_BIND`, `DESK_EGRESS_PORT`,
   `DESK_EGRESS_REGISTRY_SOCKET` (spec: "port, registry socket path") and the
   bundle name `dist/desk-egress`. **These must match T-1410's `main.ts`** before
   the runbook is followed.

3. **"Attach the egress proxy as the only route out" is realised differently than
   that phrase suggests.** The proxy is a **host systemd service**, not a
   container, so it cannot be a member of `desk-net` and cannot be resolved by the
   Docker DNS name `desk-egress` that the plan's §4.2 run flags use. Instead
   `desk-net` is `--internal` (no route out) on a fixed subnet, and the proxy
   binds the bridge **gateway** (`172.31.0.1:3128`), which is the one address a
   jail can still reach; `DESK_EGRESS_PROXY=http://172.31.0.1:3128` gives jails
   that as `HTTP(S)_PROXY` (the sidecar sets it, `docker.ts`). If you instead want
   a containerised `desk-egress` resolvable by name, that is a different design
   (and would need a second network for the proxy's own egress) — tell me which.

### Open questions / coordination

- The three points above (1: tarball vs bare `runsc`; 2: T-1410 env names; 3: host
  proxy on the gateway vs a named container).
- `DESK_MAX_RUNNING=12` per the spec, but the 4 GB pool with 2 GB jails and 75%
  admission means roughly **one** jail fits before admission blocks (plan §4.3/§9
  guessed 3 from ~7.5 GB). The pool is the real limiter; 12 is only the safety
  cap. Worth confirming the pool size.
- The Coolify socket mount (step 9) needs the app container in group `zilar` (or
  root) to use a `0660 root:zilar` socket — flagged in the runbook, for the lead
  to set in Coolify.


### Round 2 (new scope: desks as compose services + `./zilar host-setup`)

The old host-only kit (systemd units, `desk-net.sh`, a runbook) is gone; desks now
ship like the rest of Zilar. What I built:

| File | Change |
| --- | --- |
| `deploy/desk/Dockerfile.agent` | new. **One image, two entry points** (`desk-agent`, `desk-egress`): a pnpm+esbuild build stage over `packages/desk`, and a runtime stage with the Docker CLI (copied from `docker:27-cli`), `mount`/`losetup` (`util-linux`) and `mkfs.ext4` (`e2fsprogs`). Built from the repo root like `apps/server/Dockerfile`. |
| `deploy/docker-compose.yml` | `desk-agent` (privileged, docker.sock, `/dev`, the `/var/lib/zilar/desks` bind, on the socket volume + `desk-net`), `desk-egress` (unprivileged, on `desk-net` + `desk-out`), both behind `profiles: [desks]`; `server` gets the `desk-socket` volume and `DESK_AGENT_SOCKET`; new `desk-net` (internal, fixed name) and `desk-out` networks; `desk-socket` + `desk-egress-socket` volumes. |
| `deploy/coolify/docker-compose.app.yml` | the same desk services (build contexts relative to the repo root) and the same server volume/env/networks/volumes. |
| `deploy/lib/host-setup.sh` | new. `cmd_host_setup`: pinned gVisor `20261005.0` (tarball + `.sha512`), `jq` merge into `daemon.json` after a one-time backup, `systemctl reload docker` (never restart), writes `zilar-desks.slice`, creates `/var/lib/zilar/desks` (0700), prints the smoke. Idempotent, root-only, `--dry-run`. |
| `deploy/zilar` | sources `deploy/lib/host-setup.sh`; `host-setup` added to usage and dispatch; `compose()` adds `--profile desks` when `DESKS_ENABLED=true`; `init` writes the desk block; `doctor` checks desks when on. Also dropped the now-redundant `run compose …` wrapper so `--dry-run` prints the real `docker compose …` line (nothing asserted the old `+ compose …` form). |
| `deploy/.env.example` | desk block (DESKS_ENABLED, DESK_IMAGE, DESK_RUNTIME, DESK_MAX_RUNNING). |
| `docs/RELEASING.md` | new §10 "AI computers (desks)": plain-stack steps, Coolify steps, how it fits together, rollback. |
| `deploy/tests/host-setup.test.sh` | new dry-run deploy test. |
| `packages/desk/src/agent/server.ts` | `chmod 0666` the socket after `listen` so the app connects from its own non-root container over the shared volume. |
| deleted | `deploy/desk/{desk-agent.service,desk-egress.service,desk-net.sh,RUNBOOK.md,desk-agent.env.example}` (the design they encoded is gone), and also `install-gvisor.sh` + `zilar-desks.slice`, whose logic now lives in `host-setup.sh` (they were not in your delete list — see "Deviations"). |

### Commands and real results

- `sh deploy/tests/host-setup.test.sh` — **pass=31 fail=0** (pinned version, SHA-512 check, jq merge, `reload` and no `restart`, all five slice values; `init` writes `DESKS_ENABLED=false`; `up` passes `--profile desks` only when on; both compose files render off/on and `server` carries the socket volume + env).
- `pnpm gate` (repo root) — exit 0:

  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/desk  (1.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

- `sh -n deploy/zilar`, `sh -n deploy/lib/host-setup.sh`, `sh -n deploy/tests/host-setup.test.sh` — syntax OK (all three).
- `docker compose config` on both files, `DESKS_ENABLED=false` vs `--profile desks` — checked manually too (services: postgres, ejabberd, server, web, caddy; + desk-agent, desk-egress when on).
- `shellcheck` — **not run: not installed** (`command -v shellcheck` empty; Homebrew installs are not allowed for a worker). Manual review + `sh -n` only.

### Deviations / decisions to confirm

1. **The `desks` profile is turned on by `--profile desks`, not by `DESKS_ENABLED` alone.** Compose `profiles` cannot be driven by a variable, so `./zilar up` passes `--profile desks` when `DESKS_ENABLED=true` (proven by the test). The Coolify app does not run `./zilar`, so its operator must set **both** `DESKS_ENABLED=true` and `COMPOSE_PROFILES=desks` (documented in §10). If you want one variable on Coolify too, that needs a different mechanism.
2. **`server` always mounts `desk-socket` and gets `DESK_AGENT_SOCKET`.** Compose cannot add a mount/env to an existing service conditionally, and `DESK_AGENT_SOCKET` is empty-means-unset in the server config (`EMPTY_MEANS_UNSET_KEYS`). With the desk services off the volume is empty and the file is absent; `apps/server/src/hands/wiring.ts` says the agent loop does not use the hands yet, so a default install behaves as today. Flagging it because it is a change to `server` in the rendered config even when desks are off.
3. **Egress env names are still provisional** (T-1410 not merged — `packages/desk/src/egress/` does not exist here): `DESK_EGRESS_PORT`, `DESK_EGRESS_REGISTRY_SOCKET` (`/run/zilar-egress/desk-egress.sock` on the `desk-egress-socket` volume shared with `desk-agent`). The proxy is a container on `desk-net` resolvable as `desk-egress` (answers my round-1 question 3). These names must match T-1410's `main.ts`; the `desk-egress-socket` volume is speculative until then.
4. **The image builds a stub `desk-egress` when `packages/desk/src/egress/main.ts` is absent**, so `desk-agent` is usable before T-1410 lands; the stub exits 1 with a clear message. Remove the fallback once T-1410 merges.
5. **Socket mode is `0666`** (`server.ts`): a non-root app container must be able to `connect` to a unix socket (write permission), and the volume is shared only by `server` and `desk-agent`. The alternative (a shared group) is fragile across two images with different users.
6. **I also deleted `install-gvisor.sh` and `zilar-desks.slice`** (not in your explicit delete list) because `host-setup.sh` supersedes both; keeping them would be duplicate, drifting code. Say the word and I will restore them.

### Open questions

- Confirm the Coolify `COMPOSE_PROFILES=desks` + `DESKS_ENABLED=true` two-variable enable (point 1).
- Confirm the always-mounted `server` socket volume (point 2).
- `desk-agent` gets the `zilar` network in the plain stack and the Coolify default network; it only needs the Docker socket, so a dedicated no-egress control network is possible if you prefer.

### Round 3 (fix round: PREREVIEW findings)

**Finding 1 (must-fix) — `desk-agent` had no start command.** Added
`command: ['node', '/app/desk-agent']` to the `desk-agent` service in both
`deploy/docker-compose.yml` and `deploy/coolify/docker-compose.app.yml`
(`desk-egress` already set its own command, so the shared image now starts the
right entry point in both). Test: `deploy/tests/host-setup.test.sh` extracts the
`desk-agent` block from each rendered config and asserts it carries
`/app/desk-agent` (one assertion per file).

**Finding 2 (must-fix) — Dockerfile builder frozen install: disagreed, left as
is.** See "Disagreements" below.

**Finding 3 (should-fix) — the "server carries …" assertion was vacuous.**
`deploy/tests/host-setup.test.sh` now pulls the `server:` block out of the
rendered config (new `service_block` helper) before grepping for
`DESK_AGENT_SOCKET:` and `desk-socket`, so it fails if `server` loses either.
Checked the helper both on a synthetic config (it stops at the next 2-space
service key) and against the two strings, which also live in `desk-agent`.

Nits 4–6: not touched (none of their lines were changed).

### Commands and real results

- `sh deploy/tests/host-setup.test.sh` — **pass=33 fail=0** (was 31; +2 for the
  desk-agent command assertions).
- `docker build --progress=plain -f deploy/desk/Dockerfile.agent -t
  zilar-desk-agent:prereview .` — exit 0; the build runs `pnpm install
  --frozen-lockfile`, then bundles `dist/desk-agent` (590.3 kB) and the
  `desk-egress` stub. Ran to test finding 2.
- `pnpm gate` (repo root) — exit 0:

  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/desk  (1.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Disagreements

- **Finding 2 (must-fix) is wrong: the frozen install does not fail.** The
  finding says the partial manifest set (`package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `turbo.json` + `packages/desk/package.json`) makes
  `pnpm install --frozen-lockfile` error because the lockfile records every
  `apps/*` and `packages/*` project. It does not: pnpm tolerates absent
  workspace projects and only checks the manifests that are present. Proven
  twice: (a) the exact COPY set in a scratch dir with the same pnpm 10.32.1 —
  `pnpm install --frozen-lockfile` finished ("Done in 1.2s", 98 packages);
  (b) a real `docker build -f deploy/desk/Dockerfile.agent .` — exit 0, install
  layer built, both esbuild bundles produced. The server image relies on the
  same tolerance (it copies only the manifests of the packages it imports).
  Left `Dockerfile.agent` unchanged.

### Lead round (before merge: a default install must stay unchanged even if Coolify ignores profiles)

1. **Server socket empty by default, in both compose files.** `server` now gets
   `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}`; the server already treats an
   empty value as unset (`apps/server/src/config.ts:288`, `:427`), so no Hands
   client is built with desks off. `./zilar` derives the path from the one flag:
   `compose()` passes `DESK_AGENT_SOCKET=/run/zilar/desk.sock` when
   `DESKS_ENABLED=true` (an explicit value in the env file wins).
   `deploy/.env.example`, the `init` env comment and `docs/RELEASING.md` (plain
   stack + Coolify) updated to match; Coolify sets
   `DESK_AGENT_SOCKET=/run/zilar/desk.sock` by hand next to `DESKS_ENABLED=true`.
2. **Belt-and-braces guard.** Both `desk-agent` and `desk-egress`, in both
   compose files, now start through `sh -c` that exits 0 at once unless
   `DESKS_ENABLED=true`, carry `DESKS_ENABLED: ${DESKS_ENABLED:-false}`, and use
   `restart: on-failure` so an exit-0 container stays stopped. Even if Coolify
   ignores the `desks` profile, a merge starts nothing.
3. **Tests.** `deploy/tests/host-setup.test.sh` now asserts `server`'s
   `DESK_AGENT_SOCKET` is empty with desks off, and that both desk services
   carry the `DESKS_ENABLED` guard and `restart: on-failure`; it also checks that
   `./zilar up` sets the socket when desks are on and leaves it unset when off.

**Commands:** `sh deploy/tests/host-setup.test.sh` → **pass=41 fail=0**.
`pnpm gate` → **GATE PASS** (install, format, lint, typecheck, effect, tests
`@zilar/desk`; scope clean). `status` stays `review`.

### Round 4 (fix round: PREREVIEW findings)

**Finding 1 (should-fix) — doctor false-FAILed the slice on a fresh idle host.**
`deploy/zilar` now reads the *configured* limit from the systemd unit
(`systemctl show --value -p MemoryMax zilar-desks.slice`) instead of the live
cgroup path `/sys/fs/cgroup/zilar-desks.slice/memory.max`. On a freshly
prepared host the unit file exists but systemd has not materialised the cgroup
until the first jail joins it, so the old check told the operator to re-run
`host-setup`, which changed nothing. A non-empty `MemoryMax` now means the slice
is installed; an absent unit still FAILs and points at `host-setup`.

**Finding 2 (nit, in the same lines) — the check never asserted `MemoryMax=4G`.**
The same branch now rejects any value that is not the 4 GB pool
(`4294967296` or `4G`): a hand-edited slice FAILs with its actual value. Fixed
because it sits in lines finding 1 already changed.

**Finding 3 (nit) — not touched.** Its lines (`deploy/zilar:856-857`, the
`--dry-run` socket probe) are unchanged by this round; the caller said to leave
nits alone unless they are in a line already being changed.

**Tests.** `deploy/tests/host-setup.test.sh` section 4 stubs `systemctl` on
`PATH` (the same stub-bin style as `scheduled-backups.test.sh`) and runs
`doctor` with `DESKS_ENABLED=true`: a present unit with `MemoryMax=4294967296`
is reported installed (while the live cgroup path is absent on this machine, so
the old code would have FAILed), a missing unit FAILs, and a unit with
`MemoryMax=2147483648` FAILs. No host or real systemd is touched.

### Commands and real results (round 4)

- `sh deploy/tests/host-setup.test.sh` — **pass=44 fail=0**.
- `pnpm gate` (repo root) — exit 0:

  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/desk  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

`status` stays `review`.

## Review (written by Claude)
Lead, 2026-10-14: approved. Rescoped by Julio ('easy replicable … one moment to install and run all zilar'), then a lead hardening round, then pre-review CLEAN after 2 auto rounds, nit 3. Checks:
- deploy/tests/host-setup.test.sh passes (44);
- 'docker compose config --services' on the Coolify file without the desks profile lists only postgres, ejabberd, server and web;
- server DESK_AGENT_SOCKET defaults to empty;
- the desk services exit 0 unless DESKS_ENABLED=true and restart only on failure.
After deploy: check over SSH that no desk container runs. Enabling desks in production (sudo ./zilar host-setup, then the env) needs Julio's OK.
