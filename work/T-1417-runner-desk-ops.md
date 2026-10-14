---
id: T-1417
title: "P3 runner hands: desk.* frames on the runner tunnel; the runner runs desks with the same packages/desk lifecycle and tool daemon (Linux: runsc, else refuse; macOS: Docker Desktop/OrbStack VM); no unsandboxed mode; local policy only tightens; tunnel-side request API for the server"
status: merged
milestone: M5
branch: task/T-1417-runner-desk-ops
model: auto
effort: default
depends_on: [T-1407]
estimate: 1.5 days
---

# T-1417: Runner desk operations

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: an AI can run on the user's own **runner**, "equal or better than our system", seamless and secure (`docs/design/agent-system.md` §2.6). The brain stays in the server; only the hands move. So the runner runs **the same image and the same tool daemon** as Zilar cloud, behind the same `Hands` interface (`packages/desk/src/hands.ts:113-121`).

**This is the plan's Task G, first half** (`docs/audit/desk-runner-plan.md` §2 "Messages", §6.1, §6.2 and §6.4):
- the frames;
- the runner side;
- isolation detection;
- local policy;
- a request API on the tunnel server.

**Not in this task:**
- the server's `RunnerHands` adapter and the hub wiring (the next task, after T-1413 frees `apps/server/src/machines/hub.ts`);
- deleting `model.open`;
- the runner egress proxy and token injection (§6.3);
- the Windows driver.

### Facts (the lead checked them on main, 2026-10-14)
- **The tunnel protocol** is `packages/runner-tunnel/src/protocol.ts` (229 lines): `PROTOCOL_VERSION = 1` at `:4`, frames at `:53-110` (snake_case), `parseControlMessage` at `:175`.
- **`runner.ts` is 646 lines and `server.ts` is 614, both over the 400 limit.** Add the new code in **new files** (e.g. `packages/runner-tunnel/src/desk-frames.ts`, `desk-runner.ts`, `desk-server.ts`), and keep the edits to `runner.ts`/`server.ts` to the few dispatch lines (net growth ≤10 lines each).
- **Dispatch points:** `RunnerClient.routeControl` at `runner.ts:532` (called at `:487`); the server side, `handleReadyMessage` at `server.ts:480` (called at `:420`); the mux attaches a socket to a stream (`attachSocketToStream`, `mux.ts`, plan §2 cites `:398`).
- **The runner app** is `apps/runner/src/`: `cli.ts` (340 lines; the `run` command at `:135`), and `capabilities.ts` (`detectDrivers` at `:106-120`, which today only probes Docker; the schema `drivers` is at `:66`). `identity.ts` stores `~/.zilar-runner/identity.json` (plan §6.4 cites `:80`).
- **The cloud sidecar logic to reuse** is `packages/desk/src/agent/`:
  - `lifecycle.ts` (provision, execute, stop, idle stop);
  - `docker.ts` (fixed run flags, runtime and cgroup parent from config);
  - `workspace.ts` (a disk image or a folder);
  - `admission.ts`;
  - `config.ts`.
  
  It's built to be driven by a socket server (`server.ts`). **The runner must call the same lifecycle in process**, not copy it.
- The desk image is pinned by digest (`packages/desk/README.md`).

### What to build
1. **Frames** (`desk-frames.ts`): the plan §2 set, with schemas in the existing style (snake_case, bounded strings):
   - server→runner `desk.provision {desk_id, ai_id, project_id, image_digest, limits, egress}`, `desk.exec {desk_id, stream_id}` and `desk.stop {desk_id, keep_workspace}`;
   - runner→server `desk.ready {desk_id}`, `desk.stopped {desk_id}` and `desk.error {desk_id, code, message}`;
   - errors use the fixed taxonomy (`not_provisioned | queue_full | jail_unavailable | timeout | output_too_large | path_escape | host_blocked | tool_failed`), plus `queued {desk_id, position}`;
   - leave out `desk.snapshot` for now;
   - bump `PROTOCOL_VERSION` to 2, and have the server **still accept 1**, so old runners keep pairing.
2. **The runner side** (`desk-runner.ts` in runner-tunnel, wired from `routeControl`, with an injected handler):
   - the runner app supplies a handler that calls the `packages/desk` lifecycle;
   - `desk.exec` attaches the daemon's stdin/stdout to the mux stream (`docker exec -i … desk-tool serve`, exactly like the sidecar).
3. **Isolation** (`apps/runner/src/desk/driver.ts`, new). Pick a driver at start-up:
   - **Linux:** Docker with the `runsc` runtime registered → driver `runsc`. Otherwise **refuse**, since no unsandboxed mode exists. (bwrap is a later task; say so in the Report.)
   - **macOS:** Docker Desktop or OrbStack (a Linux VM is the boundary) → driver `docker-vm`, with `--runtime` left at the default.
   - **Other:** refuse.
   
   **Refusing means the runner still pairs and serves its other features, but answers every `desk.provision` with `jail_unavailable`,** and `capabilities.drivers` reports what was found (extend `detectDrivers`).
4. **Local policy** (`apps/runner/src/desk/policy.ts`, new):
   - read `~/.zilar-runner/policy.json`, optional, with fields `allowNetwork`, `maxMemoryGb`, `maxCpuShares`, `maxDiskGb` and `maxRunning`;
   - **the effective limits are min(server request, local)** for every field;
   - a clamp is logged (ids and numbers only);
   - when the file is missing, the defaults are the plan's (2 GiB, 256 pids, 5 GiB disk, 2 running).
5. **Tunnel server API** (`desk-server.ts`): a typed method on the tunnel server, `sendDesk(runnerId, frame)`, that resolves with the runner's reply frame (ready, error or queued) with a timeout, and `openDeskExec(runnerId, deskId)` that returns a duplex stream. The hub and `Hands` wiring comes in the next task.
6. **Runner README** (`apps/runner/README.md`): a short "AI computers on your runner" section covering the drivers, the policy file and "no unsandboxed mode".

### Tests (auth/permissions: required, few)
- **`packages/runner-tunnel/src/auth.test.ts`** (extend):
  - a `desk.*` frame before authentication is refused;
  - a `desk.provision` from the runner direction (the wrong direction) is refused.
- **`apps/runner/src/desk/driver.test.ts`:** with no jail driver, a provision answers `jail_unavailable` (no unsandboxed fallback).
- **`apps/runner/src/desk/policy.test.ts`:** a server asking for more than the local ceiling is clamped, and it never loosens.

### Read first
`AGENTS.md`, `docs/audit/desk-runner-plan.md` §2 and §6, `packages/desk/README.md`, `packages/desk/src/agent/`, `packages/runner-tunnel/src/` (`protocol.ts`, `runner.ts` `routeControl`, `server.ts` `handleReadyMessage`, `mux.ts`), and `apps/runner/src/`.

### Allowed files
`packages/runner-tunnel/src/**`, `apps/runner/**`, `packages/desk/src/agent/**`, `packages/desk/src/index.ts`, `packages/desk/package.json`, `pnpm-lock.yaml`, `work/T-1417-runner-desk-ops.md`.

### Checks
```bash
pnpm --filter @zilar/runner-tunnel exec vitest run src/auth.test.ts --reporter=dot
pnpm --filter @zilar/runner exec vitest run src/desk --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and new files are at most 400 lines; `runner.ts`/`server.ts` grow by at most 10 lines each.
- **A local check in the Report:** on this Mac (Docker or OrbStack if present), the runner's desk handler provisions a desk, runs `bash echo ok` through a local mux pair (no server needed), and stops it. If no Docker is present, show the `jail_unavailable` refusal instead.

---

## Report (written by the worker when done)

### What I did

Built the runner desk operations (plan Task G, first half): the `desk.*` frames,
the runner side, isolation detection, local policy, and the tunnel server's
request API. The hub/`RunnerHands` wiring and `model.open` deletion are the
next task, as the spec says.

1. **Frames** — `packages/runner-tunnel/src/desk-frames.ts`: `desk.provision`,
   `desk.exec`, `desk.stop` (server→runner) and `desk.ready`, `desk.stopped`,
   `desk.error`, `queued` (runner→server), snake_case with bounded schemas and
   the fixed error taxonomy. `desk.snapshot` is left out. `protocol.ts` bumps
   `PROTOCOL_VERSION` to 2 and registers the frames in both direction maps.
2. **Version gate** — the server now accepts versions 1 and 2
   (`isAcceptedProtocolVersion`), so old runners keep pairing; a version-2
   runner speaking to a version-1 runner's hub is unchanged (the hub must only
   send `desk.*` to v2, a note for the next task).
3. **Runner side** — `desk-runner.ts`: `DeskRunner` handles the three
   server→runner frames with an injected `DeskRunnerHandler`, answers with the
   reply frames, and for `desk.exec` bridges the mux stream to a loopback pair
   given to the handler. Wired from `RunnerClient.routeControl` via a new
   optional `RunnerOptions.deskRunner`. A buffering sink is registered before
   the loopback pair is built, so the first request bytes the server sends
   cannot be dropped by the mux's unknown-stream path (a race I hit locally).
4. **Isolation** — `apps/runner/src/desk/driver.ts` picks `runsc` on Linux when
   the runtime is registered with Docker, `docker-vm` on macOS (Docker
   Desktop/OrbStack, `--runtime` omitted), and refuses otherwise. **bubblewrap
   on Linux is not implemented; the runner refuses (`jail_unavailable`)** —
   spec allows this. On refusal the runner still pairs and serves its other
   features. `capabilities.drivers` now reports what was found
   (`docker`/`runsc`/`docker-vm`) through the same `detectDriver`.
5. **Local policy** — `apps/runner/src/desk/policy.ts` reads
   `~/.zilar-runner/policy.json` (optional; `allowNetwork`, `maxMemoryGb`,
   `maxCpuShares`, `maxDiskGb`, `maxRunning`), and `min(server request, local)`
   clamps every field it has a ceiling for. A clamp is logged with field names
   and numbers only. Missing or invalid file → the plan defaults (2 GiB, 256
   pids, 5 GiB disk, 2 running, network allowed).
6. **Runner handler** — `apps/runner/src/desk/handler.ts` drives
   `@zilar/desk`'s `Lifecycle` **in process** (not a copy) with the detected
   driver, clamps with the policy, and rejects with `jail_unavailable` when the
   driver is `none`. `connect.ts` builds it at `run` start-up and passes it to
   `RunnerClient`; the policy/workspaces live under `~/.zilar-runner/`.
7. **Tunnel server API** — `desk-server.ts`: `TunnelServer.desk.sendDesk(...)`
   resolves with the runner's reply frame with a timeout, and
   `TunnelServer.desk.openDeskExec(...)` returns a duplex socket bridged to the
   jail's daemon. The server routes reply frames to it, and fails pending
   requests when a runner drops.
8. **README** — an "AI computers on your runner" section covers the drivers,
   the policy file and "no unsandboxed mode".

### Files changed

- New: `packages/runner-tunnel/src/desk-frames.ts`, `desk-runner.ts`,
  `desk-server.ts`; `apps/runner/src/desk/{driver,handler,policy}.ts` and their
  two tests; `packages/desk/src/agent/index.ts` (barrel for the runner).
- Edited: `packages/runner-tunnel/src/{protocol,runner,server,index,auth.test}.ts`;
  `apps/runner/{README.md,package.json,src/capabilities.ts,src/cli.ts,src/connect.ts}`;
  `packages/desk/src/agent/{config,docker}.ts`, `packages/desk/package.json`
  (adds the `./agent` export), `pnpm-lock.yaml`.
- `runner.ts` grew by exactly 10 lines and `server.ts` by 9 additions/2 deletions
  (net +7); all new files are well under 400 lines (largest: handler.ts, 199).

### Commands run (real results)

- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot`:
  **21 passed** (2 files).
- `pnpm --filter @zilar/runner test --maxWorkers=2 --reporter=dot src/desk`:
  **14 passed** (2 files).
- `pnpm --filter @zilar/runner test --maxWorkers=2 --reporter=dot src/connect.test.ts src/capabilities.test.ts src/cli.test.ts`:
  **35 passed** (3 files).
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/server.test.ts src/agent/lifecycle.test.ts`:
  **16 passed** (2 files).
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.5s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/desk  (1.1s)
  PASS  tests @zilar/runner  (1.4s)
  PASS  tests @zilar/runner-tunnel  (1.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Acceptance check on this Mac (real Docker, no server)

Docker Desktop is present and `zilar-desk:dev` exists, so I ran the real path: a
throwaway script (deleted after the run, never committed) built a local `ws` mux
pair, put `DeskServer` on one end and `DeskRunner` + `RunnerDeskHandler` on the
other, and went through the frames:

```
driver: docker-vm
provision reply: {"type":"desk.ready","desk_id":"desk-demo-proj"}
bash output: "ok" done: {"id":1,"done":true,"exit_code":0,"truncated":false}
stop reply: {"type":"desk.stopped","desk_id":"desk-demo-proj"}
```

So on this Mac the runner provisions a desk, runs `bash echo ok` over a local mux
pair, and stops it. The `jail_unavailable` refusal (no driver → no unsandboxed
fallback) is covered by `apps/runner/src/desk/driver.test.ts`.

### Deviations, limits and open questions

- **`model.open` is untouched** (the spec lists its deletion as out of scope).
- **No bubblewrap** on Linux: without `runsc` the runner refuses. Explicit in the
  spec's Report note.
- **No egress proxy** (§6.3 is a later task): the handler builds the lifecycle
  with `egress: null`, so a server's `egress` policy is only *tightened* by
  `allowNetwork: false`; it is not applied yet.
- **Image pinning**: when no local `image` is configured, the runner pins the
  image from the **first** `desk.provision` and rejects any later digest. The
  hub task should decide whether the runner gets a configured local pin instead.
- **desk id contract**: the handler requires `desk_id === deskName(ai_id,
  project_id)` (the deterministic name `Lifecycle` uses), so `desk.exec`/`stop`
  can address the container. If the hub picks another id scheme, this needs a
  small change on both sides.
- **Runner workspace mode is `dir`** (a plain folder, no root). A Linux
  loop-mounted workspace/disk quota is a later task.
- **Idle stop is not wired** on the runner (the `Lifecycle` has `sweepIdle`; no
  timer is started here). Worth adding with the hub wiring.
- `packages/desk/package.json` gains a `./agent` subpath and `apps/runner`
  depends on `@zilar/desk`; `DockerSettings.runtime` is now `string | null` so
  macOS can omit `--runtime`. Nothing else in the sidecar changes.
- The four new plain-async files carry a `// effect-plain:` marker for the
  Effect ratchet, matching the existing host-daemon code.

### Round (fix round, 2026-10-14)

Findings fixed (from `PREREVIEW.md`):
- **Finding 1 (must-fix)** — desk replies are now matched to the runner that was
  asked. `DeskServer.pending` is keyed by `runnerId + desk_id` (a `\u0000`
  composite) and `route(runnerId, message)` drops a reply from any other runner,
  so runner B can no longer resolve runner A's request, and two runners may hold
  a request for the same deterministic `desk_id` without the false "in flight"
  rejection. `server.ts:509` now passes `conn.runnerId` into `route`.
- **Finding 2 (should-fix)** — `DeskRunner` now takes an optional handler; with
  none it uses a refusing handler that answers `desk.provision`/`desk.stop` with
  `jail_unavailable` and rejects `desk.exec`, matching the
  `RunnerOptions.deskRunner` comment and the "no unsandboxed mode" contract.
  `RunnerClient` always builds a `DeskRunner` and always dispatches, so a
  handler-less runner no longer hangs `sendDesk` until its timeout.

No must-fix or should-fix findings were left unfixed. Nits 3 (`driver.ts`
`hasRunsc`) and 4 (`server.ts` stores no negotiated version) were left as they
are: they are nits and neither is in a line this round touched (nit 4 is
explicitly for the hub task).

Tests added (one per behaviour fix):
- `packages/runner-tunnel/src/desk-server.test.ts` — a reply from another runner
  does not resolve a request; the owner's reply does; two runners can hold the
  same desk id.
- `packages/runner-tunnel/src/desk-runner.test.ts` — a `DeskRunner` with no
  handler answers `desk.provision` with `jail_unavailable`.

Disagreements: none.

Commands (real results):
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/desk-server.test.ts src/desk-runner.test.ts src/auth.test.ts`: **19 passed** (3 files).
- `pnpm --filter @zilar/runner-tunnel typecheck`: clean.
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.7s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/desk  (1.1s)
  PASS  tests @zilar/runner  (1.2s)
  PASS  tests @zilar/runner-tunnel  (1.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```
  `runner.ts` grew by 10 lines and `server.ts` by 9 additions/2 deletions
  (unchanged from the original round); all new files are under 400 lines.

Two commits, one per finding:
`22730514c T-1417: fix finding 1 - match desk replies to the runner that was asked`
and `8317cce8b T-1417: fix finding 2 - refuse desks when the runner has no handler`.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 1 auto round, nit 2.
- The size rule holds: runner.ts +10 and server.ts +5 net.
- Local tests: runner-tunnel auth 15, runner desk 14.
- The worker's acceptance on this Mac (real Docker, no server) provisions a desk, runs 'bash echo ok' over a local mux pair and stops it; with no driver, the refusal is jail_unavailable.
- Next: the server RunnerHands adapter and hub wiring.
