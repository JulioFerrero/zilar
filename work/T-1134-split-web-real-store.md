---
id: T-1134
title: "Size split: apps/web/src/store/realStore.ts (524) — the closure's mutable locals, the ctx build and the store actions move into store/effects/ modules (same pattern as mobile T-1130); behaviour unchanged"
status: todo
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

## Review (written by Claude)
