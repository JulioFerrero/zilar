---
id: T-0430
title: "AI loses the conversation: prove whether the first MAM page is the oldest one, and if so ask for the newest page (empty RSM <before/>)"
status: merged
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

### What I did

The hypothesis is **CONFIRMED**. With no cursor, MAM returned the oldest page, so the AI turn was reading the start of the archive instead of the newest messages. I proved it in the integration test, then applied the fix from the spec.

- Commit 1 (`4a6ea5a6`): added the proof block to `integration.test.ts` (alice sends bob 40 DMs `m01`…`m40`, 20 ms apart; bob loads `loadHistory(aliceJid, 'chat', { max: 10 })`). It failed against the old code, showing the oldest page.
- Commit 2 (`d2e7ca03`): `buildMamQuery` now always pushes a `<before>` element; with no cursor its text is empty (XEP-0059 §2.5 "Requesting the Last Page"), and a cursor still pages backwards. Added the unit test in `mam.test.ts` that asserts an empty `<before>` without a cursor.
- Commit 3 (`ddb83f9d`): added the trigger-dedup test in `context.test.ts` (alternating owner/AI history plus trigger → roles alternate `user`/`assistant` and end with exactly one `user` trigger turn) and the integration log comparing the MAM message id with the live `message` event id.

### Files changed

All inside Allowed files:
- `packages/xmpp-core/src/mam.ts`
- `packages/xmpp-core/src/mam.test.ts`
- `packages/xmpp-core/src/integration.test.ts`
- `apps/server/src/agents/context.test.ts`
- `work/T-0430-ai-history-newest-page.md`

### Commands and real results

Proof, before the fix (commit 1, old code):

```
ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test --reporter=dot integration
→ FAIL: expected ["m31"…"m40"], received ["private hello","m01","m02","m03","m04","m05","m06","m07","m08","m09"]
→ Test Files 1 failed | 3 passed (4)
```

So the first page really is the oldest one, as the task suspected.

After the fix (commit 2 + 3):

```
ZILAR_XMPP_INTEGRATION=1 pnpm --filter @zilar/xmpp-core test --reporter=dot integration
T-0430 proof: loadHistory(chat, max=10) returned ["m31","m32","m33","m34","m35","m36","m37","m38","m39","m40"]
T-0430 proof: last archived body=m40 id=1791296190190691; live id=1791296190190691
→ Test Files 4 passed (4) | Tests 4 passed (4)
```

Trigger-dedup check: the id MAM returned for `m40` is `1791296190190691`, byte-for-byte the same id bob's live `message` event carried, so the trigger is not duplicated in the context.

Single-file units during the work:

```
pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot mam       → 11 passed (1 file)
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot context      → 22 passed (1 file)
```

Final gate, from the repo root:

```
pnpm gate
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (21.1s)
PASS  lint  (0.9s)
PASS  typecheck  (8.1s)
PASS  tests @zilar/server  (32.5s)
PASS  tests @zilar/xmpp-core  (1.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations from the spec

- The proof block was added to the existing `it` in `integration.test.ts` (which already has alice/bob connected and the DM handler) instead of a second `it`. Same assertions and same run, less duplicated setup.
- The task's Checks command uses `--reporter=dot` with the `integration` filter, which matches 4 files (`integration.test.ts` plus the existing `integration-sm.test.ts` and others). I ran exactly that command.

### Problems / needs a decision

- The worktree was missing the gitignored `infra/.env` that `integration.test.ts` loads (it lives in the main checkout). To run the required integration check I created a symlink at `infra/.env` → the main checkout's file. It is gitignored and not committed; I did not read or print its contents. If you prefer a different setup for parallel worktrees, please say so.
- No other test asserted the old query shape, so nothing else broke. No unfixed problems.

## Review (written by Claude)

Approved (lead, 2026-10-06). The hypothesis is proven against the dev stack. Before the fix, 40 messages with max=10 returned the oldest page ("private hello", m01-m09); after it, m31-m40. buildMamQuery now always sends <before>, empty when there is no cursor (XEP-0059 2.5). Cursor paging is unchanged. MAM and live ids match, so the trigger is not duplicated. This explains Julio's report (the deep test archive has 33 rows; the AI saw the oldest 30, ending at "are you still running?"). Nit accepted: the log matches by body.
