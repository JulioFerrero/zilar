---
id: T-0763
title: "X1: xmpp-core typed errors — new packages/xmpp-core/src/errors.ts with one Data.TaggedError per failure mode (NotOnline, NoIdentity, ConnectTimeout, Disconnected, JoinRejected, JoinTimeout, JoinSendFailed, IqFailed, HistoryFailed, HistoryTimeout, HistorySendFailed, UploadSlotTimeout, UploadSlotInvalid, UploadSlotFailed, PushToggleTimeout, PushToggleFailed); the 17 `new Error(...)` sites in client.ts use them with byte-identical messages; exported from index.ts"
status: merged
milestone: M5
branch: task/T-0763-xmpp-typed-errors
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0763 (X1): typed errors in xmpp-core

## Spec (written by Claude, do not edit)

### Why
This is the first step of the xmpp-core lane of `docs/audit/effect-100-plan.md` (§3.1, "Typed errors"; tasks X1-X7), accepted by Julio on 2026-10-09. The lead narrowed X1 to the typed errors alone, because they are the safest first step: the scope, the event PubSub and the timers come in later tasks. Every later step builds on these error classes.

### Verified facts (do not re-derive)
- **`packages/xmpp-core/package.json`** already depends on `effect` `^4.0.2` (line 16); its only export is `./src/index.ts`.
- **The 17 sites** in `packages/xmpp-core/src/client.ts` that create a plain `Error`:
  - line 479: `pending.reject(new Error(reason))`; read the context to find which failure `reason` is;
  - line 740: `the room rejected the join: ${condition}`;
  - line 781: `the request failed: ${condition}`;
  - line 817: `the history query failed: ${condition}`;
  - line 840: `the XMPP connection is not online`;
  - line 862: `timed out connecting to XMPP`;
  - line 885: `the XMPP client was disconnected`;
  - line 907: `timed out joining ${roomJid}`;
  - line 916: `could not send the join presence for ${roomJid}: ${errorMessage(error)}`;
  - line 1011: `the XMPP connection has no identity yet`;
  - line 1030: `timed out loading the history of ${chatJid}`;
  - line 1040: `could not send the history query for ${chatJid}: ${errorMessage(error)}`;
  - line 1061: `timed out requesting an upload slot`;
  - line 1067: `the upload service returned an invalid slot`;
  - line 1081: `could not request an upload slot: ${errorMessage(error)}`;
  - line 1104: `timed out toggling push notifications`;
  - line 1117: `could not toggle push notifications: ${errorMessage(error)}`.
- **How the tests check errors:** they assert the message (`rejects.toThrow('...')`, for example `connection-resilience.test.ts:204,242,268` and `core.test.ts:361`). Some tests build their own errors with `name = 'SASLError'` (`core.test.ts:269`); those are inputs, not core errors.
- **The rules:** `docs/EFFECT_GUIDE.md:61-72` (one tagged error per failure mode; no secrets in errors). `client.ts` already has `redact` (around line 200) for the token. Check the 4.0.2 `Data.TaggedError` API in `node_modules/effect/dist/Data.d.ts`.

### What to build
1. **`packages/xmpp-core/src/errors.ts`:** one `Data.TaggedError` class per failure mode. Each carries the fields its message needs (`roomJid`, `chatJid`, `condition`, `cause: string`) and a `message` that produces the **byte-identical** text of today's site. Name the classes as in the title; merge or split them when reading the code shows a better fit, and say why in the Report. Each must still be an `Error`: check that `instanceof Error` holds and that `.message` is right. Add a `XmppCoreError` union type.
2. **`client.ts`:** replace the 17 sites with the new classes. Change nothing else. Keep the Promise flow, the timers and the listeners exactly as they are.
3. **`index.ts`:** export the classes and the union.
4. **Tests:** add `packages/xmpp-core/src/errors.test.ts`, with one assertion per class (its message text, `_tag`, `instanceof Error`). Every existing test must pass unchanged: `core.test.ts`, `connection-resilience.test.ts`, `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts` and `stanza.test.ts`. The `integration-*.test.ts` files need ejabberd and are skipped unless it is configured; do not run them against any live server.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.1, `packages/xmpp-core/src/client.ts` (the whole file), `packages/xmpp-core/src/index.ts`.

### Allowed files
`packages/xmpp-core/src/errors.ts`, `packages/xmpp-core/src/errors.test.ts`, `packages/xmpp-core/src/client.ts`, `packages/xmpp-core/src/index.ts`, `work/T-0763-xmpp-typed-errors.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core test --reporter=dot
pnpm gate
```
Paste the before and after counts of the xmpp-core suite into the Report.

### Acceptance
- There is no `new Error(` left in `client.ts`.
- The messages are unchanged, and every existing test passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Files changed** (all in Allowed files): `packages/xmpp-core/src/errors.ts` (new), `packages/xmpp-core/src/errors.test.ts` (new), `packages/xmpp-core/src/client.ts`, `packages/xmpp-core/src/index.ts`, this task file.

**Deviation: 17 classes, not 16.** `rejectPendingIqs(reason: string)` was called with two texts: `'the XMPP connection failed'` (from `stopAfterFailure`, HEAD line 464 via 479) and `'the XMPP client was disconnected'` (from `disconnect`, HEAD line 887). No class in the list carries the first text, so I added `ConnectionFailed`. `rejectPendingIqs` now takes a factory `() => XmppCoreError`, so each pending request still gets its own error object, as before. Only the message texts are kept; the names are mine.

**Error classes and the HEAD line each replaces** (`new Error(` in HEAD `client.ts`):
- `NotOnline`: 840 (`requireOnline`)
- `NoIdentity`: 1011
- `ConnectTimeout`: 862
- `Disconnected`: 885 (`finishConnect` in `disconnect`) and 887 (via `rejectPendingIqs`, not a `new Error` site)
- `ConnectionFailed` (added): 479 (via `rejectPendingIqs`, from 464)
- `JoinRejected`: 740 (`condition`)
- `JoinTimeout`: 907 (`roomJid`)
- `JoinSendFailed`: 916 (`roomJid`, `cause`)
- `IqFailed`: 781 (`condition`)
- `HistoryFailed`: 817 (`condition`)
- `HistoryTimeout`: 1030 (`chatJid`)
- `HistorySendFailed`: 1040 (`chatJid`, `cause`)
- `UploadSlotTimeout`: 1061
- `UploadSlotInvalid`: 1067
- `UploadSlotFailed`: 1081 (`cause`)
- `PushToggleTimeout`: 1104
- `PushToggleFailed`: 1117 (`cause`)

That is 17 sites (479, 740, 781, 817, 840, 862, 885, 907, 916, 1011, 1030, 1040, 1061, 1067, 1081, 1104, 1117). `grep -c "new Error(" client.ts` is now 0. `XmppCoreError` is the union of all 17 classes. `index.ts` exports the classes and the union.

**How the classes build their message.** Each class passes its text to the `Data.TaggedError` base as a `message` argument, so `.message` is set during construction. I checked this in `node_modules/effect/dist/internal/core.js` (4.0.2): the base extends `Error` and passes `args.message` to it. I did not use a `message` getter, because a getter would read the fields before the base sets them.

**Behaviour change to know about.** A `Data.TaggedError` sets `.name` to its tag (for example `'NotOnline'`) instead of `'Error'`, and `.cause` is set when a `cause` field is passed. I grepped the web, mobile and server code for `.name` checks and string coercion of these errors and found none. The tests assert on messages only.

**Suite counts (`pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot`).**
- Before: Test Files 7 passed, 4 skipped (11); Tests 198 passed, 4 skipped (202).
- After: Test Files 8 passed, 4 skipped (12); Tests 215 passed, 4 skipped (219). The +17 tests are the 17 `it.each` cases in `errors.test.ts`. Every existing test passes unchanged.
- The 4 skipped files are the `integration-*.test.ts` files, which need ejabberd. I did not run them.

**Other checks.** `pnpm exec prettier --write` on the 4 TypeScript files. `tsc --noEmit` in `packages/xmpp-core` exits 0. I did not connect to any XMPP server.

**`pnpm gate` (run from the worktree root, exit 0):**
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  tests @zilar/xmpp-core  (2.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Open question.** Is the extra `ConnectionFailed` class acceptable, or should the 17th text move into `Disconnected`? Moving it would change the message at HEAD line 479, which I did not want to do.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The error classes:** 17 tagged errors, including the added `ConnectionFailed`, which is right because `rejectPendingIqs` takes two texts. No `new Error(` is left in `client.ts`, and the messages are byte-identical.
- **`.name` changes**, for example to `NotOnline`. The lead checked with `git grep` that no consumer in web, mobile or the server agents reads these names or texts.
- **Results:** the xmpp-core tests go from 198 to 215 (the new errors tests); the gate passed.
