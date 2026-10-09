---
id: T-0763
title: "X1: xmpp-core typed errors — new packages/xmpp-core/src/errors.ts with one Data.TaggedError per failure mode (NotOnline, NoIdentity, ConnectTimeout, Disconnected, JoinRejected, JoinTimeout, JoinSendFailed, IqFailed, HistoryFailed, HistoryTimeout, HistorySendFailed, UploadSlotTimeout, UploadSlotInvalid, UploadSlotFailed, PushToggleTimeout, PushToggleFailed); the 17 `new Error(...)` sites in client.ts use them with byte-identical messages; exported from index.ts"
status: todo
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

## Review (written by Claude)
