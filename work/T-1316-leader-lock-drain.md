---
id: T-1316
title: "Zero-downtime phase 2 prep (server): a Postgres advisory-lock leader so background work runs on one instance when two overlap, and a ~5 s drain on SIGTERM (health 503, keep serving, then step down and close); leader-only startup moves out of main.ts; tested"
status: merged
milestone: M5
branch: task/T-1316-leader-lock-drain
model: auto
effort: default
depends_on: []
estimate: 0.8 day
---

# T-1316: Leader lock and SIGTERM drain (server)

## Spec (written by Claude, do not edit)

### Why
Julio approved zero-downtime deploys (2026-10-12, "Yes, go"; plan `docs/deploy/zero-downtime-plan.md`). Phase 2 runs the server as a Coolify Dockerfile app with rolling updates, so for about 5–30 s **two servers run side by side** on the same Postgres and ejabberd.

The audit `docs/audit/two-servers-audit.md` (T-1306) lists what must run only once (§1) and gives the design (§3, "Leader-lock design"). **Follow §3 exactly**; this spec only adds the drain and the size rule.
- The spike (plan, line 47-48) lost 1 request at the moment the old container stopped. The fix: on SIGTERM, keep serving about 5 s while `/health` reports unhealthy, then close.
- `apps/server/src/main.ts` is **723 lines**, over the 400-line rule. This task must not grow it: move the leader-only startup into new files, so `main.ts` gets shorter.

### What to build
1. **`apps/server/src/leader/lock.ts`** (new), as in audit §3:
   - one dedicated `postgres(url, { max: 1 })` connection, `.reserve()`d;
   - `pg_try_advisory_lock(<scope>, <key>)`, two-int form with its own scope constant (see `ais/provisioning-keys.ts:302-304`);
   - poll every 1 s while held elsewhere;
   - `onAcquire` / `stepDown()` / `isLeader()`;
   - if the lock connection errors while leader: log and `process.exit(1)` (via an injected exit for tests).
   - Log `leader acquired` and `leader stepped down` at info.
2. **`apps/server/src/leader/start.ts`** (new): the leader-only set, moved out of `main.ts`:
   - the push component and group notifier (`main.ts:500-535` incl. the room reconcile);
   - the agent gateway start (`:659`);
   - the approvals sweeper (`:678`);
   - the routines scheduler, action recovery and runner hub (cite each line).
   It starts them in `onAcquire` and stops them in `stepDown()`, in today's stop order. HTTP routes and everything per-request stay on every instance.
3. **Drain on SIGTERM**, in `stopServer`'s new order (`main.ts:118-150`):
   1. mark draining, so `/health` answers **503** with `{ ok: false, draining: true }` (`apps/server/src/health.ts`; keep the body shape otherwise);
   2. wait `DRAIN_MS`: default 5000, with a `SHUTDOWN_DRAIN_MS` config override in `apps/server/src/config.ts`; 0 in tests;
   3. `leader.stepDown()`, which stops the leader-only work and releases the lock;
   4. close HTTP;
   5. the rest, as today.
   The whole path must stay well under the compose `stop_grace_period` of 20 s (`deploy/coolify/docker-compose.app.yml:127`).
4. **`/health`:** add `leader: true | false` to the body, so the lead can verify it live. With one instance it must read `true`.
5. **Tests**, up to 3:
   - two lock instances on the same database: only one acquires; after `stepDown`, the other acquires within about 1.5 s. Use the test database the server tests already use, and check that it supports advisory locks (cite the setup); if it doesn't, say so and test with a fake lock port;
   - `stopServer` order: draining, then the wait, then `stepDown`, then close HTTP (fakes);
   - `/health` answers 503 while draining.
6. **No compose, Dockerfile or migration changes.** `main.ts` must end shorter than 723 lines; the new files stay at most 400.

### Read first
`AGENTS.md`, `docs/audit/two-servers-audit.md` (all of it), `docs/deploy/zero-downtime-plan.md`, `apps/server/src/main.ts`, `apps/server/src/health.ts`, `apps/server/src/health-status.ts`, `apps/server/src/config.ts`, and `apps/server/src/ais/provisioning-keys.ts:295-310`.

### Allowed files
`apps/server/src/leader/*.ts`, `apps/server/src/main.ts`, `apps/server/src/main.test.ts`, `apps/server/src/health.ts`, `apps/server/src/health-status.ts`, `apps/server/src/health.test.ts`, `apps/server/src/config.ts`, `work/T-1316-leader-lock-drain.md`. (The health body type is only in `apps/server/src/health.ts:18`; there's no contract file for it.)

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/leader src/main.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and `main.ts` is shorter.
- **The lead's live check after the deploy:**
  - `/health` shows `leader: true`;
  - the server log shows `leader acquired`;
  - a test AI message still gets an answer, a routine still fires, and push still works (`push: "online"`).

---

## Report (written by the worker when done)

### What I did

Implemented the Postgres advisory-lock leader and the SIGTERM drain (spec §"What to build", audit §3).

- **`apps/server/src/leader/lock.ts`** (new, 235 lines): `createLeaderLock` with `start`/`isLeader`/`stepDown`/`close`, a 1 s poll while the lock is held elsewhere, `leader acquired` / `leader stepped down` info logs, and an injected `exit` (defaults to `process.exit`). The connection errors through `onError` while leader → log + exit(1). `createPostgresLockConnection` runs `pg_try_advisory_lock(LEADER_LOCK_SCOPE, LEADER_LOCK_KEY)` on one `postgres(url, { max: 1 }).reserve()` connection; `LEADER_LOCK_SCOPE = 730034` is a dedicated scope (same precedent as `ENSURE_MODEL_LOCK_SCOPE`).
- **`apps/server/src/leader/start.ts`** (new, 230 lines): `createLeaderWork` holds the leader-only set — push component + group notifier + room reconcile (old `main.ts:488-548`), runner hub (`:628-653`), `gateway.start()` (`:659`), approvals sweeper (`:678`), action recovery timer + first `recoverStuck` (`:687-706`) and the routines scheduler (`:714`). `start()` runs them in today's start order; `stop()` stops them in today's stop order (runner hub → push → gateway → sweeper → recovery → scheduler). The runner hub is published through an `onRunnerHub` callback so the per-request `isMachineOnline` closure follows the leader.
- **`apps/server/src/main.ts`** (723 → **579** lines): the leader-only blocks above are gone; after the HTTP listener it builds `createLeaderWork(...)` and `createLeaderLock(...)` and calls `leader.start()`. `onAcquire` marks the health snapshot leader and starts the work; `onStepDown` stops the work and clears the flag. `stopServer` is now: mark draining → `Effect.sleep(drainMs)` → `leader.stepDown()` → close HTTP → dispose SQL → `closeDb` → `leader.close()` ("close the lock last", audit §3). `RunningServer` lost the per-component fields and gained `leader` + `drainMs`.
- **`apps/server/src/config.ts`**: added `SHUTDOWN_DRAIN_MS` (0–60000 ms, default `'5000'`).
- **`apps/server/src/health-status.ts`** + **`apps/server/src/health.ts`**: the snapshot/body now carry `leader: boolean` and `draining: boolean`; a draining instance answers 503 with `ok: false`, everything else unchanged.
- **Tests**: `leader/lock.test.ts` (takeover), `main.test.ts` (stopServer order), `health.test.ts` (503 while draining + leader flag).

### Files changed

`apps/server/src/leader/lock.ts`, `apps/server/src/leader/start.ts` (new); `apps/server/src/leader/lock.test.ts`, `apps/server/src/main.test.ts`, `apps/server/src/health.test.ts` (new); `apps/server/src/main.ts`, `apps/server/src/config.ts`, `apps/server/src/health.ts`, `apps/server/src/health-status.ts`, `work/T-1316-leader-lock-drain.md`. All inside the Allowed files.

### Commands and results

- `pnpm --filter @zilar/server exec vitest run src/leader src/main.test.ts --reporter=dot` → 2 files passed, 2 tests passed (~5.7 s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/health.test.ts` → 1 file passed, 1 test passed (~2.9 s).
- `pnpm gate` → GATE PASS. Summary lines:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (5.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First `pnpm gate` run failed on `format` for `health.ts` and `leader/lock.ts`; I ran `pnpm exec prettier --write` on those two files and the re-run above passed.)

### Advisory-lock test database (spec item 5)

The server test database is PGlite: `src/test-global-setup.ts` migrates one PGlite instance into a snapshot and `src/test-support.ts` `freshDatabase()` loads it into each test (`createTestContext`). PGlite is Postgres compiled to WASM, so it supports `pg_try_advisory_lock`, **but** it is a single in-process handle with no TCP port, and the lock path (audit §3) uses the `postgres` npm client (`postgres(url, { max: 1 }).reserve()`), which cannot connect to PGlite. Two PGlite handles are also two separate databases, so they could not contend on a real lock. I therefore tested the lock's acquire/poll/step-down state machine with a fake lock port (`LeaderLockConnection` shared between two `createLeaderLock` instances) rather than the real connection, as the spec allows.

### Deviations / notes

- The audit's file list mentions an optional `LEADER_LOCK_SCOPE` env override in `config.ts`; the spec's item 3 only asks for `SHUTDOWN_DRAIN_MS`, so I did not add the scope override. The scope is a constant in `leader/lock.ts`.
- The old push block logged "push is disabled/stays off" at boot on every instance; now those lines appear only once the instance becomes leader (the push component itself is leader-only).
- `stopServer` no longer calls `gateway.stop()`/the timer closes directly: `leader.stepDown()` does (the gateway is built in `main.ts` and started/stopped by the leader work). A follower never starts the gateway, so nothing is left running.

### Open question

Worst-case shutdown is now drain 5 s + `gateway.stop()` drain up to `AI_DRAIN_MS` 8 s + HTTP grace 3 s ≈ 16 s, which is above `FORCE_EXIT_MS = 15_000` (unchanged) though below the compose `stop_grace_period` of 20 s. Normal shutdown is ~8 s. I left `FORCE_EXIT_MS` as is because the spec did not ask to change it; if you want the worst case to finish before the force-exit, raise it (e.g. 18 s) in a follow-up.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (3 nits).**
- **Lock** (`leader/lock.ts`, 235 lines): a reserved `postgres` connection with `pg_try_advisory_lock`, polled every 1 s.
  - an acquire error retries with a log;
  - a lost connection while leader exits 1 (restart comes back as a follower);
  - `onAcquire` keeps each component's own catch (`leader/start.ts`), as `main.ts` did for `gateway.start()`, so a failing gateway or push never crash-loops the server.
- **Health:** 503 only for the DB or draining; a follower answers 200 with `leader: false`.
- **Size:** `main.ts` went from 723 to 579 lines (still over 400; the size plan carries the rest).
- **Nits accepted:**
  - the runner-hub late-resolve leak;
  - the health test's global state;
  - worst-case stop of about 16 s against `FORCE_EXIT_MS` of 15 s (the compose grace is 20 s).
- **Lead's checks after the rebase:** leader + main + health: 3 tests pass; full server suite: 66 files, 580 tests pass; server tsc: 0 errors.
- **After the deploy:** `/health` must show `leader: true` and `push: online`.
