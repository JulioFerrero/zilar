---
id: T-1995
title: "Runner and machines hardening: validate the jail image string, only the live tunnel connection fails a runner's requests, re-check the machine before each runner desk call, count machine/code/tool caps under a lock, rate-limit machine writes — with tests"
status: merged
milestone: M5
branch: task/T-1995-runner-machines-edges
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-1995: Runner and machines edges

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1986) found five low-severity gaps around paired computers ("machines" and their runners):
1. **Image string.** The runner takes the jail image string from the first server frame. Only the string's length is checked, and a value starting with `-` would be read by `docker create` as an option.
2. **Hello from another connection.** A connection that only sent `hello` with a machine id can, when it closes, fail every pending desk request of that machine's real, live connection.
3. **Revoke race.** A revoke handled by a process that doesn't run the hub leaves the runner connected for up to 30 s, and a running turn keeps using it.
4. **Caps can be passed.** The caps on machines, pairing codes and tools per topic are checked in one statement and inserted in another, so parallel requests can pass them.
5. **No write limit.** Machine write routes (rename, approve, deny, revoke, delete) have no rate limit.

### Facts (read by the lead on 2026-10-18)
- **The image string.**
  - `apps/runner/src/desk/handler.ts` (199 lines) pins the image from the first provision: `const image = this.image ?? imageDigest;` (`:119-122`).
  - `packages/runner-tunnel/src/desk-frames.ts` (144 lines) has `const digestSchema = boundedString(1, 256)` (`:37`), used for `image_digest` (`:81`).
  - `packages/desk/src/agent/docker-args.ts` (146 lines): `keepAliveFlags(image)` returns `['--entrypoint', 'sleep', image, 'infinity']` (`:29-31`). It is used at `:144`.
- **The tunnel.**
  - In `packages/runner-tunnel/src/server/handshake.ts` (65 lines), `conn.runnerId = runnerId` is set at `:24`, before the challenge is answered.
  - In `packages/runner-tunnel/src/server/conn.ts` (165 lines), the close path removes `rt.live` only when `rt.live.get(conn.runnerId) === conn` (`:116-118`). But it then runs `if (conn.runnerId !== null) rt.desk.failRunner(conn.runnerId);` (`:119`) without that guard.
- **Revoke.**
  - In `apps/server/src/machines/registry.ts` (87 lines), `notifyRevoked` (`:68-72`) calls only this process's listeners.
  - `apps/server/src/hands/resolve.ts:89-95` has `machineUsableFor(db)`, which checks `status === 'approved' && revokedAt === null`. `agents/gateway/desk-exec.ts:171-179` uses it when a desk is resolved.
  - `apps/server/src/hands/runner-hands.ts` (106 lines) defines `execute` at `:60`.
- **Caps.**
  - In `apps/server/src/machines/pairing.ts` (160 lines), `countActivePairingCodes` is read before the code insert (`:44-45`). The machine and pending-machine counts are read with `Promise.all` before the insert (`:113-128`).
  - In `apps/server/src/tools/mutations.ts` (334 lines), `enforceToolLimit` runs in its own `runSql` (`:74-81`). The `INSERT INTO ai_tools` runs later, in a separate transaction (`:82-…`). `enforceToolLimit` is defined in `tools/queries.ts:217`.
- **Machine writes.** `apps/server/src/machines/api.ts` (376 lines) builds `createCodeLimiter` and the pair limiters with `createRateLimiter` (`:100-115`). The rename, approve, deny, revoke and delete handlers have no limiter.
- **Existing tests:**
  - `packages/runner-tunnel/src/desk-server.test.ts`
  - `packages/runner-tunnel/src/desk-runner.test.ts`
  - `apps/runner/src/connect.test.ts`
  - `apps/server/src/hands/runner-hands.test.ts`

### Steps
1. **Validate the image string.**
   - In `desk-frames.ts`, validate `image_digest` against `^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$`.
   - In `docker-args.ts`, refuse an image that starts with `-` by throwing a fixed error.
2. **Only the live connection fails requests.** In `conn.ts`, call `failRunner` only when the closing connection is the live one, or its state is `ready`.
3. **Re-check before each runner call.** In `runner-hands.ts` `execute` (or in `desk-exec.ts` before each runner tool call), re-check `machineUsableFor` for the machine. If it is no longer usable, end the call with a fixed "This computer was disconnected" result.
4. **Count caps under a lock.**
   - Pairing codes, machines and pending machines: count inside the insert transaction under `pg_advisory_xact_lock(hashtext('machines:' + ownerUserId))`.
   - Tools: run `enforceToolLimit` inside the same transaction as the `INSERT INTO ai_tools`, under a lock keyed on the AI and topic.
5. **Limit machine writes.** Add one per-user write limiter (30 per minute) to rename, approve, deny, revoke and delete in `machines/api.ts`. Over the limit, they answer `429 rate_limited`.
6. **Tests.** This is the AI computer path:
   - a frame with a `-`-leading image is refused;
   - closing a `hello`-only connection keeps the live connection's pending requests;
   - a revoked machine stops the next runner call.

   Use the nearest existing test files.
7. **Keep every file at or under 400 lines.**

### Allowed files
- `packages/runner-tunnel/src/desk-frames.ts`
- `packages/runner-tunnel/src/server/conn.ts`
- `packages/runner-tunnel/src/desk-server.test.ts`
- `packages/desk/src/agent/docker-args.ts`
- `apps/runner/src/desk/handler.ts`
- `apps/server/src/hands/runner-hands.ts`
- `apps/server/src/hands/runner-hands.test.ts`
- `apps/server/src/agents/gateway/desk-exec.ts`
- `apps/server/src/machines/pairing.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/tools/queries.ts`
- `work/T-1995-runner-machines-edges.md`

### Checks
```bash
pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run src/hands --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- **Image string (step 1).**
  - `packages/runner-tunnel/src/desk-frames.ts`: `image_digest` is now checked
    against `^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$`, so a `-`-leading
    value never reaches the runner handler.
  - `packages/desk/src/agent/docker-args.ts`: `keepAliveFlags` throws the fixed
    error `the desk image is invalid` for any image starting with `-`.
- **Only the live connection fails requests (step 2).**
  - `packages/runner-tunnel/src/server/conn.ts`: `dropConn` records whether the
    closing connection is the live one, deletes it from `rt.live` only in that
    case, and calls `desk.failRunner` only when it was live or its state is
    `ready`. A connection that only sent `hello` (state `auth`) no longer fails
    the live connection's pending desk requests.
- **Re-check the machine before each runner call (step 3).**
  - `apps/server/src/agents/gateway/desk-exec.ts`: `DeskClient` and
    `DeskRunnerInput` gained an optional `isUsable` probe. `createDeskRunner`
    awaits it before every call and returns the fixed text
    `This computer was disconnected.` when it is false. `resolveTurnDesk` wires
    `isUsable` to `machineUsableFor(deps.db)` for a `runner` result, so a
    revoked machine stops the next tool call of a running turn.
- **Caps under a lock (step 4).**
  - `apps/server/src/machines/pairing.ts`: `createPairingCode` counts active
    codes and inserts inside one transaction under
    `pg_advisory_xact_lock(hashtext('machines:' + ownerUserId))`.
    `insertPendingMachine` counts machines and pending machines with one
    `count(*) FILTER (...)` query and inserts in the same locked transaction.
  - `apps/server/src/tools/queries.ts` / `mutations.ts`: `enforceToolLimit`
    takes an advisory lock keyed on the AI and topic, and
    `saveToolVersion` now calls it inside the same transaction as
    `INSERT INTO ai_tools`.
- **Machine write limit (step 5).** `apps/server/src/machines/api.ts` has one
  per-user limiter (30 per minute) checked by rename, approve, deny, revoke and
  delete; over the limit they answer `429 rate_limited`
  (`Too many machine changes, try again later`).
- **Tests (step 6).** Three new tests using the nearest existing files:
  - `packages/runner-tunnel/src/desk-server.test.ts`: a provision frame with a
    `-`-leading image is refused (and a pinned 64-hex digest is accepted); a
    closing hello-only connection leaves the live connection's requests pending
    and only the live connection's close fails them.
  - `apps/server/src/hands/runner-hands.test.ts`: once `isUsable` turns false,
    the next runner call returns `This computer was disconnected.` and does not
    reach `execute`.
- **Line limits (step 7).** Every changed file is within 400 lines (the largest
  is `machines/api.ts` at 397).

### Files changed

- `packages/runner-tunnel/src/desk-frames.ts`
- `packages/runner-tunnel/src/server/conn.ts`
- `packages/runner-tunnel/src/desk-server.test.ts`
- `packages/desk/src/agent/docker-args.ts`
- `apps/server/src/agents/gateway/desk-exec.ts`
- `apps/server/src/hands/runner-hands.test.ts`
- `apps/server/src/machines/pairing.ts`
- `apps/server/src/machines/api.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/tools/queries.ts`
- `work/T-1995-runner-machines-edges.md`

`apps/server/src/hands/runner-hands.ts` and `apps/runner/src/desk/handler.ts` are
in the Allowed files but needed no change: the frame schema rejects the bad
image before either is reached, and the re-check lives in `desk-exec.ts`.

### Checks run

- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/desk-server.test.ts`: 6 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands/runner-hands.test.ts`: 6 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-desk.test.ts`: 1 passed.
- `pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot --maxWorkers=2`: 4 files, 26 passed.
- `pnpm --filter @zilar/server exec vitest run src/hands --reporter=dot --maxWorkers=2`: 5 files, 30 passed.
- `pnpm gate` (from the repo root):

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (1.6s)
PASS  lint  (1.7s)
PASS  typecheck  (9.1s)
PASS  effect  (2.8s)
PASS  tests @zilar/desk  (4.1s)
PASS  tests @zilar/runner-tunnel  (4.3s)
PASS  tests @zilar/server  (33.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation (small):** the write limit is a handler-level
  `writeLimiter.allow(user.id)` check rather than `rateLimitLayer`, because a
  middleware tag for it would live in `packages/api-contract/src/machines.ts`,
  which is outside the Allowed files. The check runs after `Session`, so it is
  per user like the other limiters, and returns the same `429 rate_limited`
  envelope.
- **Deviation (small):** the machine re-check is implemented in `desk-exec.ts`
  (the spec allowed either place) via an optional `isUsable` on `DeskClient`;
  `runner-hands.ts` is unchanged.
- The `dropConn` test builds a minimal fake `ServerRuntime`/`ServerConn` and
  calls `dropConn` directly; it does not open a real socket.
- The new pairing/tool locks already run on PGlite in the gate's server tests,
  but no existing test exercises the pairing quota paths, so the new
  transactions are covered by the gate's normal server suite rather than a
  dedicated concurrency test.

### Round 1

- **Finding 1 (must-fix), fixed.** `packages/runner-tunnel/src/server/conn.ts`:
  `dropConn` now calls `desk.failRunner` only when the closing connection was
  live, or when it is ready and no live connection remains. A ready connection
  replaced by a newer one no longer fails its successor's pending requests.
- **Test added.** `packages/runner-tunnel/src/desk-server.test.ts`: "keeps the
  successor connection’s requests when a replaced connection closes" — a ready
  connection with a live successor is dropped, nothing fails and the successor
  stays live.
- **Nits (F2, F3) not changed.** They are outside the lines this round touches,
  so they stay as they are per the fix-round rules.
- **Checks.** `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2
  --reporter=dot src/desk-server.test.ts`: 7 passed. `pnpm gate`: `GATE PASS`
  (install, format, lint, typecheck, effect and all three test suites PASS;
  scope, migration, images and size ok).


## Review (written by Claude)

Approved after one auto round. The pre-review found two nits:
- **Digest anchor:** this one is wrong. Without the `m` flag, JS `$` matches only at the very end of the string.
- **Old count helpers:** they are still exported but no longer used. Harmless.

What changed:
- **Image digest:** it is validated.
- **Dropped connections:** only the live tunnel connection fails a runner's pending requests.
- **Runner calls:** each runner desk call re-checks the machine owner first.
- **Caps:** pairing codes, machines and tools are counted and inserted in one transaction, under a per-owner advisory lock.
- **Write limit:** machine writes are limited per user, and an over-limit write answers 429.
