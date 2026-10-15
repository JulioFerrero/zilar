---
id: T-1449
title: "PERF-11: the chat-list and pins polls run every 5 minutes while XMPP is online, and every 60 s only when it is not"
status: merged
milestone: M5
branch: task/T-1449-poll-less-when-online
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1449: Poll less while online

## Spec (written by Claude, do not edit)

### Why
PERF-11 (`docs/audit/performance-audit.md`). Per the sweep (`docs/audit/findings-sweep-server.md`), the coalescing and debouncing are done, but the core ask is open: every open tab or app refetches `/api/chats` and the pins every 60 s, even while the XMPP socket is up and pushes changes live.

### Facts (the lead read them on main, 2026-10-15)
- **`packages/client-core/src/store/polling.ts`** (381 lines):
  - `TOPIC_REFRESH_INTERVAL_MS = 60_000` (`:16`) and `PINS_REFRESH_INTERVAL_MS = 60_000` (`:18`);
  - the chat-list loop at `:125-140`, where `everyInterval(TOPIC_REFRESH_INTERVAL_MS, …)` calls `refresh.ifStale()` while visible;
  - the pins loop (`everyInterval` at `:154`);
  - `refreshGate(ctx, …)` and `CHAT_REFRESH_COALESCE_MS` (`:23`).
- **The connection status** is written only through `ctx.fx.setStatus(status)`, at `packages/client-core/src/store/lifecycle.ts:188`, `:199` and `:226` and in `packages/client-core/src/store/online.ts`. Client-core keeps no readable copy of it.

### What to build
1. Keep the last status client-core set in one readable place on the ctx: set it next to every `ctx.fx.setStatus` call, or wrap `setStatus` once where the ctx is built.
2. Add `ONLINE_REFRESH_INTERVAL_MS = 300_000`. The two loops keep ticking every 60 s, but a tick refreshes only when:
   - the status is not `online`, **or**
   - the last refresh is older than `ONLINE_REFRESH_INTERVAL_MS`.
   Focus refreshes and push-driven refreshes keep today's behaviour.
3. `polling.ts` stays at 400 lines or fewer. Put the helper in a new small file if needed.

### Tests (the message pipeline's freshness)
In `packages/client-core/src/store/polling.test.ts`, using the fake clock there:
1. While online, a 60 s tick doesn't refresh, and a tick after 5 minutes does.
2. While offline or connecting, every 60 s tick refreshes.

### Allowed files
- `packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/polling.test.ts`
- `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/online.ts`
- one new helper file under `packages/client-core/src/store/` (name it in the Report)
- `work/T-1449-poll-less-when-online.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/polling --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the two tests pass.

---

## Report (written by the worker when done)

### What I did
- Kept the last connection status client-core writes on the ctx: added
  `connectionStatus?: ConnectionStatus | undefined` to `CoreCtx` (`ctx.ts`) and a
  `setConnectionStatus(ctx, status)` helper that writes it and calls
  `ctx.fx.setStatus(status)` in one place.
- Replaced all seven `ctx.fx.setStatus(...)` call sites in `lifecycle.ts`
  (`:188`, `:199`, `:226`, `:300`, `:341`, `:386`, `:392`) with
  `setConnectionStatus(ctx, ...)`. No other client-core or app code writes the
  status (grep: only `lifecycle.ts`).
- Added `ONLINE_REFRESH_INTERVAL_MS = 300_000` to `polling.ts`.
- `refreshGate` now exposes two methods beside `ifStale`: a shared `run(minAgeMs)`
  and `ifDue()`, which picks `ONLINE_REFRESH_INTERVAL_MS` when
  `ctx.connectionStatus === 'online'` and `CHAT_REFRESH_COALESCE_MS` otherwise.
  The two 60 s tick callbacks (chat list and pins) now call `refresh.ifDue()`;
  the focus handlers and the push-driven `scheduleChatsRefreshBurst` still call
  `ifStale`/`scheduleChatsRefresh` as before, so focus and push behaviour is
  unchanged.

### Deviations from the spec
- No new helper file was created. `lifecycle.ts` is already at its 400-line gate
  budget (400 on `main`), so an extra import line there failed `pnpm gate`
  (`size: lifecycle.ts: 401 lines`). I put `setConnectionStatus` in `ctx.ts`
  instead, which `lifecycle.ts` already imports from, keeping it at 400 lines.
  The Allowed list grants one helper file; it was not needed, so the file name
  is `n/a` (no file).
- `ifDue` uses `CHAT_REFRESH_COALESCE_MS` as the minimum age while not online,
  exactly as the tick did before (`ifStale`), so an offline tick that closely
  follows a focus is still coalesced. The spec's "a tick refreshes when not
  online" is satisfied; a refresh is never skipped that would not have been
  skipped before.

### Files changed
- `packages/client-core/src/store/ctx.ts` (field + helper)
- `packages/client-core/src/store/lifecycle.ts` (use the helper at the 7 sites)
- `packages/client-core/src/store/polling.ts` (constant + `ifDue` gate)
- `packages/client-core/src/store/polling.test.ts` (new tests)
- `work/T-1449-poll-less-when-online.md`

### Commands and results
- `pnpm install`: done (14.8s, unchanged from base; one pre-existing peer warning).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/polling.test.ts`:
  1 file passed, 16 tests passed (12 before, +4 new).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts`:
  1 file passed, 13 tests passed (it exercises the `setStatus` path at `:259`).
- `pnpm gate`: `GATE PASS`, 5 changed files:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
    `PASS effect`, `PASS tests @zilar/client-core`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Tests added (`polling.test.ts`)
1. Online: a focus seeds the baseline, the 60 s tick is skipped, and a tick at
   5 minutes refreshes the chat list; the same for the pins loop.
2. `it.each(['offline', 'connecting'])`: every 60 s tick refreshes the chat list.

### Open questions / notes
- First tick after boot while already online refreshes once (no refresh recorded
  yet, so `lastRunAt` is `-Infinity`, which reads as "older than 5 min"). This
  matches the spec's wording and is harmless (one refetch at boot). If the lead
  prefers no refresh at all while online from the start, the baseline could be
  seeded in boot; not done here.
- No security-sensitive code touched (no auth, routes, deletes or secrets).

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 3.
- Each 60 s tick now refreshes only when it is due: every 5 min while XMPP is online, and every 60 s otherwise.
- Focus and push refreshes keep the 10 s coalescing.
- Polling tests (16) pass locally.
