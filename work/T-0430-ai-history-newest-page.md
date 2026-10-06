---
id: T-0430
title: "AI loses the conversation: prove whether the first MAM page is the oldest one, and if so ask for the newest page (empty RSM <before/>)"
status: todo
milestone: M5
branch: task/T-0430-ai-history-newest-page
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0430: the AI must read the latest messages, not the first ones

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-06: "when i talk to the ai in the chat, goes crazy and respond in one message like it was responding to one to one of the messages before, doesnt understand is a conversation".

Lead hypothesis, not yet proven:
- The AI turn loads its history with `loadHistory(peer, kind, { max: 30 })` and no cursor.
- The MAM query then carries RSM `<max>30</max>` and no `<before/>`.
- XEP-0059 §2.5 says that to get the **last** page you send an empty `<before/>`. Without it, the server pages forward from the **start**: the oldest 30 messages.
- So in a chat with more than 30 messages, the model would get the oldest 30 plus the new message, and answer old messages.

**Prove this first, then fix it.** If the proof shows the hypothesis is wrong, do not change `mam.ts`. Report what the archive actually returned, and stop with status `review`.

### Verified facts (do not re-derive)
- **`packages/xmpp-core/src/mam.ts`:**
  - `MamQuery` (lines 7-15) has `before?: string`;
  - `buildMamQuery` (lines 17-45) pushes `<before>` only when `query.before !== undefined` (lines 26-29);
  - `orderOldestFirst` (lines ~77-84) only reverses a page whose order is newest-first; it does not change which page comes back.
- **`packages/xmpp-core/src/client.ts:1004-1044`:** `loadHistory(chatJid, kind, opts)` passes `opts.before` through to `buildMamQuery`.
- **Callers with no cursor, all meant to get the latest page:**
  - AI group turn: `apps/server/src/agents/gateway.ts:1504-1506`;
  - AI DM turn: `apps/server/src/agents/gateway.ts:1753-1755`, both with `max: DM_HISTORY_MESSAGE_LIMIT` (30);
  - web first page: `apps/web/src/store/realStore.ts:2969`;
  - mobile first page: `apps/mobile/src/store/real-store.ts:2750`.
- **Context build:** `apps/server/src/agents/context.ts:213-238` (`buildDmMessages`) keeps the last 30 turns of what it is given, maps the owner to `user` and the AI to `assistant`, then appends the trigger unless its id equals the last turn's id. `gateway.ts:1771-1791` merges the batch's live owner messages whose ids MAM did not return.
- **Unit tests:** `packages/xmpp-core/src/mam.test.ts` has a test at lines 65-79 that checks the `before` cursor.
- **Integration test** against the dev stack: `packages/xmpp-core/src/integration.test.ts`, which runs with `pnpm infra:up` and then `ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test`. Its history checks are at lines 184-212. The dev stack is up on this machine now.

### What to build
1. **Proof (commit 1):** in `integration.test.ts`, add a case:
   - alice sends bob 40 DM messages "m01" … "m40", 20 ms apart;
   - bob calls `loadHistory(aliceJid, 'chat', { max: 10 })`;
   - expect the bodies to be "m31" … "m40" (the newest 10, oldest first).
   Run it against the dev stack, and paste the result into the Report (which bodies came back).
2. **Fix (commit 2, only if step 1 fails with m01 … m10):**
   - in `buildMamQuery`, when `query.before` is `undefined`, push an empty `xml('before', {})`, which asks for the last page;
   - keep the current behaviour when a cursor is given;
   - in `mam.test.ts`, add a test: with no cursor, the RSM set has a `<before>` element with empty text;
   - re-run the integration case until it passes.

   The web, mobile and AI callers then all get the newest page with no change of their own. Loading older pages still goes through `before: page.first`.
3. **Trigger dedup check (commit 3):** in the same integration run, log whether the id that MAM returns for a DM message equals the id bob's live `message` event carried. In `context.test.ts`, add a test: a history of alternating owner/AI messages followed by the trigger yields roles that alternate `user` and `assistant`, ending with exactly one `user` turn for the trigger, with no duplicate. If the ids differ in the integration run (so the trigger would appear twice), report it under Problems; do not fix it here.
4. **Also run** the full `@zilar/xmpp-core` tests. The fix touches every first-page load, so check that no web or mobile store test asserted the old query shape; `pnpm gate` runs them.

### Read first
`AGENTS.md`, `packages/xmpp-core/src/mam.ts`, `packages/xmpp-core/src/mam.test.ts`, `packages/xmpp-core/src/integration.test.ts`, `packages/xmpp-core/src/client.ts:1004-1044`, `apps/server/src/agents/context.ts:118-239`, `apps/server/src/agents/gateway.ts:1740-1795`, and XEP-0059 §2.5 ("Requesting the Last Page").

### Allowed files
`packages/xmpp-core/src/mam.ts`, `packages/xmpp-core/src/mam.test.ts`, `packages/xmpp-core/src/integration.test.ts`, `apps/server/src/agents/context.test.ts`, `work/T-0430-ai-history-newest-page.md`.

If another test breaks because it asserts the old query shape, stop and report BLOCKED with the file name.

### Checks
```bash
ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test --reporter=dot integration
pnpm --filter @zilar/xmpp-core test --reporter=dot mam
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot context
pnpm gate
```

### Acceptance
- The Report shows the integration result before and after the fix (or proof that no fix was needed).
- With no cursor, `loadHistory` returns the newest page.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
