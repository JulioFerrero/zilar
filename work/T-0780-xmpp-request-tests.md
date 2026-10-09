---
id: T-0780
title: "xmpp-core request tests: new src/requests.test.ts covering requestUploadSlot (success, invalid slot, timeout, send failure), and the typed send-failure and timeout paths of joinRoom, loadHistory and setPushEnabled (error _tag, message, instanceof the errors.ts class), plus a late reply after a timeout being ignored; tests only"
status: merged
milestone: M5
branch: task/T-0780-xmpp-request-tests
model: auto
effort: default
depends_on: [T-0777]
estimate: 0.3 day
---

# T-0780: tests for the xmpp-core request paths

## Spec (written by Claude, do not edit)

### Why
The lead's T-0777 review (X2b) found that `requestUploadSlot` and the typed send-failure and timeout paths of the four request operations have no unit tests. A throwaway script checked them, but nothing in the repo does. They are messaging-critical, so they get pinned before the next xmpp-core step.

### Verified facts (do not re-derive)
- **After T-0777,** `packages/xmpp-core/src/client.ts` runs `joinRoom`, `loadHistory`, `requestUploadSlot` and `setPushEnabled` as Effects on Deferreds, with timeouts that fail with the `errors.ts` classes:
  - joins: `JoinTimeout`, `JoinSendFailed`, `JoinRejected`;
  - history: `HistoryTimeout`, `HistorySendFailed`, `HistoryFailed`;
  - upload: `UploadSlotTimeout`, `UploadSlotInvalid`, `UploadSlotFailed`;
  - push: `PushToggleTimeout`, `PushToggleFailed`, `IqFailed`.

  The Promise methods reject with those instances.
- **The existing tests** drive a fake client; see how `core.test.ts` builds its fake, how it emits stanzas and how it sets short timeouts through `XmppCoreOptions` (for example the `setPushEnabled` tests around `core.test.ts:1212-1272`). Reuse that fake: import or copy its small helper into the new file, and do not edit `core.test.ts`.

### What to build
**`packages/xmpp-core/src/requests.test.ts`**, covering:
1. **`requestUploadSlot`:**
   - success (a valid slot reply gives the `UploadSlot`);
   - an invalid slot reply gives `UploadSlotInvalid`;
   - no reply gives `UploadSlotTimeout`;
   - a send that rejects gives `UploadSlotFailed` with the cause text in its message.
2. **For `joinRoom`, `loadHistory` and `setPushEnabled`:** a send failure gives the matching `*SendFailed` (for push it is `PushToggleFailed`), and no reply gives the matching timeout.
3. **For every case:** the rejection is `instanceof` the `errors.ts` class, `_tag` is correct, and the message is byte-identical to the class's message.
4. **A reply that arrives after the timeout** is ignored (no throw, no second settle), and the pending entry is gone (a later request with the same id or room works).
5. **A disconnect while requests are pending** fails them with the typed error used by `rejectPendingIqs`.

### Read first
`AGENTS.md`, `packages/xmpp-core/src/client.ts`, `packages/xmpp-core/src/errors.ts`, `packages/xmpp-core/src/core.test.ts` (the fake client and the push tests), `work/T-0777-xmpp-requests-deferred.md` (Report).

### Allowed files
`packages/xmpp-core/src/requests.test.ts`, `work/T-0780-xmpp-request-tests.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core test --reporter=dot src/requests
pnpm gate
```

### Acceptance
- The new tests cover the five points and pass three runs in a row.
- No other file changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed
- New file `packages/xmpp-core/src/requests.test.ts` with 15 Vitest tests. No other file changed; `core.test.ts` is untouched.
- The fake client is copied from `core.test.ts` (same shape, trimmed to the members the request paths use). Ids come from `createCore`'s `generateId` dependency (`client.ts:126`), as `req-1`, `req-2`, ... so a test can aim a late reply at one request.
- Keepalive is off (`keepaliveMs: 0`). Timeout tests connect with real timers, then call `vi.useFakeTimers()` and advance by the full timeout. No real waiting.
- Prettier was run on the new file.

### Tests (15)
- `requestUploadSlot`: valid reply resolves with the slot (`upload.<domain>` target checked); reply without a slot gives `UploadSlotInvalid`; no reply gives `UploadSlotTimeout` after 15 s; rejecting send gives `UploadSlotFailed` with `socket closed` in the message.
- `joinRoom`: rejecting send gives `JoinSendFailed`; no reply gives `JoinTimeout` after 15 s.
- `loadHistory`: rejecting send gives `HistorySendFailed`; no reply gives `HistoryTimeout` after 30 s.
- `setPushEnabled`: rejecting send gives `PushToggleFailed`; no reply gives `PushToggleTimeout` after 15 s.
- Late reply after timeout, one test each for upload, join, history and push: the late reply does not throw, a later request is not settled by it, and the later request resolves on its own reply (for join, its own presence; the same room is used).
- Disconnect with an upload slot and a push toggle pending: both reject with `Disconnected`.
- Every failure checks `instanceof` the `errors.ts` class, `_tag`, and the exact message as a literal string (the same text as the class).

### Commands and results
- `pnpm --filter @zilar/xmpp-core test --reporter=dot src/requests`, run 3 times: 15 passed each time (`Tests 15 passed (15)`, three runs).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot` (whole package, once): `Test Files 10 passed | 4 skipped (14)`, `Tests 237 passed | 4 skipped (241)`. That is the 222 from T-0777 plus these 15.
- `pnpm gate` from the worktree root: `install (frozen)` PASS, `format` PASS, `lint` PASS, `typecheck` PASS, `effect` SKIP (no source files changed), `tests @zilar/xmpp-core` PASS, `scope: every changed file is inside the Allowed files`, `GATE PASS`. It reported 2 changed files against main (the test file and this task file).

### Deviations from the spec
1. **No `XmppCoreOptions` timeout setting.** The spec says the timeouts are set through `XmppCoreOptions`. No such option exists. The timeouts are constants: `client.ts:99-102` (join 15 s, history 30 s, upload 15 s, push 15 s). The push tests in `core.test.ts` (around 1212-1272) do not test timeouts at all. The tests therefore use fake timers.
2. **Disconnect only fails IQs.** `disconnect()` calls `rejectPendingIqs` (`client.ts:916-917`), so pending upload and push requests fail with `Disconnected`, as the spec says. `disconnect()` does not touch `pendingJoins` or `pendingQueries`, so a pending join or history query is not failed; it waits for its own timeout. I read this in the code and did not test it, since the spec does not describe it. This looks like a question for the lead (should a disconnect fail joins and history too?).
3. `ConnectionFailed` (`client.ts:483`, the failed-connection path) is not tested; the spec asked for disconnect only.

### Problems and open questions
- None blocking. Nothing was changed outside the Allowed files. No secrets, no real XMPP connection (fake client only).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **The tests:** 15 request-path tests (upload slot, the typed send-failure and timeout paths, late replies, disconnect), green 3 of 3 runs; the suite has 237.
- **The timeouts are constants, not options,** so the tests use fake timers; that is fine.
- **Disconnect does not fail pending joins or history queries:** they wait for their own timeout. This predates X2b (`rejectPendingIqs` covers IQs only) and is noted as a possible improvement for the X3+ steps.
