---
id: T-1626
title: "AI computers survive deploys: the desk agent removes its jails on SIGTERM and sweeps leftovers at start (stopAll), and re-registers a known jail with the egress proxy on every provision, so a proxy restart never leaves a jail with a rejected (407) credential"
status: merged
milestone: M5
branch: task/T-1626-jails-across-restarts
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1626: Jails and deploys

## Spec (written by Claude, do not edit)

### Why
On live (2026-10-16) @Deepseek's computer reached the web at 23:41 UTC. At 23:45 every request failed with `CONNECT tunnel failed, response 407`.

What the lead verified on the VPS:
- **The jail outlived the deploys.** The jail `desk-0c520a6c-…-default` was created at 23:41:16 and was still there after deploys restarted `desk-agent` and `desk-egress` (latest start 23:47:16).
- **The registrations were lost.** The proxy's registry is in memory, so after a restart the jail's credential was unknown, hence the 407.
- **The agent never removes its jails on shutdown.** In `packages/desk/src/agent/main.ts:85-98`, `shutdown` only clears the timer and closes the socket. Every deploy therefore leaves running jails behind, holding memory, with dead credentials.
- **A known jail is never re-registered.** `Lifecycle.provision` returns early for a jail it knows (`packages/desk/src/agent/lifecycle.ts:125-132`) without re-registering with the proxy, so a restart of the proxy alone also breaks it.
- **T-1620** (merged) recreates a jail this process doesn't know, but only when that AI provisions again. Leftovers keep running until then.

### Facts (the lead read them on 2026-10-16, main after T-1624)
- **`packages/desk/src/agent/lifecycle.ts`** (313 lines):
  - `provision` (`:125-145`) returns `{ kind: 'ready', ref: existing.ref }` early when `records` has the desk;
  - `registerEgress(name, spec)` (`:184-194`) is idempotent per process, because the registrar memoizes one secret per desk (`packages/desk/src/agent/egress.ts:28-40`);
  - `stopAll()` (`:286-312`) removes every container from `docker.listDeskNames()` (label `zilar.desk=1`, `packages/desk/src/agent/docker.ts:32,324`), releases each record's workspace, clears the records and admission, and unregisters egress.
- **`packages/desk/src/agent/main.ts`** (115 lines): `main()` calls `start()`, polls readiness, runs the idle sweep on a timer (`:85-90`), and has `shutdown` on SIGTERM and SIGINT (`:91-98`).
- **The `desk-agent` compose services** set no `stop_grace_period`, so Docker's default is 10 s.

### Steps
1. **`main.ts`, the shutdown:**
   - before closing the server, run `running.lifecycle.stopAll()`, bounded by an 8-second timeout (`Promise.race`) so the 10-second grace is never exceeded;
   - log one line with how many jails were removed or failed;
   - then close the server as today.
2. **`main.ts`, the start:** right after `start()`, run `running.lifecycle.stopAll()` once to remove jails left from an earlier process (a crash, or an old agent without step 1). Log one line if it removed any. The workspaces stay (images and folders); only containers go.
3. **`lifecycle.ts`, a known jail:** in `provision`, when `records` has the desk, call `await this.registerEgress(name, existing.spec)` before returning `ready`. It's the same secret, so the jail's env stays valid, and it heals a proxy-only restart. If that call throws, log it and still return `ready`, as today.
4. **Tests** in `packages/desk/src/agent/lifecycle.test.ts`: a second `provision` of the same key calls the registrar's `register` again with the same desk id. Covering steps 1 and 2 with a test is optional (`main` wiring).
5. **Change nothing else.**

### Allowed files
- `packages/desk/src/agent/main.ts`
- `packages/desk/src/agent/lifecycle.ts`
- `packages/desk/src/agent/lifecycle.test.ts`
- `work/T-1626-jails-across-restarts.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **After a deploy,** no jail from the old agent is still running, and the next job gets a fresh jail whose proxy credential works.
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- **`packages/desk/src/agent/main.ts`**
  - Added `STOP_ALL_TIMEOUT_MS = 8_000` and a `stopAllJails(running, log, reportIdle)` helper. It lists the live desk names with `docker.listDeskNames()`, runs `lifecycle.stopAll()` and races the pair against the 8 s timeout; it never rejects (errors are logged). It logs one line with the removed and failed counts.
  - `main()` now runs `stopAllJails(running, log, false)` right after `start()` (logs only when it removed a jail or a release failed), and `shutdown` runs `stopAllJails(running, log, true)` before `server.close()` (always logs one line), so cleanup cannot exceed Docker's 10 s stop grace.
  - `RunningAgent` now also exposes `docker` so both call sites can count jails left behind.
- **`packages/desk/src/agent/lifecycle.ts`** — in `provision`, when `records` has the desk it now calls `await this.registerEgress(name, existing.spec)` before returning `ready`. The registrar memoises one secret per desk for the process, so this re-registers the same credential the jail already carries and heals a proxy-only restart. A failure is logged and dropped; `ready` is still returned.
- **`packages/desk/src/agent/lifecycle.test.ts`** — added two tests: a second `provision` of the same key calls the registrar's `register` again with the same desk id (`['desk-ai1-p1', 'desk-ai1-p1']`) and does not recreate the container, and a `register` failure on the second `provision` still returns `ready` and logs the failure.

### Checks run

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/lifecycle.test.ts` → `Test Files 1 passed (1)`, `Tests 16 passed (16)` (14 before, +2 new).
- `pnpm gate` (repo root) →
  ```
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/desk  (3.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- The first `pnpm gate` run failed only on `format` for `lifecycle.ts`; I fixed it with `pnpm exec prettier --write packages/desk/src/agent/lifecycle.ts` and the second run passed.

### Notes for the lead

- The spec says "log one line with how many jails were removed or failed", but `Lifecycle.stopAll()` returns only the number of workspace-release failures (`server.test.ts:291` asserts `stopAll()` resolves to `1`), and that test is not in my Allowed files. So the helper counts removals with `docker.listDeskNames()` before calling `stopAll()` and reports `stopped N jail(s), M failed`. That is why `RunningAgent` grew a `docker` field. If you would rather keep `RunningAgent` unchanged, the alternative is to change `stopAll`'s return shape, which would need `server.test.ts` updated too.
- "Removed" is the number of desk containers listed before the sweep; a container whose `docker.remove` throws makes `stopAll` reject, which the helper catches and logs as `stopping jails failed: …`.
- Steps 1 and 2 (`main` wiring) are not covered by a test, as the spec marks that optional; the logic is exercised only through `pnpm gate`'s typecheck/lint.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, no nits.
- **On SIGTERM,** `stopAllJails` runs `lifecycle.stopAll()`, bounded at 8 s by `Promise.race`, before the socket closes. The same sweep runs once at start.
- **A known jail** re-registers its secret with the proxy on every `provision`, so a proxy-only restart heals.
- **The tests:** the lead ran `lifecycle.test.ts`: 16 passed. `main.ts` is 171 lines and `lifecycle.ts` 323.
- **Live check after the deploy:**
  - no jail is older than the new `desk-agent`;
  - a fresh @Deepseek web request gets 200 through the proxy.
- **Known limit:** the start sweep removes every `zilar.desk=1` container on the host. Two installs on one host would remove each other's jails, and they already collide on the fixed `desk-net` name. That's one backlog item for both.
