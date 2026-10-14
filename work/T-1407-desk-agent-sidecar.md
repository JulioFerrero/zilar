---
id: T-1407
title: "P2 task B: the hands interface (provision/execute/stop/snapshot) and the host desk-agent sidecar that runs desk jails (fixed docker run flags, gVisor runtime, shared memory pool with admission control, fair queue, idle stop, disk-image workspaces) behind a unix-socket API"
status: merged
milestone: M5
branch: task/T-1407-desk-agent-sidecar
model: auto
effort: default
depends_on: [T-1403]
estimate: 1 day
---

# T-1407: Hands interface and desk-agent sidecar

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AIs get a Linux computer only while a task needs one; jails run on the current VPS. Memory is **one shared pool that can't take the VPS down**, and each AI's workspace is a **fixed-size disk image file** (`docs/design/agent-system.md` §2.3 and §7, decisions 1, 5 and 6).

**The plan is `docs/audit/desk-runner-plan.md`:** read §2 (the hands interface and messages), §4.2 (lifecycle and run flags), §4.3 (queue), §4.4 (why a sidecar, never the Docker socket in the app) and §8 Task B. `packages/desk` (T-1403, merged) has the image and the `desk-tool` daemon (`packages/desk/src/serve.ts`, protocol in `packages/desk/src/protocol.ts`).

**Nothing is deployed in this task.** The gVisor install and the sidecar's host setup are Task D, with Julio's OK at install time.

### What to build
1. **`packages/desk/src/hands.ts`:** the `Hands` interface and the types exactly as in plan §2 (`DeskKey`, `DeskLimits`, `DeskEgressPolicy`, `DeskSpec`, `DeskRef`, `DeskToolCall`, `DeskChunk`, `SnapshotRef`), plus the fixed error codes from §2 "Limits and errors".
2. **`packages/desk/src/agent/`** is the sidecar, one module per concern, each at most 400 lines:
   - **`server.ts`:** a unix-socket server (path from config, default `/run/zilar/desk.sock`).
     - It speaks newline JSON requests: `provision`, `execute` (it streams the daemon's chunks back), `stop`, `snapshot`, `status`.
     - It validates every request with Effect Schema and **never** accepts a host path, an image name, a runtime flag or an arbitrary command. Only the fields of `DeskSpec` and `DeskToolCall` are allowed.
   - **`docker.ts`:** creates, execs and removes jails by running the `docker` CLI with a **fixed argument list** built in code: `execFile`, never a shell.
     - Use the flags from plan §4.2 (`--runtime` configurable: `runsc` on the VPS, `runc` for local tests; read-only root; tmpfs; `--cap-drop ALL`; `no-new-privileges`; `--pids-limit 256`; `--network` and the proxy env from config).
     - Memory per jail: `--memory 2g --memory-swap 2g --memory-reservation 1g`.
     - All jails go under one parent cgroup: `--cgroup-parent` from config, default `zilar-desks.slice`. **Task D** creates that slice on the host with a hard `MemoryMax=4G`, so the kernel's OOM kill stays inside the pool.
     - The image is the configured pinned digest only.
   - **`workspace.ts`:** each `DeskKey` gets a sparse ext4 **disk image file** (default 5 GB) under the configured root (default `/var/lib/zilar/desks/<aiId>/<projectId>.img`).
     - It's created on first provision (`truncate` + `mkfs.ext4 -q`), loop-mounted read-write on a host folder, and bind-mounted as `/workspace` into the jail.
     - It's unmounted on stop; the image survives.
     - Ids are validated (`[A-Za-z0-9_-]{1,64}`) so no path can escape the root.
   - **`admission.ts`:**
     - a new jail starts only while fewer than `DESK_MAX_RUNNING` (default 12) run **and** the pool's memory use is under 75% of its max (read `memory.current` and `memory.max` of the parent cgroup; when unreadable, fall back to the count only);
     - otherwise the request waits in a **fair queue**: FIFO per owner, round-robin across owners;
     - `provision` answers `queued` with a position, and the caller retries.
   - **`lifecycle.ts`:**
     - `provision` is idempotent per `DeskKey` (it returns the live jail);
     - **idle stop after 2 minutes** without `execute`;
     - `stop` keeps the workspace image;
     - a `Stop all` admin call kills every `desk-*` container;
     - `snapshot` copies the workspace image to `<root>/snapshots/<aiId>/<projectId>/<label>.img` (a simple copy is fine for now).
3. **`apps/server/src/hands/cloud-hands.ts`:** the app-side `Hands` implementation over the unix socket, plus `apps/server/src/hands/wiring.ts`, which builds it only when `DESK_AGENT_SOCKET` is set (new optional config in `apps/server/src/config.ts`). It's not used by the agent loop yet; Task C does that.
4. **A sidecar entry point** `packages/desk/src/agent/main.ts` (reads config from env), and one paragraph in `packages/desk/README.md` on how to run it locally with `--runtime runc`.

### Tests (security and the money-like caps only, few)
- **`packages/desk/src/agent/admission.test.ts`:** the running cap; the 75% memory rule; fairness (two owners alternate).
- **`packages/desk/src/agent/server.test.ts`:**
  - a request with an extra field (a host path or image) is refused;
  - provision is idempotent per `DeskKey` (with a fake docker layer);
  - the id validation refuses `../x`.

**No real Docker in unit tests.** Do run one manual local check with `--runtime runc` (Docker on this Mac works): provision → `execute` `bash` `echo ok` → stop. Paste the exchange in the Report.

### Read first
`AGENTS.md`, `docs/audit/desk-runner-plan.md` §2, §4 and Task B, `docs/design/agent-system.md` §2.3, and `packages/desk/`.

### Allowed files
`packages/desk/**`, `apps/server/src/hands/*.ts`, `apps/server/src/config.ts`, `pnpm-lock.yaml`, `work/T-1407-desk-agent-sidecar.md`.

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file is at most 400 lines.
- The tests above pass.
- The Report shows the local runc provision → exec → stop exchange, and says which commands the sidecar needs root for (`mount`, `losetup`), for Task D.

---

## Report (written by the worker when done)

### What I did

The hands interface and the host desk-agent sidecar, plus the app-side client.
Nothing is deployed and nothing is wired into the agent loop.

- `packages/desk/src/hands.ts` — the §2 types (`DeskKey`, `DeskLimits`,
  `DeskEgressPolicy`, `DeskSpec`, `DeskRef`, `DeskToolCall`, `DeskChunk`,
  `SnapshotRef`, `Hands`) as Effect schemas + derived types, the plan's
  per-jail ceilings, and `DeskQueued`. The fixed error codes stay in
  `protocol.ts` and are already re-exported by the package index.
- `packages/desk/src/agent/` (one module per concern, each ≤ 400 lines):
  - `config.ts` — env → `AgentConfig` (socket, workspace root/mode, disk size,
    running cap, idle, pool cgroup path, Docker settings).
  - `docker.ts` — `execFile`/`spawn` only, never a shell. `docker create` uses a
    fixed argument list built in code (§4.2 flags), the configured pinned image
    only, `--cgroup-parent`, `--network`, proxy env, and a `--label`/name for
    `Stop all`. Each `execute` runs one
    `docker exec -i --user desk <jail> /opt/desk/desk-tool serve` and maps the
    daemon's stdout/stderr/done/error lines to `DeskChunk`/`DeskError`.
  - `workspace.ts` — per-`DeskKey` sparse ext4 image (`truncate` + `mkfs.ext4`),
    `mount -o loop,rw` onto a host folder, bind-mounted as `/workspace`;
    `release` unmounts and keeps the image; `snapshot` copies it. Ids are checked
    against `[A-Za-z0-9_-]{1,64}` before any path is joined.
  - `admission.ts` — running cap + the 75% memory rule (reads `memory.current` /
    `memory.max` of the parent cgroup, count-only fallback when unreadable) and a
    fair queue: FIFO per owner, round-robin across owners. The pool is read once,
    then the decision and the state change are synchronous.
  - `lifecycle.ts` — `provision` idempotent per `DeskKey`, idle stop
    (`sweepIdle`, no timer in tests), `stop` keeps the workspace, `snapshot`,
    `status`, `Stop all` over every labelled `desk-*` container.
  - `wire.ts` + `server.ts` — the newline-JSON unix-socket protocol and server
    (`provision`/`execute`/`stop`/`snapshot`/`status`/`stop_all`). Every request
    is decoded with `onExcessProperty: 'error'`, so an extra field (a host path,
    an image, a runtime flag) is refused before any Docker call.
  - `main.ts` — reads config from env, listens, sweeps idle every 30 s, closes on
    SIGTERM/SIGINT.
- `apps/server/src/hands/cloud-hands.ts` — the app-side `Hands` over the unix
  socket (one connection per call; `execute` streams). `wiring.ts` builds it only
  when `DESK_AGENT_SOCKET` is set; that new optional key is in
  `apps/server/src/config.ts`.
- `packages/desk/README.md` — a section on the sidecar, its env, and the local
  `--runtime runc` run.

### Tests run (single files)

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/admission.test.ts src/agent/server.test.ts`
  → `Test Files 2 passed (2)`, `Tests 13 passed (13)`. Covers the running cap,
  the 75% memory rule, count-only fallback, idempotency, two-owner alternation
  and `clear`; and, over the real unix socket with a fake Docker layer, an extra
  field refused, an escaping id refused, a non-pinned digest refused, provision
  idempotent per `DeskKey`, execute streaming + `not_provisioned`, and `stop_all`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands/cloud-hands.test.ts`
  → `Test Files 1 passed (1)`, `Tests 2 passed (2)`. The app-side client against a
  fake socket: provision → execute stream → stop (`keepWorkspace:false`), a queued
  answer (`HandsQueued`, position 2) and a fixed error code.

### `pnpm gate` (repo root, after all fixes)

```
PASS  install (frozen)  (0.9s)
PASS  format  (1.3s)
PASS  lint  (0.6s)
PASS  typecheck  (2.3s)
PASS  effect  (1.0s)
PASS  tests @zilar/desk  (1.2s)
PASS  tests @zilar/server  (5.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Manual local check (`--runtime runc`)

Command (one temp script that starts the sidecar and talks to it through the
app-side client over the real socket):

```bash
DESK_IMAGE=zilar-desk:dev DESK_ALLOW_UNPINNED_IMAGE=true DESK_RUNTIME=runc \
  DESK_NETWORK=none DESK_CGROUP_PARENT= DESK_WORKSPACE_MODE=dir \
  DESK_WORKSPACE_ROOT=$TMPDIR/zilar-desks DESK_AGENT_SOCKET=$TMPDIR/zilar-desk.sock \
  pnpm --filter @zilar/desk exec tsx $TMPDIR/desk-check.mts
```

Output:

```
provision -> {"id":"desk-ai1-p1","key":{"aiId":"ai1","projectId":"p1"}}
chunk -> {"type":"stdout","data":"ok\n"}
chunk -> {"type":"exit","code":0,"truncated":false}
stop -> done
status -> {"running":[],"queued":0}
```

`docker ps -a` afterwards lists no `desk-*` container. This ran the real Docker
CLI (create → start → `docker exec … desk-tool serve` → `docker rm -f`) with
`runsc` swapped for `runc`.

### Which commands need root (for Task D)

- `workspace.ts` in `image` mode: `mkfs.ext4` to create the image, `mount -o loop`
  to mount it and `umount` to release it. I used `mount -o loop` rather than
  `losetup` + `mount`, so the kernel picks the loop device itself; no separate
  `losetup` call is needed (`losetup` is still an implicit root-only operation
  underneath).
- Docker socket access (the `docker group` or root).
- `truncate` only needs write access to the workspace root.
- `dir` mode (macOS dev) needs no root.

### Deviations and notes

- **App-side types are duplicated** in `apps/server/src/hands/cloud-hands.ts`
  (with a comment pointing at the source of truth). `apps/server/package.json`
  is not in the Allowed files, so I could not add the `@zilar/desk` dependency,
  and `@zilar/desk` is not resolvable from the server today. The shapes are
  structurally identical and every reply is re-validated. **Recommendation:** add
  `"@zilar/desk": "workspace:*"` to `apps/server/package.json` in Task C (which
  needs the shared types anyway) and delete the local copies.
- **`DESK_ALLOW_UNPINNED_IMAGE=true`** (local only): Docker Desktop has no
  registry digest for a locally built `zilar-desk:dev`, so the required local
  `runc` check cannot satisfy the pinned-digest rule otherwise. In production the
  default requires `…@sha256:…`; the sidecar also refuses any `imageDigest` in a
  request that is not the configured image.
- **`DESK_WORKSPACE_MODE=dir`** (default `image`): macOS has no loop device, so
  the local check uses a plain bind-mounted folder instead of the ext4 image. The
  VPS default stays `image`.
- **`provision` returns `ready | queued(position)`**, not a bare `DeskRef`, so the
  socket can answer `queued` without blocking. The app-side `Hands.provision`
  maps `queued` to a thrown `HandsQueued` (a code `queue_full` case); Task C
  catches it for "Queued (n ahead)". The plan's `Hands.provision` signature is
  unchanged.
- **Bind mount, not a named volume**: §4.2 shows
  `--mount type=volume,…`; the task's workspace section requires the disk image
  mounted on a host folder and bind-mounted as `/workspace`, so `docker.ts` binds
  the folder.
- **Keep-alive entrypoint**: the image's `ENTRYPOINT` is `desk-tool serve`, which
  exits on stdin EOF, so `docker create` overrides it with
  `--entrypoint sleep … infinity` (built in code) and each `execute` opens its
  own `docker exec … desk-tool serve`.
- One extra test file (`cloud-hands.test.ts`) beyond the two named: it caught a
  real bug in the client (a request that was never written to the socket) and a
  wrong Effect decode call in `docker.ts`, both fixed.

### Security checklist

- The socket decodes requests strictly and only exposes `DeskSpec`/`DeskToolCall`;
  a host path, image, runtime flag or arbitrary command cannot be sent.
- Docker is called with `execFile`/`spawn` and a fixed argument list; every jail
  runs the configured pinned image with `--read-only`, dropped caps and
  `no-new-privileges`.
- Ids are validated before path joins in both the schema and `workspace.ts`, so
  no path can escape the workspace root.
- Errors are the fixed mini-taxonomy with written sentences; no raw host text.
- The running cap is one synchronous decision after a single `await`, so two
  demands cannot both take the last slot; `release` is called when a stop or a
  failed provision frees a slot.

### Round 1 (fix round)

Findings fixed:

- **Must-fix 1** — `lifecycle.ts` now has `assertRef`: `execute`, `stop` and
  `snapshot` reject with `not_provisioned` when `ref.id !== deskName(ref.key)`, so
  one owner cannot name another owner's jail while sending its own key. Test:
  `server.test.ts` "refuses a ref whose id does not match its key".
- **Must-fix 2** — the `provision` catch now runs `docker.remove(name)` before
  releasing the workspace and the admission slot, so a container left behind by a
  failed `start` no longer wedges the key. Test: "removes a partial jail when
  provision fails, so the key is usable again".
- **Should-fix 3** — `provision` keeps a per-key in-flight promise
  (`Lifecycle.inflight`); a concurrent caller for the same key joins it instead of
  running a second `create`. Test: "runs one create for concurrent provisions of
  the same key".
- **Should-fix 4** — `stop` releases the admission slot in a `finally`, so a
  throwing `umount` cannot permanently lose a slot. Test: "frees the admission
  slot even when the workspace release throws".
- **Should-fix 5** — `main.ts` gained `runIdleSweep`, which catches and logs a
  failed sweep instead of floating the promise; the interval callback uses it.
  Test: "logs idle sweep failures instead of crashing the daemon".
- **Should-fix 6** — `docker.ts` exports `createArgs`; `server.test.ts` asserts
  the §4.2 flags (`--read-only`, `--cap-drop ALL`, `no-new-privileges`,
  `--runtime`, `--pids-limit`, memory flags, `--network`, the workspace bind
  `--mount`, the pinned image and the `--label`), and the fake `create` now
  records its `(name, spec, workspaceDir)` so the pinned digest and the bind
  directory are asserted through `provision` too. The fake cannot see the fixed
  flags (they are built inside the real layer), so the flags are asserted against
  the exported builder and the fake covers the pinned image and bind dir. Tests:
  "builds the §4.2 fixed flags and the pinned image for every jail", "binds the
  workspace directory and the pinned image into the jail".

Nits 7 and 8 were left untouched per the fix-round rules (not in a line this
round changed). Nit 7 asks to confirm intent on the memory flags: the code scales
`--memory`/`--memory-swap`/`--memory-reservation` from `spec.limits.memoryBytes`;
for a full-size jail the spec ceiling is `2g`, so the values are `2g/2g/1g`, and
for a smaller spec the jail simply gets a proportionally smaller limit. This is
intentional (the limits come from the validated spec), but the plan's fixed
`2g/2g/1g` wording is only reproduced at the ceiling; leaving it as-is.

Tests added: 8 new cases in `packages/desk/src/agent/server.test.ts` (7 behaviour
+ 1 flag assertion), all passing.

Round gate (repo root):

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.7s)
PASS  lint  (0.7s)
PASS  typecheck  (1.7s)
PASS  effect  (0.5s)
PASS  tests @zilar/desk  (1.4s)
PASS  tests @zilar/server  (6.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

Single test run used while fixing (quiet reporter, worker cap):
`pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts`
→ `Test Files 1 passed (1)`, `Tests 14 passed (14)`.

### Round 2 (fix round)

Findings fixed:

- **Should-fix 1** (PREREVIEW) — `packages/desk/src/agent/server.test.ts` was 457
  lines, over the 400-line acceptance limit. The shared fakes and the per-test
  harness moved to `packages/desk/src/agent/test-harness.ts` (193 lines), the
  server/protocol cases stayed in `server.test.ts` (201 lines), and the
  lifecycle-level cases (partial-jail cleanup, concurrent provision, admission
  slot release, idle sweep) moved to `packages/desk/src/agent/lifecycle.test.ts`
  (99 lines). Every file is now ≤ 400 lines.

Tests added: none. This is a file split, not a behaviour change; the same 14
cases still run, now spread over the two test files. No assertion changed.

Single test run used while fixing (quiet reporter, worker cap):
`pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts src/agent/lifecycle.test.ts`
→ `Test Files 2 passed (2)`, `Tests 14 passed (14)`.

Round gate (repo root):

```
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (1.5s)
PASS  effect  (0.5s)
PASS  tests @zilar/desk  (1.4s)
PASS  tests @zilar/server  (6.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Fix round (lead)

Three items, one commit each:

- **Item 1** — `lifecycle.ts` `provisionNew`: the catch now frees the admission
  slot in a `finally`, always attempts the workspace release even when the jail
  removal fails, and logs a failed release (desk id + error message) without
  hiding the original error. `main.ts` passes a `log` into `Lifecycle`. Test:
  `server.test.ts` "frees the admission slot when a failed provision cannot
  release the workspace".
- **Item 2** — `lifecycle.ts` `stopAll`: every record's workspace is released in
  its own `try`/`catch` (errors collected and logged), then `records` and
  `admission` are always cleared; `stopAll` returns the number of failures.
  Test: `server.test.ts` "clears records and admission when one stop_all release
  fails".
- **Item 3** — `admission.ts` `tryAcquire`: a not-yet-queued arrival is admitted
  directly only when the queue is empty; otherwise it is enqueued and served in
  its fair order, so it cannot jump ahead of a waiting request. Test:
  `admission.test.ts` "makes a newcomer wait behind an already-queued request".

Commands run:

```
pnpm --filter @zilar/desk exec vitest run --reporter=dot --maxWorkers=2
→ Test Files 6 passed (6), Tests 36 passed (36)

pnpm gate
PASS  install (frozen)  (1.4s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (1.9s)
PASS  effect  (0.7s)
PASS  tests @zilar/desk  (2.1s)
PASS  tests @zilar/server  (14.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

Status stays `review`.

### Disagreements

None. All must-fix and should-fix findings were applied.

## Review (written by Claude)

Lead, 2026-10-14: approved after 2 auto rounds and 1 lead round:
- the provision failure path frees the admission slot in finally;
- stopAll always clears;
- newcomers queue behind waiting requests.
Final re-review CLEAN, nit 4. Lead checks: docker.ts uses fixed flags (--runtime, --read-only, --cap-drop ALL, no-new-privileges, --cgroup-parent); 6 desk test files pass locally (36 tests). Nothing deployed: Task D (gVisor, the zilar-desks.slice with MemoryMax=4G, the sidecar service and socket mount) needs Julio's OK on the VPS.
