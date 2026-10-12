---
id: T-1216
title: "Emulator find (APK 86f8eef2): a text sent as the network drops reaches the server, but its bubble stays 'sending' after the reconnect (and would turn 'Not sent' at the 10-minute cap, inviting a duplicate Retry); find why the stream-management ack or the resend never settles it, fix it, and prove it with a core-level test"
status: merged
milestone: M5
branch: task/T-1216-delivered-but-stuck-sending
model: auto
effort: default
depends_on: [T-1197, T-1213]
estimate: 0.4 day
---

# T-1216: A delivered text must not stay "sending"

## Spec (written by Claude, do not edit)

### What the lead saw
Release APK `86f8eef2`, which has T-1153, T-1197 and T-1213, on the emulator against production. Claude Test is in a DM with Julio.
1. **05:42:20 local:** airplane mode on. The header shows "Connecting…".
2. **About 05:42:40:** send "Offline two". The bubble shows the clock.
3. **The server archived it at 03:42:46Z (05:42:46 local).** The lead checked read-only through Julio's `/api/chats`: `lastMessage.text = "Offline two"`, `at = 2026-10-12T03:42:46.466Z`, `unread: 3`, so **no duplicate**. The stanza went out on a socket that wasn't fully dead yet, and its stream-management ack never came back.
4. **About 05:43:00:** airplane mode off. The header is back to "online" within 25 s.
5. **At 05:44:30,** about 90 s online, the bubble still shows the clock. It will turn "Not sent" at `OUTBOX_MAX_WAIT_MS` (T-1197), even though it was delivered. A Retry then sends it again; receivers dedupe on `<origin-id/>`, but the sender's view is wrong either way.

The release build prints no logs, so the exact path isn't known.

### Candidates to check (read the code; cite the lines)
- **A. A resume, not a rebound.** If the stream **resumed** (XEP-0198 `resumed`), the server's `<a h=…/>` should ack the stanza. Check that xmpp-core turns a resume's `h` into `acked` events for the queued stanzas (`packages/xmpp-core/src/core-effect/…`, the stream-management code; `packages/xmpp-core/src/stream-management.test.ts`), and that the client's `ackText` matches the `stanzaId` the outbox entry holds.
- **B. A rebound with a resend.** If it was a new session, T-1197 resends entries waiting for an ack (`packages/client-core/src/store/online.ts`, `packages/client-core/src/store/send/outbox.ts`).
  - Check that the resend really happens on that path (does `flushOnline` run after a `rebound`?);
  - check that its `acked` updates the entry's `stanzaId` before the ack arrives (the resend success handler sets `live.stanzaId = sent.id`; a race?);
  - check that `outboxAcked` (`outbox.ts:100-110` or wherever it is now) finds the entry and marks the bubble `sent`.
- **C. The mobile wake path.** AppState stays `active` during airplane mode, so the mobile `reconnect()` path may not run, and xmpp.js's own reconnect drives everything. Trace which events the client gets in that case.

### What to build
1. **A test that reproduces it first** (the message pipeline), in `packages/xmpp-core/src/connection-resilience.test.ts` or `packages/client-core/src/store/send.test.ts`, whichever fake core can model it. The sequence: send a text, the socket drops before the ack, the core reconnects (both a resume **and** a new session), and the bubble must end `sent`. Show in the Report that it fails before the fix.
2. **The fix:** in whichever candidate is real.
3. **Safety net:** if an entry waiting for an ack gets **no** ack within 30 s after `online`, resend it once with the same id (receivers dedupe on `<origin-id/>`), so a lost ack can't leave a delivered text stuck. Use the existing caps; don't add a new timer per message if one outbox timer can do it.

### Read first
`AGENTS.md`, `work/T-1153-honest-ticks-outbox.md`, `work/T-1197-outbox-flush-on-resume.md` (the Report: the event sequence), `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/online.ts`, `packages/client-core/src/store/lifecycle.ts:280-330`, the xmpp-core stream-management code and `packages/xmpp-core/src/stream-management.test.ts`.

### Allowed files
`packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/online.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/send.test.ts`, `packages/xmpp-core/src/core-effect/**`, `packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/stream-management.test.ts`, `packages/xmpp-core/src/connection-resilience.test.ts`, `work/T-1216-delivered-but-stuck-sending.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm --filter @zilar/xmpp-core exec vitest run src/stream-management.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines (tests exempt).
- **The lead's check on the emulator:** repeat steps 1 to 4; the bubble ends ✓ within 30 s of the network coming back.

---

## Report (written by the worker when done)

### Analysis (corrected in fix round 1 — the first version below was wrong)

My first analysis claimed the resume's `ackQueue` had "no queued item left
to emit `ack` for (the queue was reset on `disconnect`)". The lead
contradicted this with the library source, and the lead is right:
`@xmpp/stream-management@0.14.0` `index.js:56-62` — the `disconnect`
handler clears timers and flags only, never `sm.outbound_q` — and
`resumed()` (`index.js:70-80`) calls `ackQueue(h)`, which emits `ack` for
every covered stanza (`index.js:83-90`). So a **true resume settles the
bubble** through the existing `ack` → `acked` → `outboxAcked` path
(`stream-management.ts:116-118`, `core-effect.ts:220-223`,
`send/text.ts:143-148`, `send/outbox.ts:118-127`). Candidate A as I told
it was wrong.

What really happened to "Offline two":

1. Send at ~05:42:40, airplane mode on since 05:42:20: the socket was not
   fully dead yet. `sendMessage` succeeded
   (`core-effect/operations.ts:179-183`, `requireOnlineEffect` still saw
   `online`), so the entry was queued **with** a `stanzaId`
   (`send/text.ts:100-114`). The server archived the stanza (03:42:46Z,
   unread 3). The stanza also sat in the library's `outbound_q`
   (the middleware queues every outgoing message/presence/iq,
   `index.js:177-194`).
2. The ack never came back (socket died mid-exchange). No `fail` fired
   either: the library only emits `fail` from `failQueue()`, on `<failed/>`
   or `offline` (`index.js:99-105,117-123`) — neither of which a plain
   socket drop produces.
3. The airplane-mode gap (40 s+) outlasted the watchdog: the first step is
   5 s (`WATCHDOG_SCHEDULE_MS`, `core-effect/config.ts:31`), 15 s on mobile
   (`reconnectWatchdogFirstMs`, `types-ack.ts:33-41`). `restartStuckClient`
   (`core-effect/lifecycle.ts:90-106`) dropped the old client
   (`runtime.xmpp = undefined; stale.stop()`) **with its SM queue**, and
   every late event of the old client is ignored (`current !== xmpp`
   guards, `core-effect.ts:129,149,159`). The fresh client bound a **new
   session** — a rebound, not a resume.
4. The stanza still in the old `outbound_q` never got `ack` **or** `fail`,
   so no `acked`/`unacked` reached the store. The entry sat at `sending`
   (still clock at 05:44:30, 90 s online). AppState stayed `active`, so no
   mobile `reconnect()` ran; xmpp.js's own reconnect drove everything
   (candidate C's shape, confirmed by absence: no NetInfo hook, focus hook
   at `apps/mobile/src/store/effects/lifecycle.ts:120-123` never fired).
   With my round-1 rule (flush never resends a stanza that went out
   without an `unacked`), this entry would sit until the 10-minute
   wait-cap timer and then show "Not sent" — the lead's contradiction, and
   it is correct.
5. In the release build (without my rule) the bubble turned ✓ at 05:52 via
   a later `online` flush resending under the same id — archiving the
   **second row** (03:46:58Z, unread 3 → 4). Same `<origin-id/>`, but the
   archive counts rows. That resend is a server duplicate **by design**,
   which is why the server-side dedupe is now a separate lead task.

On the echo: dropped as a settle-path claim. The sender gets no echo of
its own DM on the same resource (carbons go to *other* resources), and I
found no line that triggers a history reload after a fresh session
(`connectXmpp` loads previews, not message history; the resume path only
rejoins groups). The echo tests I added exercise the pre-existing echo
reconcile (`incoming.ts:48-54`), not a T-1216 fix path.

### What I built (fix round 1, on top of the round-1 rule which is kept)

- `packages/xmpp-core/src/core-effect/lifecycle.ts` (+31/-3, 397 lines):
  `restartStuckClient` calls `reportStaleQueue(stale)` before
  `stale.stop()`. It reads the stale client's `outbound_q` the same way
  the core already reaches `sm` (`core-effect.ts:156-157`, cast through
  `streamManagement`), and emits the core's existing `unacked` event —
  the event `fail` maps to today (`core-effect.ts:220-223`, via
  `installStreamManagementAck`, `stream-management.ts:106-118`) — for
  every queued outgoing `<message/>` with an `id`. Then the client-core
  path from round 1 (`unacked` → `awaitingResend` → one resend with the
  same id → `acked` settles) covers the replaced-client case.
- Kept from round 1: `flushOutbox` never resends a stanza that went out
  on the live stream without an `unacked` (right for a true resume, whose
  `h` covers the queue and whose `ack`s settle the bubbles).
- No 30 s timer (spec item 3 was already replaced per the lead's earlier
  correction); the existing 10-minute wait cap still bounds a bubble
  whose ack and session are both truly gone.

### Tests (the message pipeline)

- xmpp-core, `connection-resilience.test.ts` (+1, watchdog block): "a
  replaced client reports its queued stanzas as unacked" — online, wedged,
  enqueue a `<message id='m-offline-two'/>` (+ a presence, ignored) into
  the fake's `outbound_q`, watchdog fires → client replaced and `unacked`
  fired once with `m-offline-two`. Fails before the fix (stashed
  `lifecycle.ts`: 1 failed, 30 passed), passes after (31 passed).
  The fake's `streamManagement` gained an `outbound_q` array + `enqueue`
  helper, mirroring the library shape.
- client-core, `send.test.ts`: the rebound case (send OK → `unacked` →
  flush resends once under the same id → `sent` on ack) already exists as
  "a resend after going offline reuses the first send stanza id" and
  "requeues a bubble stream management lost, for the next online" — cited,
  not duplicated. This round only trimmed T-1216 echo claims from two
  test comments; no behaviour test changed (25 passed).
- Full T-1216 sequence now covered end to end across the two suites:
  watchdog replace → `unacked(id)` → flush resends once with `{id}` →
  `acked(id)` → `sent`.

### Commands (real results)

- `pnpm install` — done (11.1s, earlier in the task).
- `pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot` — 25 passed.
- `pnpm --filter @zilar/xmpp-core exec vitest run src/stream-management.test.ts --reporter=dot` — (in Fix round 1 section below).
- `pnpm gate` — (in Fix round 1 section below).

### Follow-up (server-side dedupe; NOT changed in this task)

Now a separate lead task per the fix-round brief (the resend after a
replaced client is a server duplicate by design when the old session had
delivered the stanza; the server must count it once). My earlier notes
stand: `unreadForChats` (`apps/server/src/chats/unread.ts:140-156,281-304`)
counts every archive row with no `origin_id` dedupe; push `seen` is
per-node memory (`archive-scan.ts:86`, `delivery.ts:256-263`). Server
files are outside this task's Allowed files.

### Files changed

`packages/client-core/src/store/send/outbox.ts`,
`packages/client-core/src/store/send/text.ts`,
`packages/client-core/src/store/send.test.ts`,
`packages/xmpp-core/src/core-effect/lifecycle.ts`,
`packages/xmpp-core/src/connection-resilience.test.ts`. Max lines among
touched sources: 397 (`core-effect/lifecycle.ts`). Tests exempt.

### Blocked / needs a decision

- Nothing blocking. Spec item 3 (30 s blind resend) stays replaced per
  the lead's correction (it makes duplicates more likely): resend happens
  only for a stanza the send never attempted or stream management
  explicitly lost (`unacked`, now including the watchdog-replaced queue).
- The emulator check (steps 1–4, bubble ends ✓ within 30 s of reconnect)
  is not run by me — needs the lead's device pass.

### Fix round 1

- `pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot` — 25 passed.
- `pnpm --filter @zilar/xmpp-core exec vitest run src/stream-management.test.ts --reporter=dot` — 12 passed.
- `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck, effect,
  tests @zilar/client-core, tests @zilar/xmpp-core all PASS; scope: every
  changed file is inside the Allowed files; 6 changed files against main.

### Fix round 2 (pre-review findings)

Fixed finding 1 (must-fix) and finding 2 (should-fix). Nit 4 came along
because it sits in `online.ts`, which this round edits; nit 3 is left (its
line is unchanged).

- **Finding 1 (must-fix) — the same-client rebound resends again.**
  - `packages/xmpp-core/src/core-effect.ts`: a fresh bind while a session was
    already live (`onOnline(..., resumed: false)` with `hasBeenOnline`) now
    emits a new `rebound` event **before** `setStatus('online')`, so the
    store's online flush sees the marks. A resume (`resumed: true`) does not
    emit it. The `rebound` event and its `on` overload are declared by module
    augmentation, as `types-ack.ts` does for `acked`/`unacked`.
  - `packages/client-core/src/store/send/outbox.ts`: `outboxRebound` marks
    every in-flight text (`stanzaId` set, bubble still `sending`) with
    `awaitingResend` — the flush gate's allow.
  - `packages/client-core/src/store/online.ts`: `markReboundOutbox` and
    `wakeAndResend`. `lifecycle.ts` subscribes to `rebound`, and `reconnect()`
    wakes through `wakeAndResend`, which marks on a `rebound` wake outcome and
    leaves a `resumed` one alone (so the deleted test's `wake()` path works
    even with a fake core that emits no events).
  - Restored the deleted T-1197 test "a text sent while reconnecting goes out
    once after the client comes back online" in `send.test.ts` (re-adds the
    `reconnect`/`LifecycleCtx` import). It fails without `wakeAndResend` (the
    gate skips the entry) and passes with it.
  - New `connection-resilience.test.ts` test: a fresh bind after a live
    session reports `rebound`; a resume does not.
- **Finding 2 (should-fix) — an echo-settled bubble is not reverted.**
  `outboxUnacked` now looks the bubble up and skips one that is no longer
  `sending` (mirroring `resendOutboxEntry`), so the echo's `sent` is not
  flipped back to `sending` and the stanza is not resent. New `send.test.ts`
  test "a lost stanza for an echo-settled bubble neither reverts nor resends".
- **Nit 4** — the `online.ts` doc comment no longer says a `stanzaId` entry
  always goes out again; only with `awaitingResend`.

**Tests.** `pnpm --filter @zilar/client-core test --maxWorkers=2
--reporter=dot src/store/send.test.ts` — 27 passed (was 25: +restored rebound
test, +echo-unacked test). `pnpm --filter @zilar/xmpp-core test
--maxWorkers=2 --reporter=dot src/connection-resilience.test.ts
src/stream-management.test.ts` — 44 passed (was 43: +rebound event test).

**Gate.** `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck,
effect, tests @zilar/client-core, tests @zilar/xmpp-core all PASS; scope:
every changed file is inside the Allowed files; 9 changed files against main.

**Files changed this round.** `packages/xmpp-core/src/core-effect.ts`,
`packages/xmpp-core/src/connection-resilience.test.ts`,
`packages/client-core/src/store/lifecycle.ts`,
`packages/client-core/src/store/online.ts`,
`packages/client-core/src/store/send/outbox.ts`,
`packages/client-core/src/store/send.test.ts`. Max lines among touched
sources: 400 (`lifecycle.ts`).

### Disagreements

None. Nit 3 (`restartStuckClient`'s unguarded synchronous `unacked` emit) is
left as reported: its line is not one this round changes.

## Review (written by Claude)

**Lead, 2026-10-12: approved after the lead's fix round 1 and 1 auto round. The pre-review is clean, with 3 nits and 1 follow-up (done as T-1217).**
- **The cause** (corrected by the lead from the library source): the watchdog's `restartStuckClient` drops the old client with its SM `outbound_q`, so a queued stanza never gets `ack` or `fail`. A text sent mid-reconnect isn't SM-tracked at all.
- **The fix:**
  - `reportStaleQueue` emits `unacked` for each queued message before the old client is dropped;
  - the core emits `rebound` on every fresh bind after a live session (`core-effect.ts:143-149`, before `online`), and the store marks every waiting entry `awaitingResend`;
  - the flush resends only marked or never-sent entries, once, with the same id. A resume never resends;
  - `unacked` never reverts an ack- or echo-settled bubble.
- **Lead checks after the rebase onto main:** the full client-core suite 106 of 106 and xmpp-core 136 of 136; `tsc` gives 0 errors for xmpp-core, client-core, web and mobile.
- **Still to do:** the emulator re-check (airplane mode for more than 15 s mid-send; the bubble ends ✓ after the reconnect, and the server's unread counts it once).
