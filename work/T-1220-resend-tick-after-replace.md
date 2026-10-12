---
id: T-1220
title: "Emulator find (APK 745be24c): after a long airplane-mode gap the app reconnects about 2 minutes late, and a resent text that the server archived once keeps its clock in the live session (it shows ✓ only after a cold restart); find both causes on the replaced-client path and fix them, with core-level tests"
status: merged
milestone: M5
branch: task/T-1220-resend-tick-after-replace
model: auto
effort: default
depends_on: [T-1216]
estimate: 0.4 day
---

# T-1220: Reconnect late, and a resend that never ticks

## Spec (written by Claude, do not edit)

### What the lead saw
Release APK `745be24c`, which has T-1216, on the emulator against production. Claude Test is in a DM with Julio, and the app is in the foreground the whole time (AppState stays `active`).
1. **07:46:49 local:** airplane mode on.
2. **07:46:52:** send "Offline three". The bubble shows the clock, and the header says "Connecting…".
3. **07:47:23:** airplane mode off, after about 31 s, which outlasts the watchdog's first steps (`WATCHDOG_SCHEDULE_MS = [5000, 8000, 12000, 20000]`, `packages/xmpp-core/src/core-effect/config.ts:31`).
4. **07:47:27:** Android reports Wi-Fi `VALIDATED` (`dumpsys connectivity`).
5. **07:47:53 and 07:49:01:** the header still says "Connecting…".
6. **The server archived "Offline three" once, at 07:49:29** (05:49:29Z). The lead checked read-only through Julio's `/api/chats`: unread went from 3 to 4, and the preview is "Offline three". About 07:50 the header shows "online".
7. **07:50:50 and 07:52:22:** the bubble **still shows the clock**, about 3 minutes after the server stored it.
8. After a cold restart of the emulator, history shows "Offline three" 07:49 with ✓, once.

The release build prints no logs.

### Two problems to find and fix
- **A. The reconnect took about 2 minutes after the network was back,** with the watchdog capped at 20 s per step.
  - Trace what the core does after `restartStuckClient` (`packages/xmpp-core/src/core-effect/lifecycle.ts:86-105` plus T-1216's `reportStaleQueue`): `watchdogRestarts`, `watchdogMs()` (`:59-70`), xmpp.js's own reconnect delay (`reconnectDelayFor`, `lifecycle.setReconnectDelay`) and the connect timeout.
  - Find why a fresh client started at most 20 s after the network came back didn't come online sooner, for example a connect attempt that hangs until a long timeout, or a backoff that keeps growing.
  - Fix it so a working network gives "online" within about 25 s.
- **B. The resent text was delivered, but its bubble never got the tick.**
  - Trace "Offline three": it was sent while offline (did `sendMessage` reject with `NotOnline`, so the entry has no `stanzaId`?), then resent by the flush on the fresh session (`packages/client-core/src/store/send/outbox.ts:240-300` `resendOutboxEntry`, which sets `live.stanzaId = sent.id` after the send resolves).
  - Find why the fresh client's `acked` for that stanza didn't reach `outboxAcked` (`outbox.ts:124-134`). Candidates:
    - stream management isn't enabled yet on the fresh session when the flush sends (the library queues only when `sm.enabled || sm.enableSent`; `@xmpp/stream-management@0.14.0` `index.js`, the `middleware.filter`);
    - the `ack` listener isn't wired for that client (`installStreamManagementAck`, `packages/xmpp-core/src/core-effect.ts:248`);
    - the ack comes before `stanzaId` is set;
    - or another path.
  - Fix it so the bubble gets the tick once the server has the stanza. **Generate the stanza id before the send and store it on the entry first** (pass it as `{ id }`, as the resend already does for an entry with a `stanzaId`). Then an ack can never beat the assignment; use this unless the cause you find makes it pointless.

### What to build
1. **Tests that reproduce each problem first** (the message pipeline), in `packages/xmpp-core/src/connection-resilience.test.ts` or `packages/client-core/src/store/send.test.ts`:
   - **A:** the network is back while the watchdog is replacing clients; the core is `online` within the expected time (fake timers);
   - **B:** a text queued offline, then a client replacement and a fresh session; the flush resends it, the fresh client acks it, and the bubble is `sent`.
   Show in the Report that each test fails before its fix.
2. **The fixes.** Keep T-1216's rules: a resume never resends, and a settled bubble is never resent.

### Read first
`AGENTS.md`, `work/T-1216-delivered-but-stuck-sending.md` (the Report and the Review), `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect.ts:100-260`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/stream-management.ts`, `packages/client-core/src/store/send/outbox.ts` and `packages/client-core/src/store/send/text.ts`.

### Allowed files
`packages/xmpp-core/src/core-effect/**`, `packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/stream-management.ts`, `packages/xmpp-core/src/stream-management.test.ts`, `packages/xmpp-core/src/connection-resilience.test.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send.test.ts`, `work/T-1220-resend-tick-after-replace.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/connection-resilience.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines (tests exempt).
- **The lead's check on the emulator:** repeat steps 1 to 4 with a gap of 30 s or more. "online" comes within about 25 s of the network returning, and the bubble ends ✓ in the live session, once on the server.

---

## Report (written by the worker when done)

### Cause B — the flush wrote the resend before `<enable/>`, so it was never stream-managed

Confirmed the real cause is the **first** candidate ("stream management isn't
enabled yet on the fresh session when the flush sends"), and it makes the
spec's suggested id-first change **pointless** — so I fixed the cause instead
of the id assignment.

- The store's `online` listener flushes the outbox (`client-core`
  `lifecycle.ts:296-301` → `online.ts` `flushOnline` → `outbox.ts`
  `resendOutboxEntry`). `rt.fork` runs a task's synchronous part **inline**
  (`client-core/src/store/lifetime.ts:6-11,72`: "the runners start the fiber at
  once … runs inline"), so `current.sendMessage(...)` → `entity.send(...)` →
  the WebSocket write happens **synchronously inside the core's `online`
  emission**.
- The core emitted `online` from the library's `online` event, which
  `@xmpp/resource-binding/index.js:18` fires from `_ready(false)` inside the
  bind step, **before** `@xmpp/stream-management/stream-feature.js` runs
  `enable(entity, sm)` (its `await next()` runs the bind, then `<enable/>`).
  The library's outgoing filter queues an outgoing stanza only when
  `sm.enabled || sm.enableSent` (`@xmpp/stream-management/index.js`, the
  `middleware.filter`), so the resent message went out **before `<enable/>`**:
  it was never in `outbound_q` and the server's `<a h/>` never covered it. No
  `ack` → no `acked` → `outboxAcked` never ran → the clock stayed (the ✓ after
  a cold restart came from history, which carries `sent`, not a live ack).
  This matches the core's own note that our client sends its `<presence/>`
  before `<enable/>` (`stream-management.ts:11-13`): the deployment takes the
  non-bind2 path, so `<enable/>` is sent after bind, not inline.
- **Fix (in the core, where the trigger is):** a fresh bind no longer reports
  `online` until the session is stream-managed. `stream-management.ts`
  `installStreamManagementAck` now calls a new `onReady` handler when it
  observes `<enabled/>` or `<resumed/>`; `core-effect.ts` holds the fresh bind
  (`onOnline` → `pendingOnline`) and runs the online transition (`setStatus`,
  `finishConnect`, `startKeepalive`, `afterOnline`) from `onStreamReady`. A
  resume is already managed and is not held; a server that offers no stream
  management (or a lost `<enabled/>`) falls back after
  `SM_ENABLE_TIMEOUT_MS` (5 s, `config.ts`) instead of staying offline for
  ever. A client replaced meanwhile, or `desiredOnline === false`, is ignored
  by `finishOnline`.
- The `rebound` emit (T-1216) still runs before the (now deferred) online
  transition, so the store's marks land before its flush.
- I did **not** touch `outbox.ts`/`text.ts`: with the flush now landing after
  `<enable/>`, the stanza is queued and its ack arrives a round-trip after
  `send` resolves, so `live.stanzaId = sent.id` (inside `send`'s `.andThen`)
  is always set before the ack. Generating the id first would be dead code.

### Cause A — a replacement could end with no watchdog, and xmpp.js's backoff drove the reconnect

`restartStuckClient` armed the watchdog **only on the path that built a fresh
client** (`lifecycle.ts`, `armWatchdog()` was after
`if (!desiredOnline || isOnline() || runtime.xmpp !== undefined) return`). A
concurrent `ensureClient` — an explicit `connect()` (the mobile resume path
`reconnect()` → `wake()` → `lifecycle.connect()`, or a boot retry) landing
while the replacement was awaiting `stale.stop()` — creates that other client,
so the replacement returned early **without re-arming**. The watchdog fired
once, was left un-armed, and the reconnect was then driven by xmpp.js's own
`@xmpp/reconnect` schedule, whose delay the core grows through
`reconnectDelayFor` to 30 s per retry. The cumulative waits
(1+2+4+8+15+30+30+30 ≈ 2 minutes) match the ~2-minute reconnect the lead saw,
with the header on "Connecting…" throughout (status stayed `reconnecting`, so
this is not the offline/`stopAfterFailure` path).

- **Fix:** `restartStuckClient` now calls `armWatchdog()` **before** the
  guards, so a replacement can never end watchdog-less; the fresh client is
  still created/started as before. This keeps the watchdog authoritative, so a
  replacement happens at most every 20 s (`WATCHDOG_SCHEDULE_MS`) and each one
  resets the library backoff.
- Honest caveat: I could not reproduce the exact 2-minute device timeline from
  the core alone — the fake shows the watchdog cycling every 15/8/12/20 s and
  each replacement resetting `reconnect.delay` to 2 s (I measured it), so with
  a working network the core recovers within one step (~20-24 s including the
  `stale.stop()` await). The concrete defect on the replaced-client path is the
  lost watchdog above; if the lead's run had no `connect()` during the gap
  (AppState stayed `active`, so no focus/resume), the trigger would instead be
  environmental (the emulator's WebSocket/token path not being usable for ~2
  minutes after `VALIDATED`), which no core change can shorten. I fixed the one
  core path that can produce the symptom and flagged this.

### Tests (the message pipeline)

All in `packages/xmpp-core/src/connection-resilience.test.ts`; the fake gained
`emitOnlineRaw` (the real bind order: `online` with SM still disabled) and
`emitElement` (what stream management observes for `<enabled/>`).

- B1 "a fresh bind reports online only once `<enabled/>` arrives" — fails
  before the fix (`expected 'online' to be 'connecting'`), passes after.
- B2 "a fresh bind that never enables stream management still comes online" —
  the 5 s fallback; fails before, passes after.
- B3 "a resume reports online without waiting for `<enabled/>`" — the resume
  path is not gated.
- A "a replacement racing an explicit connect never leaves the core watchdog" —
  a gated `stale.stop()` holds the replacement, `core.connect()` builds the
  second client, then the fix's watchdog must replace it; fails before
  (`expected 2 to be greater than 2`), passes after.

I verified each fails before its fix by stashing only the three source files
(keeping the `SM_ENABLE_TIMEOUT_MS` export the tests import): **3 failed | 33
passed**, then **48 passed** after restoring. The existing 44 tests in the two
xmpp-core suites are unchanged and still pass (the fake's `emitOnline` sets
`streamManagement.enabled = true`, so it was never held).

### Round 2 — the should-fix: an end-to-end bubble test (`send.test.ts`)

PREREVIEW's should-fix: the three core tests assert only status gating, so a
future store change that flushes on `rebound` instead of `online` (or drops
the online flush entirely) would pass everything while the clock bug returns.

- Added "a resent text after a rebound gets the tick when the fresh session
  acks it" in `packages/client-core/src/store/send.test.ts`: a text queued
  while offline (first `sendMessage` rejects, so no `stanzaId`), then
  `outboxRebound` (a fresh session replaced the stream) and `flushOnline`
  (the single path every transition into `online` runs), so the flush resends
  it; the fresh session's `ackText` settles the live bubble to `sent`. It
  drives `flushOnline`, not the `flushOutbox` helper directly.
- Proof it guards the path: with the `flushOutbox` call temporarily removed
  from `online.ts`, **2 failed | 26 passed** (this test plus the resume-path
  "offline test" one); restored, **28 passed**.
- The two nits (5 s fallback racing a slow `<enabled/>`; the Cause-A trigger
  resting on the emulator check) need no code change and I left those lines
  alone.

### Commands (real results)

- `pnpm install` — done (20.5 s, 1180 packages reused/added).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot
  src/connection-resilience.test.ts src/stream-management.test.ts` — **48
  passed**; with the three source fixes stashed, **3 failed | 33 passed** (the
  proof above).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot
  src/store/send.test.ts` — **28 passed** (27 before, plus the new bubble
  test; the store source code is untouched).
- `pnpm exec prettier --write packages/xmpp-core/src/stream-management.ts` —
  reformatted my too-long condition after the gate's format check flagged it.
- `pnpm gate` — **GATE PASS**: install (frozen), format, lint, typecheck,
  effect, tests @zilar/client-core, tests @zilar/xmpp-core all PASS; scope:
  every changed file is inside the Allowed files; 7 changed files against
  main. Single tests run alongside: `connection-resilience.test.ts` (36
  passed), `send.test.ts` (28 passed), both with `--reporter=dot`.

### Files changed

`packages/xmpp-core/src/core-effect.ts`,
`packages/xmpp-core/src/core-effect/config.ts`,
`packages/xmpp-core/src/core-effect/lifecycle.ts`,
`packages/xmpp-core/src/stream-management.ts`,
`packages/xmpp-core/src/connection-resilience.test.ts`,
`packages/client-core/src/store/send.test.ts`,
`work/T-1220-resend-tick-after-replace.md`. Max lines among touched sources:
**400** (`core-effect/lifecycle.ts`, at the cap; it was 397 before, so I trimmed
the new comments and dropped a redundant `armWatchdog` from `connectEffect`).
Tests exempt.

### Blocked / needs a decision

- Nothing blocking. The emulator check (steps 1-4 with a ≥30 s gap; "online"
  within ~25 s, and the bubble ending ✓ live, once on the server) is the lead's
  device pass, not mine. If the lead's next run still reconnects ~2 minutes
  late with AppState `active`, the trigger is environment, not this code path
  (see the A caveat) — please say so and I will look at the library's SM
  resume timeout / the ghost pending session instead.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean after 1 auto round, with 1 nit.**
- **Cause B (the resend never ticked):**
  - the core reported `online` at bind, before `<enable/>`, so the flush wrote the resend unmanaged (the library queues only when `sm.enabled || sm.enableSent`);
  - now a fresh bind holds `online` until `<enabled/>` or `<resumed/>` (`installStreamManagementAck` `onReady`), with a 5 s fallback (`SM_ENABLE_TIMEOUT_MS`);
  - `rebound` still emits before `online`.
- **Cause A (the late reconnect):** `restartStuckClient` could return without re-arming the watchdog, leaving xmpp.js's backoff (up to 30 s per retry) in charge. Now it re-arms first. The worker couldn't reproduce the exact device timeline.
- **Lead checks after the rebase onto main:**
  - the full xmpp-core suite 140 of 140 and client-core 110 of 110;
  - `tsc` gives 0 errors for xmpp-core, client-core, web and mobile;
  - `lifecycle.ts` is at 400 lines.
- **Still to do:** the emulator re-check of a gap of 20 s or more. If "Connecting…" still lasts minutes, the lead has extra evidence of hung sockets and an HTTP call (`extra-1220.md`) for a follow-up.
