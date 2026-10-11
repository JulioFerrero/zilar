---
id: T-1134
title: "Size split: apps/web/src/store/realStore.ts (524) — the closure's mutable locals, the ctx build and the store actions move into store/effects/ modules (same pattern as mobile T-1130); behaviour unchanged"
status: merged
milestone: M5
branch: task/T-1134-split-web-real-store
model: auto
effort: default
depends_on: [T-1130]
estimate: 0.4 day
---

# T-1134: Split the web chat store

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, chose "finish the leftovers". `apps/web/src/store/realStore.ts` has 524 lines and is the web **message pipeline**. T-1130 split the mobile twin the same way: `apps/mobile/src/store/effects/locals.ts`, `helpers.ts` and `user-state.ts`; read them first and follow the pattern.

**Web has few store tests** (`apps/web/src/store/effects/sendFailure.test.ts`). The lead tests this branch on a local stack **before** merging, because a web merge deploys live. So keep it a pure move.

**What the lead read:**
- **`createRealChatStore`** (`:105`), then `createAtomStore((set, get) => {` (`:110`).
- **The mutable locals** (`:111-153`): `core`, `lastRead`, `lastReadUserId`, `groupsJoined`, `finishedTurns`, `finishedTurnOrder`, `mediaToken`, `quietArchiveIds`, `cursors`, `pendingOutgoing`, `pendingAttachments`, `pendingVoices`, `sendRuns`, `groupIds`, `groupMembers`, `groupInfos`, the loading sets, and `pendingOpenChatId`.
- **The ledger and helpers:** `ledger` (`:157`) and the helpers `removeFailedMessage`, `rememberGroupIds` and `nick` (`:168-193`).
- **`ctx: StoreCtx`** (`:194-293`), with the `k` and `fx` hooks. Its type is in `apps/web/src/store/effects/ctx.ts`.
- **The returned state and actions** (`:295-524`): about 120 entries. Many are `(args) => rt.runPromise(effect(ctx, args))`.

### What to build
1. **A new `apps/web/src/store/effects/locals.ts`:** `createStoreLocals()` returns one object with every mutable local above. The `let`s become properties, and their comments move with them.
2. **A new `apps/web/src/store/effects/storeContext.ts`:** `makeStoreContext({ locals, ports, rt, set, get })` builds the ledger, the three helpers and `ctx` exactly as `:157-293` do today, with `x` → `locals.x`, and returns `{ ctx, ledger, … }`.
3. **The actions:** move the returned actions into one or two new modules (for example `apps/web/src/store/effects/chatActions.ts` for messages, pins, chats and prefs, and `apps/web/src/store/effects/groupActions.ts` for topics, groups and channels). Each exports `make…Actions({ ctx, rt, locals, set, get, ports })`, which returns its slice. `realStore.ts` spreads the slices in the **same key order** as today, after the initial state fields.
4. **No behaviour change:**
   - every action body stays identical apart from `x` → `locals.x`;
   - the same state keys and the same initial values;
   - the exports of `realStore.ts` are unchanged (`:96-103` and `createRealChatStore`).
5. **Tests:** run `apps/web/src/store/effects/sendFailure.test.ts` and any test that imports `realStore` (`grep -rln "realStore" apps/web/src | grep test`). **Do not edit them.** Paste the results.
6. **Line counts:** every file stays at most 400 lines. Paste `wc -l` in the Report.

### Read first
`AGENTS.md`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/runtime.ts`, and the mobile T-1130 files (`apps/mobile/src/store/effects/locals.ts`, `apps/mobile/src/store/effects/helpers.ts`).

### Allowed files
`apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/locals.ts`, `apps/web/src/store/effects/storeContext.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/store/effects/ctx.ts`, `work/T-1134-split-web-real-store.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/effects/sendFailure.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every file is at most 400 lines.
- **The lead's local-stack check passes before merge:** sign in, chats load, send and receive a message, react, edit, open a group topic, sign out.

---

## Report (written by the worker when done)

Pure move of `apps/web/src/store/realStore.ts` (524 lines) into the module layout
T-1130 uses on mobile. No behaviour change.

### What I did
- `effects/locals.ts` (new): `StoreLocals` + `createStoreLocals()` hold the 20
  mutable locals that were `let`/`const` in the store closure (`core`,
  `lastRead`, `lastReadUserId`, `groupsJoined`, `finishedTurns`,
  `finishedTurnOrder`, `mediaToken`, `quietArchiveIds`, `cursors`,
  `pendingOutgoing`, `pendingAttachments`, `pendingVoices`, `sendRuns`,
  `groupIds`, `groupMembers`, `groupInfos`, `loadingGroupMembers`,
  `loadingOlder`, `loadingHistory`, `pendingOpenChatId`); their comments moved
  with them.
- `effects/storeContext.ts` (new): `makeStoreContext({ locals, ports, rt, set,
  get })` builds the ledger, the three helpers (`removeFailedMessage`,
  `rememberGroupIds`, `nick`) and `ctx` exactly as before, with `x` →
  `locals.x`; it returns `{ ctx, ledger }`.
- `effects/chatActions.ts` (new): `makeChatActions(deps)` returns the
  chats/messages/pins/prefs/search/lifecycle slice (44 actions) typed
  `ChatActions = Pick<ChatStoreState, …>`.
- `effects/groupActions.ts` (new): `makeGroupActions(deps)` returns the
  topics/groups/channels slice (25 actions, incl. `dismissTopicNotice`) typed
  `GroupActions = Pick<ChatStoreState, …>`.
- `realStore.ts` (524 → 103): keeps the exports unchanged, the initial state
  values and the read-only selectors (`historyStateFor`, `messages`,
  `groupMembers`, `groupInfo`, `hasMore`, `pins`, `pinsLoaded`, `canPin`,
  `pinFor`, `archivedChats`), then spreads `makeChatActions(…)` and
  `makeGroupActions(…)`. `effects/ctx.ts` unchanged.

Every action body is identical apart from `x` → `locals.x`; the state keys and
initial values are unchanged; the exports of `realStore.ts` are unchanged.

### Files changed
- `apps/web/src/store/realStore.ts` (M)
- `apps/web/src/store/effects/locals.ts` (new)
- `apps/web/src/store/effects/storeContext.ts` (new)
- `apps/web/src/store/effects/chatActions.ts` (new)
- `apps/web/src/store/effects/groupActions.ts` (new)
- `work/T-1134-split-web-real-store.md` (M)

### Commands and results
- `pnpm install`: done (676 added, 12s), no lockfile change.
- `pnpm --filter @zilar/web exec vitest run src/store/effects/sendFailure.test.ts --reporter=dot`: 1 file passed, 4 tests passed.
- The realStore tests (every test file that imports `realStore`), `pnpm --filter
  @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/sendFailure.test.ts
  src/store/realStore.echo-edit.test.tsx src/store/realStore.history.test.tsx
  src/store/realStore.incoming.test.tsx src/store/realStore.ledger.test.tsx
  src/store/realStore.lifecycle.test.tsx src/store/realStore.send.test.tsx`: 7
  files passed, 41 tests passed.
- `pnpm gate` from the repo root:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (1.2s)
PASS  typecheck  (2.8s)
PASS  effect  (0.8s)
PASS  tests @zilar/web  (3.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Line counts (`wc -l`)
```
103 apps/web/src/store/realStore.ts
 82 apps/web/src/store/effects/locals.ts
188 apps/web/src/store/effects/storeContext.ts
215 apps/web/src/store/effects/chatActions.ts
145 apps/web/src/store/effects/groupActions.ts
```
All ≤ 400.

### Deviations from the spec
- `makeStoreContext` returns `{ ctx, ledger }`; nothing else was needed, so the
  spec's `…` is empty.
- Actions are split by concern (chat vs group) with the spec's suggested names;
  the two slices are spread after the state fields, as the spec allows. The
  original interleaving of state and actions cannot be reproduced with two
  spreads, so the overall key order is state-first then the two slices;
  `createAtomStore` merges by key, so this has no effect.
- `dismissTopicNotice` is grouped with the group/topic actions.
- Selectors that only read state (`messages`, `groupMembers`, `groupInfo`,
  `hasMore`, `pins`, `pinsLoaded`, `canPin`, `pinFor`, `archivedChats`) stay in
  `realStore.ts` with the state they read, since the spec moves "the returned
  actions".

### Blocked / needs a decision
Nothing.

### Open questions
None. The lead's local-stack check (sign in, chats load, send and receive a
message, react, edit, open a group topic, sign out) is still required before
merge; I could not run it in this worktree.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The split:** web `store/realStore.ts` goes from 524 to 103 lines. `effects/locals.ts` (82), `effects/storeContext.ts` (188), `effects/chatActions.ts` (215) and `effects/groupActions.ts` (145) hold the moved code.
- **The lead's key check:** all 109 state and action keys of main's returned object are present in the new files.
- **Tests:** the lead ran `sendFailure.test.ts` on the branch: 4 green. The gate passed.
- **The lead's local-stack check, branch web against the local server, two local test accounts:**
  - sign in;
  - chats load;
  - a group topic opens with history, images, a sticker and reactions;
  - send, react (👍 shown on both sides) and edit ("edited" label, list preview updated);
  - receive live from the second account, with the typing indicator and the unread badge;
  - sign out.

  All of it works.
- **Found during the check, not caused by this task:** signing in at `/login` while another account is still signed in keeps the old account's chat session until the page is reloaded. The lead reproduced it on main. This gets its own task.
