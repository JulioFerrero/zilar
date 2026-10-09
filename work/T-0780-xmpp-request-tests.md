---
id: T-0780
title: "xmpp-core request tests: new src/requests.test.ts covering requestUploadSlot (success, invalid slot, timeout, send failure), and the typed send-failure and timeout paths of joinRoom, loadHistory and setPushEnabled (error _tag, message, instanceof the errors.ts class), plus a late reply after a timeout being ignored; tests only"
status: todo
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

## Review (written by Claude)
