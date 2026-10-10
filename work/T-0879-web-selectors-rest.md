---
id: T-0879
title: "Web: ChatView and the remaining useChatStore() call sites use useChatSelector; GroupHeaderRow memoised"
status: merged
milestone: M5
branch: task/T-0879-web-selectors-rest
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0879: Web: ChatView and the remaining useChatStore() call sites use useChatSelector; GroupHeaderRow memoised

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Follow-up of T-0845 (web store selectors; read its Report in `work/T-0845-web-store-selectors.md`).
- **ChatView:** it still uses `useChatStore()` (the whole state) and passes new `onReply`, `onForward` and `selection` callbacks on every render, so `MessageList` re-renders on every store change.
- **The rest:** about 30 other call sites of `useChatStore()` remain (`grep -rn "useChatStore()" apps/web/src`), and `GroupHeaderRow` is not memoised.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Convert `ChatView` to narrow `useChatSelector` selectors, and make its callbacks stable.
2. Convert the remaining `useChatStore()` call sites the same way. Selectors must return stable values.
3. Memoise `GroupHeaderRow`.
4. Once nothing uses `useChatStore()`, remove it. Keep `useChatStoreApi` for actions.
5. Extend T-0845's render-count tests to `ChatView`: a typing event in another chat must not re-render `MessageList`.

Rendered output stays the same.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/web/src/**`, `work/T-0879-web-selectors-rest.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.
- Live check for Julio's single test: Julio streams an AI reply in a long chat on web.

---

## Report (written by the worker when done)

- Built on T-0845 (merged `task/T-0845-web-store-selectors` into this branch first).
- All 29 `useChatStore()` call sites converted to `useChatSelector` (raw slices, `find` results, booleans; module-level empty arrays for fallbacks) plus `useChatStoreApi().getState()` for actions in `Composer`, `ChatView`. `useChatStore` removed from `ChatStoreProvider.tsx`; `grep "useChatStore()"` now 0 hits.
- `ChatView`: selectors for `currentUserId`, `editTarget`, `topicNotice`, `pinsPanel`; `startReply`, `forwardOne`, `startSelect`, `toggleSelect` are `useCallback`; `selection` is `useMemo`. `MessageList` is now `memo`.
- `GroupHeaderRow` is `memo`. Its three handler props now take the group id (`onToggleCollapse(groupId)`, `onToggleArchived(groupId)`, `onOpenNewTopic(groupId)`), and `ChatList` passes stable `useCallback`s, so memo works.
- `FolderTabs`/`FolderRail` call `folderUnreadTotal` from chat-core directly (the `folderUnread(state, id)` helper needed the whole state).
- New test `apps/web/src/routes/ChatView.selectors.test.tsx`: Profiler around `ChatView`; a typing event in another chat commits 0 renders and text is unchanged.
- Numbers: 30 files, +327/-219 lines (production code only: +260/-219, net +41; the diff grows because each former `store.x` became a named selector). Web tests: 1947 passed (1946 + 1 new), 187 files, 3 of 3 full runs with `--maxWorkers=3` (load average 105-183). Typecheck and oxlint clean, prettier applied.
- Flakes seen under load 140-230 with default workers: only timeouts (15 s) in unrelated files, and `Composer.voice` "clicks to record and sends through the Send button" (the 400 ms hold timer; it also failed once on the unchanged base code).
- Spec facts: all call sites matched the grep (29 plus the definition).
- Behaviour differences: none intended. Small timing differences: `ChatView.forwardSelected`, `Composer.editLastMessage` and the mention list read the store at call time (`getState()`) instead of the render snapshot (fresher, same data). `ChatMediaPanel`, `MessageSearchResult`, `PinsPanel` rows now re-render only when their own slice changes.
- Not verified: the new ChatView test was not run against the old code (the old `useChatStore()` was removed, so it cannot compile there).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** All 29 `useChatStore()` sites now use narrow selectors, and `useChatStore` is gone. ChatView's handlers are stable, and `MessageList` and `GroupHeaderRow` are memoised. A new test proves that a typing event in another chat causes 0 ChatView commits. The code grew by 41 lines for named selectors, which is acceptable for the render savings. The combined wave 4 check passes. Live check for Julio: an AI reply streaming in a long chat on web.
