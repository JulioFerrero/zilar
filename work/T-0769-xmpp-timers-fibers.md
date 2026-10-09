---
id: T-0769
title: "X2a: xmpp-core timers as Effect fibers — a small internal timers.ts (schedule(ms, f) → cancel, backed by Effect.runFork(Effect.sleep).. and Fiber.interrupt) replaces all 13 setTimeout/clearTimeout sites in client.ts (watchdog, connect timeout, keepalive idle and reply, join/history/upload/push request timeouts) with identical timing and ordering; every existing test unchanged"
status: todo
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

## Review (written by Claude)
