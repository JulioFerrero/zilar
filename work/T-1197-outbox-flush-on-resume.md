---
id: T-1197
title: "Outbox fix (found by the lead on the emulator): a text sent in airplane mode on mobile never goes out after the network returns and stays 'sending' for good; flush the outbox on every path that brings the client online, and fail a stuck entry after its cap even when no flush runs"
status: merged
milestone: M5
branch: task/T-1197-outbox-flush-on-resume
model: auto
effort: default
depends_on: [T-1153, T-1193]
estimate: 0.3 day
---

# T-1197: Offline texts go out when the network comes back

## Spec (written by Claude, do not edit)

### Why
T-1153 added the text outbox. The lead's check of release APK `c6591e1f` against production (emulator, signed in as Claude Test, DM with Julio):
1. Open the DM and turn on airplane mode. The header shows "Connecting…".
2. Send "Offline test". The bubble shows the clock.
3. Turn airplane mode off. The header goes back to "online" within 20 s.
4. **After more than 2 minutes online, the bubble still shows the clock, and the text never reached the other side.** The lead checked the peer's chat row: its last message is still the old one.
5. A text sent while online right after ("Online test") got its sent tick and arrived.

The release build prints no logs, so the cause isn't proven. There are two candidates, both from the code:
- **A. The resume path never flushes the outbox.** `reconnect()` in `packages/client-core/src/store/lifecycle.ts:176-195` wakes the core (`:180`), then sets `online` and calls `flushPending` (`:184,190`) and `joinGroups`, but **not** `flushOutbox`. Only the core's `status` listener calls it (`lifecycle.ts:294-299`). If the mobile path back from airplane mode goes through `reconnect()` (a NetInfo or AppState hook in `apps/mobile/src/store/effects/lifecycle.ts`: find it and cite it), or the core resumes without emitting a fresh `online`, nothing resends.
- **B. A send during `reconnecting` resolves.** If `sendMessage` resolves while the socket is down (xmpp.js queues the stanza), `sendText` stores the entry **with** a `stanzaId` (`packages/client-core/src/store/send/text.ts:95-115`, the `outboxFailed` call at `:102`). If the stream then can't resume and a fresh session starts, the stream-management queue is gone, and neither an ack nor an unack ever comes.
- **Also:** the 10-minute and 3-attempt caps are only checked inside `flushOutbox` (`packages/client-core/src/store/send/outbox.ts:198-221`). With no flush, a bubble stays `sending` forever.

### What to build
1. **Find which candidate is real, or both,** by reading the code paths. In the Report, write the event sequence the core and the client actually go through when the network drops and comes back on mobile, with the lines.
2. **Every path that ends `online` flushes the outbox:** the status listener, the `reconnect()` resume path, and the new-session (`rebound`) path. Put the call in one helper, so no path is missed. `lifecycle.ts` is **394 lines**: put the helper, and anything else that grows it, in a new `packages/client-core/src/store/online.ts`, so `lifecycle.ts` stays at most 400.
3. **If B is real:** when the core starts a **new** session (not a resume), resend the entries that still wait for an ack (`stanzaId` set, no ack), with the same id, so the receiver dedupes on `<origin-id/>`. Find the event the core emits for a new session (T-1151 `rebound`) and cite it.
4. **A resent reply keeps its quote** (T-1194 pre-review, follow-up 1). The entry's `sendOptions()` (`packages/client-core/src/store/send/outbox.ts:80-95`) rebuilds `{ replyTo: { id } }` without the quote `text`, so a resent reply loses its XEP-0461 fallback. Store the reply's quote text in the entry, from where `text.ts` calls `outboxFailed`, and pass it through like the first send does.
5. **The caps also apply without a flush:** a timer, on the store's runtime fork, that marks an entry `failed` once `OUTBOX_MAX_WAIT_MS` has passed, so the bubble shows "Not sent" and T-1196's Retry can take over.
6. **Tests** (the message pipeline), 2, in `packages/client-core/src/store/send.test.ts` (or the nearest lifecycle test; cite which):
   - (a) a text sent while `reconnecting` goes out once after the client comes back online through the path you found in step 1;
   - (b) an entry nobody flushes becomes `failed` after `OUTBOX_MAX_WAIT_MS`, using the test clock;
   - (c) from T-1193's pre-review (follow-up F1): in `packages/client-core/src/store/lifecycle.test.ts`, the core emitting `authFailed` schedules the connect retry. Set `flags.connectRetry: true` as the tests at `lifecycle.test.ts:206,216` do; T-1193's draft likely failed because it was off. That's 3 tests in all.

### Read first
`AGENTS.md`, `work/T-1153-honest-ticks-outbox.md` (the Report), `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/text.ts`, `apps/mobile/src/store/effects/lifecycle.ts` and `packages/xmpp-core/src/core-effect/lifecycle.ts` (the resume and rebound handling).

### Allowed files
`packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/online.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send.test.ts`, `packages/client-core/src/store/lifecycle.test.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `work/T-1197-outbox-flush-on-resume.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:** repeat steps 1 to 3 above; the text arrives once and gets its tick.

---

## Report (written by the worker when done)

### Step 1: which candidate is real — both

Event sequence on mobile (airplane mode on, send, airplane mode off):

1. Airplane mode on: the socket dies. The core's library driver reports
   `disconnect` and the status listener in
   `packages/client-core/src/store/lifecycle.ts:294-300` writes `offline`
   (header shows "Connecting…" via the reconnecting status).
2. Send "Offline test": `sendText`
   (`packages/client-core/src/store/send/text.ts:9-135`) builds the optimistic
   bubble (`sending`) and forks the socket write. If it rejects (`NotOnline`,
   because `requireOnlineEffect` in
   `packages/xmpp-core/src/core-effect/operations.ts:128-136` already sees the
   core offline), the entry is queued with `stanzaId` unset
   (`text.ts:117-133`). If the write resolves while the core still reports
   `online`/`reconnecting` (xmpp.js queues the stanza on a half-dead socket),
   the entry is queued **with** a `stanzaId` (`text.ts:92-113`) — candidate B.
3. Airplane mode off: the user returns to the app. There is no NetInfo hook;
   the resume hook is AppState focus: `ctx.ports.visibility.onFocus(...)` in
   `apps/mobile/src/store/effects/lifecycle.ts:115-118` forks the core
   `reconnect()` (`packages/client-core/src/store/lifecycle.ts:152-196`).
4. `reconnect()` wakes the core (`wakeCore`, `:180`; `wake()` reconnects and
   reports `resumed` vs `rebound` per `packages/xmpp-core/src/types-suspend.ts:8`
   and `core-effect/suspend.ts:91-107`), then sets `online` itself and calls
   `flushPending` + `joinGroups` (`:182-190`) — but **never `flushOutbox`**.
   A stream-management resume is silent (the core's `resumed` handler in
   `packages/xmpp-core/src/core-effect.ts:158-162` calls `onOnline` without a
   fresh raw `online`), so the `status` listener (`lifecycle.ts:294-300`,
   the only `flushOutbox` caller) may never fire either — candidate A.
5. With a fresh session (`rebound`: `wake()` returns `'rebound'`,
   `core-effect/suspend.ts:97,106`, `client.ts:22`), the SM queue is gone, so
   an entry that waits for its ack gets neither `acked` nor `unacked`.
6. The caps only run inside `flushOutbox` (`outbox.ts:198-221` before this
   change), so with no flush the bubble stays `sending` forever. Matches the
   lead's observation exactly (offline text stuck, later online text fine).

Note: `rebound` is not a core event — it is the `WakeOutcome` return value of
`wake()` (cited above). `reconnect()` discarded it via `wakeCore`. The fix
does not need to branch on it: every path that ends `online` now flushes.

### What I built
- New `packages/client-core/src/store/online.ts` (17 lines): `flushOnline()`
  runs `flushPending` + `flushOutbox`. Every path that ends `online` calls it:
  the core `status` listener and the `reconnect()` resume path (which covers
  both `resumed` and `rebound`, since both end `online`). `lifecycle.ts`
  re-exports it (same pattern as `suspendStore`/`wakeCore` from `suspend.ts`);
  `lifecycle.ts` is 396 lines (was 394).
- `send/outbox.ts`: `outboxFailed` now takes the `SendCtx` (so a new entry
  can arm its wait cap on the store's runtime fork) plus `replyToText`; the
  entry stores it and `sendOptions()` rebuilds
  `{ replyTo: { id, text } }` like the first send, so a resent reply keeps its
  XEP-0461 fallback (`build-outgoing.ts:91-96,115-127`). New per-entry timer
  (`forkKeyed(outbox:<localId>, sleep(OUTBOX_MAX_WAIT_MS))`) marks the bubble
  `failed` even when no flush ever runs; `acked`/flush-fail cancel it.
- `send/text.ts`: the three `outboxFailed` calls pass `wireReply?.text`
  through (the wire id was already passed).

### Tests (3, as specced)
- `send.test.ts` (+3, in-file): (a) a text sent while reconnecting goes out
  once after the resume path ends `online` (via `flushOnline`), resending
  under the first send's stanza id, then `sent` on ack; reply-resend keeps
  `{ replyTo: { id, text } }`; (b) an entry nobody flushes becomes `failed`
  after `OUTBOX_MAX_WAIT_MS` with the fake clock. 21 passed.
- `lifecycle.test.ts` (+1): (c) the core emitting `authFailed` (with
  `flags.connectRetry: true`) schedules the connect retry
  (`connectRetryPending: true`). 10 passed.

### Commands (real results)
- `pnpm install` — done (2.8s).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` — 21 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` — 10 passed (one pre-existing stderr line: the boot-bookkeeping test logs the expected `createXmpp is not provided in this test` error).
- `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck, effect,
  tests @zilar/client-core all PASS; `scope: every changed file is inside the
  Allowed files`; 7 changed files against main.

### Files changed
`packages/client-core/src/store/online.ts` (new),
`packages/client-core/src/store/lifecycle.ts`,
`packages/client-core/src/store/send/outbox.ts`,
`packages/client-core/src/store/send/text.ts`,
`packages/client-core/src/store/send.test.ts`,
`packages/client-core/src/store/lifecycle.test.ts`.
`apps/mobile/src/store/effects/lifecycle.ts` needed no change (its
`onFocus → coreReconnect` path now flushes via the core). Max lines among
touched sources: 396 (`lifecycle.ts`).

### Blocked / needs a decision
- Nothing blocking. One judgment call for the lead: `outboxFailed`'s
  signature changed (now takes `SendCtx` first instead of the bare map); all
  callers are in `text.ts`, so the blast radius is nil, but flagging it.
- The emulator check (Spec steps 1–3: airplane-mode text arrives once with its
  tick) is not run by me — needs the lead's device pass.

### Round 2 (pre-review fix round)
- Finding 1 (should-fix, `send.test.ts:329`): test (a) called `flushOnline()`
  directly, so removing the `flushOnline` call from `reconnect()` or the
  `status` listener would not fail it. Rewired test (a) in
  `packages/client-core/src/store/send.test.ts` to drive the resume path:
  the send harness's core gains `wake: async () => 'rebound'` (the fresh
  session from step 1 that drops the SM queue), then the test runs the real
  `reconnect()` (imported from `./lifecycle`, flags
  `reconnectOnResume: true`, `started: true`, no `me` so group joins are
  skipped) and asserts the single resend under the first stanza id plus the
  `sent` tick after ack.
- Negative control: with the `flushOnline(ctx)` call in `reconnect()`
  (`lifecycle.ts:187`) temporarily removed, the rewired test fails
  (1 failed, 20 passed); with the call restored it passes (21 passed).
  `lifecycle.ts` was restored byte-identical afterwards (only `send.test.ts`
  and this task file differ from round 1).
- Finding 2 (nit, `send.test.ts` 645 lines vs the 400-line acceptance point):
  not touched per the task instructions — the file was already 588 lines on
  main, so the breach predates this task.
- Disagreements: none.
- Tests added: none new (rewired existing test (a)); single-test runs:
  `send.test.ts` 21 passed, `lifecycle.test.ts` 10 passed.
- `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck,
  effect, tests @zilar/client-core all PASS; `scope: every changed file is
  inside the Allowed files`; 7 changed files against main.

### Round 3 (pre-review fix round)
- Finding 1 (should-fix, `send.test.ts` 665 lines vs the 400-line
  acceptance point): not fixed — not fixable inside the Allowed files. The
  file was already 588 lines on main, over the limit before this task; the
  task adds ~77 lines (3 Spec-required tests). Even deleting all 3 tests
  would leave ~588 lines, still over 400, and splitting into a new test
  file would create a file outside the Allowed files (only `send.test.ts`
  and `lifecycle.test.ts` are listed; moving the tests to
  `lifecycle.test.ts` at 309 lines would push that file over 400 instead).
  Asking the lead to waive (test-only growth on a pre-existing breach).
  No source or test change; no new tests.
- Finding 2 (nit, `lifecycle.ts:187` vs `:193` double `flushPending`): not
  touched, per the task instructions (nits only on a line already changed;
  neither line changed this round). It is also not redundant:
  `canLoadHistory` (`history.ts:82-85`) requires `groupsJoined` for group
  chats, and the first flush (`:187`, inside `flushOnline`) runs before
  `groupsJoined = true` (`:192`), so a pending group open only loads on the
  second pass (`:193`). The same double-flush pattern (before/after
  `groupsJoined = true`) predates this task on main, in both `reconnect()`
  and the boot path (`:386-389`). Dropping `:193` would break group history
  open on resume.
- Disagreements:
  - Finding 1 as a fix-in-scope: splitting the test file requires a new
    file outside the Allowed files, so it is not fixable in scope — waiver
    requested instead.
  - Finding 2 (redundant second `flushPending`): the second pass is
    required for group chats (see above), so the call must stay.
- Tests added: none (no behaviour change). Single-test runs re-run this
  round: `send.test.ts` 21 passed, `lifecycle.test.ts` 10 passed (same
  pre-existing expected stderr line as round 1).
- `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck,
  effect, tests @zilar/client-core all PASS; `scope: every changed file is
  inside the Allowed files`; 7 changed files against main.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 2 auto rounds. The pre-review is clean, with 1 follow-up.**
- **Both candidates were real,** and the worker traced the mobile event sequence: AppState focus leads to `reconnect()`, which leads to `wakeCore`. A `rebound` session drops the stream-management queue, and the resume path never flushed.
- **The fix:**
  - the new `online.ts` `flushOnline` (`flushPending` plus `flushOutbox`) runs on every path that ends `online`;
  - entries still waiting for an ack are resent with the same id after a new session;
  - the caps fire without a flush, through an outbox timer;
  - a resent reply keeps its quote text (T-1194's follow-up 1).
- **T-1193's missing store test** (`authFailed` leads to the connect retry) is added.
- **Tests:** client-core send and lifecycle 31 of 31, run by the lead. `send.test.ts` is 665 lines, which is allowed for tests.
- **Not caused here:** 2 web tests in `apps/web/src/store/realStore.send.test.tsx` have failed since **T-1153** (the lead bisected it: they pass at `e0629bf65~1` and fail at `e0629bf65`). That's a new task.
- **Still to do:** the emulator check of spec steps 1 to 3 with the next APK.
