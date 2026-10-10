---
id: T-0907
title: "Store core T6: incoming events, message actions, reads and history in packages/client-core, the web store on them, tests first"
status: merged
milestone: M5
branch: task/T-0907-store-core-t6-incoming-history
model: auto
effort: default
depends_on: [T-0903, T-0904]
estimate: 1.5 day
---

# T-0907: Store core T6, incoming, actions and history

## Spec (written by Claude, do not edit)

### Why
This is task T6 of `docs/STORE_CORE_PLAN.md` (section 6, "T6: incoming, message actions and history in core (core + web), tests first"). Follow it exactly. Its risk is medium-high, because of send echo matching and paging.

Changes since the plan was written:
- **Tests T-0904 already added.** `apps/web/src/store/realStore.ledger.test.tsx` covers:
  - an echo before `sendMessage` resolves (DM and group, both orders);
  - two identical texts in a row;
  - the echo of a reply.

  Do not write those again. Your tests-first file still needs the typing line clearing after 5 s and on `paused`, plus any gap you find in incoming, actions, reads or history.
- **The `ChatMessage` type.** T-0904 declared its own `LedgerStanza` type in `packages/client-core/src/store/ledger.ts`, because importing `ChatMessage` from `@zilar/xmpp-core` broke the client-core typecheck (the `@xmpp/client` type declarations are included only in the apps' tsconfigs). In this task, add that include to `packages/client-core/tsconfig.json`, and switch the core to `ChatMessage`.
- **Lines.** Re-check the plan's line numbers (`realStore.ts:1207-1314`, the ctx wiring) against the file. T-0904 cut `realStore.ts` from 1,550 lines to 479, so they have moved.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.incoming.test.tsx`, committed on the old code. It covers the typing-line cases and any gap you find, as described above.
2. **Core:** new `ctx.ts`, `ports.ts`, `reads.ts`, `incoming.ts`, `actions.ts` and `history.ts`, with their tests, in `packages/client-core/src/store/`, plus their lines in the T6 section of the index.
   - The ports follow plan section 4.
   - The core uses `makeLifetime` (T2) and the ledger (T3).
3. **Web:** `apps/web/src/store/effects/incoming.ts`, `messageActions.ts`, `history.ts` and `reads.ts` become bindings over the core, or are deleted. `effects/ctx.ts` and `effects/ports.ts` build the core ports from `RealStoreDeps`. `realStore.ts` keeps its facade.
4. **Split rule:** if the diff passes about 800 lines, stop after incoming plus actions plus reads, report, and the lead will chain history as its own task.
5. **Unchanged:** behaviour on web, and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0907/`; use `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2 to 7, `packages/client-core/src/store/*`, the Reports of `work/T-0903-*.md` and `work/T-0904-*.md`, and `apps/web/src/store/` (`realStore.ts`, `effects/*`).

### Allowed files
`packages/client-core/src/store/**`, `packages/client-core/tsconfig.json`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/incoming.ts`, `apps/web/src/store/effects/messageActions.ts`, `apps/web/src/store/effects/history.ts`, `apps/web/src/store/effects/reads.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/*.ts` (only imports of moved code), `apps/web/src/store/realStore.incoming.test.tsx`, `work/T-0907-store-core-t6-incoming-history.md`.

T-0906 edits mobile files and `packages/client-core/src/store/ledger.ts` in parallel. Do not change `ledger.ts` except for the `ChatMessage` switch, and keep that edit minimal.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the `realStore*.test.tsx` files and `effects/history.test.ts` 3 times. The guards are listed in plan T6.

### Acceptance
- The Checks pass, 3 runs.
- The tests-first commit comes before the move.
- No existing test is edited.
- The Report gives the lines per side, and either "no behaviour change" or the list of changes.
- Live check for Julio: on web, receiving messages, typing indicators, read marks, opening an old chat and scrolling back, and jumping to a message from search.

---

## Report (written by the worker when done)

**Split (rule 4).** The diff passed 800 lines after incoming, actions and reads (1,324 added and 507 deleted without rename detection), so I stopped there. **History is not moved:** `apps/web/src/store/effects/history.ts` and `effects/history.test.ts` are untouched, and the lead can chain it as its own task.

**Commits, in order**
1. `6a397313`: tests first. New `apps/web/src/store/realStore.incoming.test.tsx`, run on the old code, 9 tests, 9 passed in each of 3 runs. It covers:
   - the typing line: it clears 5 s after the last `composing`, a new `composing` restarts the wait, a `paused` clears it at once, and the cancelled wait cannot clear a later line;
   - a message in the open, visible chat: it is read, a displayed marker is sent and the last read is saved under `zilar:lastRead:u-me`;
   - a message in the open chat while the tab is hidden counts as unread, with no marker;
   - occupants: the online count, and the member count never shrinks;
   - presence: going offline stamps `lastSeenAt`;
   - an unchanged or empty edit sends no correction;
   - `sendTyping` uses the chat kind and does nothing for an unknown chat;
   - two `loadOlder` calls at once load one page.
2. `b4fd1c55`: the move. No existing test edited.

**Core (`packages/client-core/src/store/`)**
- `ports.ts`: `KeyValue` and `CorePorts`, which are `now`, `isVisible` and `storage`. Also `testCorePorts`.
- `ctx.ts`: `CoreState`, `CorePatch` and `CoreSet` (the same pattern as `LedgerState`), and `CoreCtx` with `get`, `set`, `ports`, `rt: Lifetime<never>`, `k: MessageLedger`, `fx: CoreHooks`, `core`, `lastRead`, `lastReadUserId` and `pendingOutgoing`. `fromPromise` is here too.
- `reads.ts`: `LAST_READ_PREFIX`, `persistLastRead` and `recordRead`.
- `incoming.ts`: `TYPING_CLEAR_MS` and the five handlers.
- `actions.ts`: `react`, `editMessage`, `deleteForEveryone` and `sendTyping`.
- Five export lines in the T6 section of `index.ts`.
- Tests: `incoming.test.ts` (12), `actions.test.ts` (8) and `reads.test.ts` (4), plus the shared helper `test-ctx.ts`, which is not exported.
- **ChatMessage:** `tsconfig.json` now includes `../xmpp-core/src/types/xmpp.d.ts`. In `ledger.ts`, `LedgerStanza` is now `Omit<ChatMessage, 'kind'>` (3 lines added, 26 deleted). `kind` is left out because `ledger.test.ts` builds stanzas without it, and that test cannot be edited. The new core files use `ChatMessage` directly.

**Web**
- `effects/incoming.ts` and `effects/messageActions.ts` are deleted. `lifecycle.ts` and `realStore.ts` import the handlers and actions from `@zilar/client-core/store`.
- `effects/reads.ts` keeps `saveChatList` and re-exports `persistLastRead` and `recordRead`.
- `effects/constants.ts` re-exports `LAST_READ_PREFIX` and `TYPING_CLEAR_MS`.
- `effects/ctx.ts`: `StoreCtx extends CoreCtx`. Its `PortsShape` already has `now`, `isVisible` and `storage`, so `effects/ports.ts` is unchanged.
- `realStore.ts` adds `fx`:
  - the badge sync and the push dismiss go to `badge.ts`;
  - `loadGroupMembersInBackground`;
  - `markTurnFinished` then `clearDraftTimeout`, in the old order;
  - `forgetRetryBytes` deletes the id from `pendingVoices` and `pendingAttachments`.

**Lines per side** (`git diff --numstat --no-renames 1b56a2e1 HEAD`)
- Core source: +577 (actions 180, ctx 86, incoming 238, ports 29, reads 39, index 5). `ledger.ts`: +3 / -26. `tsconfig.json`: +1 / -1.
- Core tests: +485 (incoming 206, actions 129, reads 62, test-ctx 88).
- Web source: +42 / -479 (incoming -241, messageActions -181, reads +5 / -36, ctx +6 / -10, lifecycle +7 / -7, realStore +23 / -2, constants +1 / -2).
- Web tests: +215 (the new file).

**Behaviour differences:** none.
- The deleted retry bytes are the same four map entries, deleted in a different order, which nobody can observe.
- Badge, push, member loads and draft timers go through the same web functions as before.

**Where I went off the plan sketch (section 4)**
- `isVisible` is a flat port, not `visibility.isVisible()`, so web's `PortsShape` fits without a change. T8 can add `onFocus`.
- Badge and push are `CoreHooks` on `ctx.fx`, not a ports field. The web badge needs the store's `get` and `rt`. `syncBadge()` takes no chats, because web reads them when the sync runs.
- `CoreHooks` also carries the member load (phase 2), the draft-turn finish (T8) and the retry bytes (T10), as synchronous fire-and-forget calls, so the timing stays the same.

**Found, not fixed (an existing web bug, not pinned by any test):** `loadOlder` called while the first page is still loading pages back from the cursor the list preview set at boot. A probe on the old code with 60 messages gave 100 bubbles for 51 unique ids. The cause is that `loadOlderPage` does not de-duplicate (`history.ts` `loadOlderPage`, `sortMessages([...withEditsApplied, ...k.listFor(...)])`). It belongs to the history task.

**For T7 (mobile):** `CorePatch.actionError` is `CoreActionError | undefined`. Mobile declares `actionError?: {...}`, so under `exactOptionalPropertyTypes` it will need `| undefined` before mobile's `set` fits `CoreSet`.

**Process note:** I wrote the one-line `packages/client-core/tsconfig.json` change with a shell heredoc, not with Edit/Write. The content is the same as an Edit would give.

**Checks** (wave mode, no `pnpm gate`)
- `pnpm --filter @zilar/client-core exec vitest run --reporter=dot`: 100 passed in each of 3 runs. That is 76 before plus 24 new.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot src/store`: 18 files, 228 passed.
- All six `realStore*.test.tsx` files plus `effects/history.test.ts`, 3 runs: 185 passed each time.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot`: 188 files, 1934 passed.
- `pnpm --filter @zilar/client-core typecheck`, `@zilar/web typecheck` and `@zilar/mobile typecheck`: clean.
- `prettier --check` and `oxlint` on every changed file: clean.

**Live check for Julio (web):** receiving messages, typing indicators, read marks, reactions, edit and delete.

## Review (written by Claude)

**Lead, 2026-10-10: approved. History is split off to T-0912 under the 800-line rule.**
- **What moved:** incoming events, message actions and reads, into `packages/client-core/src/store/` with 24 new core tests. Web `effects/incoming.ts` and `messageActions.ts` are deleted.
- **Tests first:** `realStore.incoming.test.tsx` has 9 cases, committed before the move.
- **Behaviour:** none changed. The existing tests are unedited, and the realStore files pass 3 runs.
- **Accepted:** `LedgerStanza` is `Omit<ChatMessage, 'kind'>`, and `CoreHooks` carries the web callbacks.
- **Bug found, already on main:** `loadOlder` during the first history page does not de-duplicate the overlap. T-0912 fixes it, tests first.
- **Note for T7:** mobile's `actionError` type needs `| undefined`.
- **Check:** the combined check passes.
- **Live check for Julio:** receiving messages, typing indicators, read marks, reactions, edits and deletes on web.
