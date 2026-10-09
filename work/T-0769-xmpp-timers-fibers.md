---
id: T-0769
title: "X2a: xmpp-core timers as Effect fibers — a small internal timers.ts (schedule(ms, f) → cancel, backed by Effect.runFork(Effect.sleep).. and Fiber.interrupt) replaces all 13 setTimeout/clearTimeout sites in client.ts (watchdog, connect timeout, keepalive idle and reply, join/history/upload/push request timeouts) with identical timing and ordering; every existing test unchanged"
status: merged
milestone: M5
branch: task/T-0769-xmpp-timers-fibers
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-0769 (X2a): xmpp-core timers become interruptible fibers

## Spec (written by Claude, do not edit)

### Why
This is the xmpp-core lane of `docs/audit/effect-100-plan.md` (§3.1, "Timers as fibers"), accepted by Julio on 2026-10-09. The lead splits the plan's X2 into small, safe steps. This first one is mechanical: every timer becomes an Effect fiber behind a tiny helper, while the control flow and the public API stay as they are. The connection state machine, the event PubSub and the request Deferreds follow in later tasks. X1 (T-0763, merged) added the typed errors in `src/errors.ts`.

### Verified facts (do not re-derive)
- **The timers** in `packages/xmpp-core/src/client.ts`:
  - the pending-request types hold a `timer: ReturnType<typeof setTimeout>` (lines 145, 153, 159);
  - the closure keeps `keepaliveIdleTimer` (253), `keepaliveReplyTimer` (254), `watchdogTimer` (255) and `connectTimer` (263);
  - `setTimeout` sites: lines 331 (the watchdog, in `armWatchdog`), 541 (keepalive idle, in `startKeepalive`), 559 (keepalive reply, in `sendKeepalivePing`), 881 (the connect timeout), 925 (join), 1046 (history), 1075 (upload slot) and 1118 (push toggle);
  - `clearTimeout` sites: lines 324, 443, 498, 512, 516, 586, 759, 763, 799, 835, 934, 1056, 1096 and 1132.
- **The tests:** `packages/xmpp-core/src/connection-resilience.test.ts` uses `vi.useFakeTimers()`, and the other suites use real short timeouts through `XmppCoreOptions`. T-0764 (`apps/server/src/drafts/hub.ts`) showed that `Effect.runFork(Effect.sleep(ms)...)` honours vitest fake timers, and that `Effect.runSync(Fiber.interrupt(fiber))` cancels synchronously (`vi.getTimerCount()` drops to 0).
- **The package** depends on `effect` `^4.0.2`. The guide is `docs/EFFECT_GUIDE.md` (timers must be interruptible, line 165).

### What to build
1. **`packages/xmpp-core/src/timers.ts`** (internal; not exported from `index.ts`):
   - `export type Cancel = () => void`;
   - `export function schedule(ms: number, run: () => void): Cancel`. It forks `Effect.sleep(Duration.millis(ms))` followed by `Effect.sync(run)`. The returned `Cancel` interrupts the fiber synchronously and is idempotent;
   - a defect thrown by `run` is caught and dropped, exactly like an exception in a `setTimeout` callback today (it must not crash the process; read what happens today).

   Test it in `timers.test.ts`: it runs after the delay, cancel stops it, a second cancel is harmless, it works under fake timers, and a throwing `run` is isolated.
2. **`client.ts`:** replace every `setTimeout` with `schedule` and every `clearTimeout` with the stored `Cancel`. The fields become `Cancel | undefined`, and the pending types hold `cancel: Cancel`. Keep every guard, every order of operations and every delay value exactly as they are. Do not change anything else in the file.
3. **Tests:** every existing xmpp-core test passes unchanged: `core.test.ts`, `connection-resilience.test.ts`, `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts`, `stanza.test.ts` and `errors.test.ts`. Run the suite 3 times to catch flakiness, and report all three counts. Then run the consumers' tests: the web store suite (`pnpm --filter @zilar/web test --reporter=dot src/store`), the mobile store suite (`pnpm --filter @zilar/mobile test --reporter=dot src/store`) and the server gateway (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway`). They use the real or a fake client, so a timing change would show up there.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.1, `packages/xmpp-core/src/client.ts` (the whole file), `apps/server/src/drafts/hub.ts` (the fiber pattern), `packages/xmpp-core/src/connection-resilience.test.ts`.

### Allowed files
`packages/xmpp-core/src/timers.ts`, `packages/xmpp-core/src/timers.test.ts`, `packages/xmpp-core/src/client.ts`, `work/T-0769-xmpp-timers-fibers.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core test --reporter=dot
pnpm gate
```
Also run the consumers' suites listed in step 3 and paste their counts.

### Acceptance
- `client.ts` has no `setTimeout` or `clearTimeout`, and the timing and order are identical.
- All the xmpp-core and consumer suites pass unchanged, 3 of 3 runs green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.
- **Not deployed until Julio's live check** (messaging and reconnect; the plan's X2 flag). The lead runs the check.

---

## Report (written by the worker when done)

### What I did
- `packages/xmpp-core/src/timers.ts` (new, internal, not exported from `index.ts`): `type Cancel = () => void` and `schedule(ms, run): Cancel`. It does `Effect.runFork(Effect.sleep(Duration.millis(ms)).pipe(Effect.andThen(Effect.sync(...run...)), Effect.catchDefect(() => Effect.void)))`. `Cancel` runs `Effect.runSync(Fiber.interrupt(fiber))`.
- `packages/xmpp-core/src/client.ts`: all 8 `setTimeout` and all 14 `clearTimeout` sites replaced (`grep` finds none left). The four closure fields are `Cancel | undefined`; `PendingJoin`, `PendingQuery` and `PendingIq` hold `cancel: Cancel` instead of `timer`. Delays, guards and order of operations are unchanged; the only edits are the call form (`schedule(ms, cb)` instead of `setTimeout(cb, ms)`), the field name and `x.cancel()` instead of `clearTimeout(x.timer)`.
- `packages/xmpp-core/src/timers.test.ts` (new, 7 tests): runs after the delay, runs synchronously inside the timer tick (`vi.advanceTimersByTime`), cancel drops the pending timer at once (`vi.getTimerCount()` is 0), double cancel and cancel after firing are harmless, a throwing `run` surfaces as an uncaught exception (see fix round 1) and later timers still work, a run can cancel another timer, a run can cancel its own timer and schedule again.

### One deliberate addition to the helper (needed for identical behaviour)
`finishConnect` calls `clearTimeout(connectTimer)` while the connect-timeout callback itself is running it (`finishConnect(new ConnectTimeout())`). With `setTimeout` that is a no-op. With a bare `Fiber.interrupt` inside the fiber's own callback, my first version failed: the interrupt of the running fiber threw, `catchDefect` swallowed it, and the `ConnectTimeout` was never reported (found by my own re-entrancy test). So `schedule` keeps a `finished` flag, set right before `run` is called and when cancelled; `Cancel` returns at once when it is set. This is exactly `clearTimeout`'s semantics (no-op after the timer fired, or twice).

### What happens today vs now when a timer callback throws
- Today: an exception in a `setTimeout` callback is uncaught. In Node it ends the process (`uncaughtException`), in a browser it is logged to the console, in React Native it is a red box or a fatal JS error.
- Now (after fix round 1, lead decision: identical behaviour wins): `schedule` catches the defect with `Effect.catchDefect` and rethrows the same value from a new `setTimeout(..., 0)`, outside the Effect runtime, so it surfaces as an uncaught exception exactly as before. I chose `setTimeout` over `queueMicrotask` because the old throw happened in a timer task (a macrotask), so ordering relative to other work and the report channel match. In tests the rethrow is a fake-clock timer, so it surfaces from the call that advances the clock and never reaches vitest's unhandled-error report; the test asserts `rejects.toBe(boom)` and that a later timer still fires. No current callback is expected to throw: they are `void restartStuckClient()` (async), `void sendKeepalivePing()` (async), `reconnectDeadConnection()` (its `disconnect()` calls sit in try/catch), `finishConnect(...)` and `Map.delete` plus `reject(...)`.

### Commands and real results
Counts before my change (baseline) and after:

| Suite | Before | After (run 1 / 2 / 3 where noted) |
| --- | --- | --- |
| xmpp-core (`pnpm --filter @zilar/xmpp-core test --reporter=dot`) | 8 files passed + 4 skipped; 215 passed, 4 skipped | 9 files passed + 4 skipped; 222 passed, 4 skipped in all 3 runs (215 old + 7 new in `timers.test.ts`) |
| web store (`src/store`) | 10 files, 196 passed | 10 files, 196 passed |
| mobile store (`src/store`) | 293 passed, 1 skipped | 24 files passed + 1 skipped; 293 passed, 1 skipped |
| server gateway (`src/agents/gateway`, `--maxWorkers=2`) | 1 file, 168 passed | 1 file, 168 passed |

No existing test was changed. `pnpm exec prettier --write` was run on the three changed source files.

`pnpm gate`:
```
gate: 3 changed file(s) against main
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  tests @zilar/xmpp-core
scope: every changed file is inside the Allowed files
GATE PASS
```

### Notes
- The spec's pointer to `apps/server/src/drafts/hub.ts` as the fiber pattern does not match the file (it still uses `setTimeout`); I used `apps/server/src/machines/hub.ts` for the `runFork` / `Fiber.interrupt` idiom and checked the 4.0.2 `.d.ts` for `runFork`, `catchDefect`, `sleep` and `Fiber.interrupt`.
- Not live-checked (no XMPP server touched), as the spec says the lead does the messaging and reconnect check.

## Review (written by Claude)

**2026-10-09, lead:** approved after one fix round (a throwing callback is rethrown from a fresh `setTimeout`, the same surface as before). Worker: Sonnet 5.5. The lead reviewed the code directly.
- **The timers:** `schedule` and `Cancel` (with the `finished` flag for re-entrant cancels) replace all the `setTimeout` and `clearTimeout` sites in `client.ts`; the delays and order are unchanged.
- **The suites pass unchanged:** xmpp-core (3 runs, 222), the web store (196), the mobile store (293) and the server gateway (168).
- **Before deploy:** a live messaging and reconnect check. The lead does a local web check first; the live one needs Julio.
