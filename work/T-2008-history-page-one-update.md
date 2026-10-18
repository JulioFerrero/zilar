---
id: T-2008
title: "Chat perf W1: a page of older history lands in one store update — batch reaction and edit ingestion per page, Set-based merge, Map-based edit refresh, day separators keyed by day — web and phone share it, with tests"
status: merged
milestone: M5
branch: task/T-2008-history-page-one-update
model: anthropic/claude-sonnet-5-5
effort: high
estimate: 60 min
---

# T-2008: One store update per history page (perf W1)

## Spec (written by Claude, do not edit)

### Why
On 2026-10-18 Julio reported that scrolling up in a chat stutters: "a little scroll, 4 or 5 times … then boom … almost 4 fps". The lead's performance audit (T-1997, `docs/audit/chat-scroll-perf.md`, cause C4 and the W1 section) found the cause on the store side.
- **Many store updates per page.** One page of 50 older messages lands as a burst of store updates: one or two for each reaction stanza, one to three for each edit stanza, each walking the whole loaded list.
- **A quadratic merge.** The merge is O(page × loaded).
- **Every update re-runs every row.** Every update notifies every mounted row's selectors.

This code is shared by web and phone, and it is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18; details and line numbers in `docs/audit/chat-scroll-perf.md` §2.1 and §3 C4, C10)
- **The page load.** `packages/client-core/src/store/history.ts` (327 lines), `loadOlderPage` (`:50-90`):
  - `k.ingestHistoryReactions(page.messages)` and `k.ingestHistoryEdits(page.messages)` run first;
  - then it maps the older messages with `k.toUiMessage` and `k.resolvePendingEdits`;
  - then `dedupePage`;
  - then one `ctx.set` whose merge does `withEditsApplied.filter((message) => !loaded.some((item) => k.sameMessage(item.id, message.id)))` and `sortMessages([...added, ...loaded])`;
  - then `k.refreshEdits(chatId)` and `applyChatReadMark(ctx, chatId)`.
- **Reactions and edits.**
  - `ledger-reactions.ts` (122 lines) runs `applyReactionUpdate` with a `set` per reaction and then `refreshReactions`.
  - `ledger-edits.ts` (399 lines, at the limit) runs `applyEditUpdate` with a `set` per edit, `resolvePendingEdits` and `refreshEdits`, plus `withReplyQuote`, which does a `list.find` per reply.
- **Notifications.** `packages/client-core/src/atom-store.ts` (103 lines) notifies every listener synchronously on each `set`.
- **Day separators.** `packages/chat-core/src/messages.ts` (368 lines) keys the day separator by the day's first message id (`:70`), so each older page of the same day remounts it.
- **Tests.** `packages/client-core/src/store/history.test.ts` (474 lines) and `ledger.test.ts` exist.

### Steps
1. **Batch a page.** While a page is ingested, apply all of its reaction and edit updates to a working copy, with no `set` per stanza. Then commit everything (messages, reactions, edits, `historyComplete`, the read mark) in **one** `ctx.set`.
   - Move `ingestHistoryEdits` and the page batching into a new `packages/client-core/src/store/ledger-history-ingest.ts`, so `ledger-edits.ts` gets shorter, not longer.
   - Add a `batch(fn)` to `atom-store.ts` only if one `set` can't express it.
2. **Linear merge.** Build a `Set` of the loaded messages' alias roots and merge in O(page + loaded). Sort only if the page isn't already older than everything loaded.
3. **Linear edit refresh.** `refreshEdits` and `withReplyQuote` use a `Map` from id to message instead of `list.find` per message.
4. **Stable separators.** The day separator's key is the day (for example `day:2026-10-18`), not the first message's id.
5. **Same results.** The final state must equal today's for every existing case in `history.test.ts` and `ledger.test.ts`.
6. **Tests** in a new `packages/client-core/src/store/history-page.test.ts`:
   - a page with 5 reactions and 5 corrections notifies the store **once**;
   - the final messages match the unbatched result;
   - the separator key is stable when an older page of the same day arrives.
7. **Keep files small.** Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/ledger-reactions.ts`
- `packages/client-core/src/store/ledger-edits.ts`
- `packages/client-core/src/store/ledger-history-ingest.ts`
- `packages/client-core/src/store/ledger.ts`
- `packages/client-core/src/atom-store.ts`
- `packages/chat-core/src/messages.ts`
- `packages/client-core/src/store/history-page.test.ts`
- `work/T-2008-history-page-one-update.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The new tests pass, all existing store tests pass, and the gate passes.
- The lead checks in the web mock and in a phone smoke that scrolling up loads older pages with no duplicates or reordering.

---

## Report (written by the worker when done)

### What I did
- **One update per older page.** `loadOlderPage` (`history.ts`) now runs the whole page inside `k.collectPage(...)`. The ledger keeps a working copy of the state (`createLedgerBatch` in `ledger-history-ingest.ts`, wired in `ledger.ts`); every ledger `set` inside the batch writes to the copy and reads see it. The page's reactions, edits, merged messages, `refreshEdits` and the read mark (`applyChatReadMark` runs against a context whose get/set point at the copy) are collected, then committed with the `historyComplete` flag in a single `ctx.set`. `atom-store.ts` is unchanged: one `set` was enough, so no `batch(fn)`.
- **Fewer walks over the loaded list.** `ingestHistoryReactions` records all updates, then refreshes chips once per chat. `ingestHistoryEdits` (moved to `ledger-history-ingest.ts`) records all edits and cards, then runs `resolvePendingEdits` + `refreshEdits` once per chat. `recordEdit`, `editUpdateFor`, `cardEditFor` and `rememberCard` moved there too, so `ledger-edits.ts` went from 399 to 320 lines. The live path `ingestEdit` behaves as before. Its `bumpRoutine` parameter is removed, because only the history path ever passed `false`.
- **Linear merge.** `mergeOlderPage`: a `Set` of loaded alias roots, and `sortMessages` only when the concatenation is not already in (createdAt, id) order.
- **Linear edit refresh.** `refreshEdits` and `withReplyQuote` look up reply targets and the preview message through a `Map` from alias root to first index.
- **Stable separators.** `groupMessages` keys a day separator `day:YYYY-MM-DD`, in local time like `sameDay`.
- **Tests.** New `history-page.test.ts`: (1) a page with 5 reactions and 5 corrections, including pending ones for older targets, notifies the store once; (2) the final messages, edits and reactions equal those of the unbatched per-stanza path; (3) the separator key stays the same when an older page of the same day arrives.
- Files changed: `packages/chat-core/src/messages.ts`, `packages/client-core/src/store/{history,ledger,ledger-edits,ledger-reactions}.ts`, new `ledger-history-ingest.ts` and `history-page.test.ts`, this task file.

### Checks run
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store`: 16 files, 191 tests passed (run before the last Effect fix; after it I re-ran `history-page`, `history`, `ledger`: 55 passed).
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot`: 20 files, 156 tests passed.
- `pnpm gate` (final run):
  - PASS install, format, lint, typecheck, effect, tests @zilar/chat-core, tests @zilar/client-core
  - scope: every changed file is inside the Allowed files
  - size: every changed source file is within 400 lines
  - GATE PASS
  - Earlier runs failed on format (fixed with prettier) and on the Effect ratchet W4 (a `try/finally` in the batch; replaced by `Effect.ensuring`).

### Notes for the lead
- I did not batch `openHistory` (the first page) or `loadPreview`; the spec names only older pages. `openHistory` still gets the per-chat single refresh for reactions and edits through the shared ingest functions. Batching its `ctx.set` as well would be a small follow-up.
- If a page throws midway, nothing of it is committed any more. Before, the stanzas ingested up to that point stayed. The cursor is left for a retry either way.
- A card-only edit stanza in history now also runs `resolvePendingEdits` for its chat, which it did not before. No test showed a difference.
- A separator's id (render key) changes from `separator-<messageId>` to `day:<date>`. Web and phone only use it as a key; I found no other reader.
- I did not run the web mock or a phone smoke; that is the lead's check.

## Review (written by Claude)

Approved: a clean pre-review with 5 nits.
- **One update per page.** A page of older history now lands in one store update. Reactions and edits are batched on a working copy in the new `ledger-history-ingest.ts`.
- **Linear merge.** The merge is Set-based, and the edit refresh is Map-based.
- **Stable separators.** Day separators are keyed by day.
- **Smaller file.** `ledger-edits.ts` went from 399 to 320 lines.
- **Lead re-run in the worktree:**
  - client-core store: 191 tests;
  - chat-core: 156 tests;
  - web store (with the history tests): 47 tests.
- **Follow-up.** Opening a chat (the first page) still does three separate updates, which a later perf task folds in. The phone smoke runs together with T-2009.
