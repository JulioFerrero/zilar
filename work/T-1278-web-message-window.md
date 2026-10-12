---
id: T-1278
title: "PERF-3: bounded memory and DOM for long web sessions — client-core keeps at most 300 messages for a chat that is not open (pruned when another chat opens), and the web list renders only the newest 150 rows with an 'earlier' step before it pages the archive; prune tested"
status: merged
milestone: M5
branch: task/T-1278-web-message-window
model: auto
effort: default
depends_on: [T-1277]
estimate: 0.4 day
---

# T-1278: Windowed web message list and pruned background chats

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md` PERF-3 (P1, web).
- **The list:** `apps/web/src/components/MessageList.tsx` (364 lines) renders every loaded item, with no windowing.
- **Memory:** `messagesByChat` is never pruned outside sign-out, so DOM and memory grow with every page and every chat opened.
- **The audit's smallest fix:** cap chats that aren't open, and render only the newest ~150 items with a "load more" step.
- **Why pruning is safe:**
  - every open reloads the chat's newest page and resets its cursor from that page (`packages/client-core/src/store/history.ts:240-303`, `ctx.cursors[chatId] = page.first` at `:302`);
  - older pages then load from there (`loadOlderPage`, `history.ts:130-177`).
- **Where it runs:** web's `openChat` is `apps/web/src/store/effects/history.ts:34-70`.
- **File sizes:** `history.ts` is 400 lines.

### What to build
1. **client-core prune:**
   - a new `packages/client-core/src/store/prune.ts` exporting `pruneInactiveChats(ctx, activeChatId)`. For every other chat with more than `KEEP_INACTIVE = 300` messages, keep its newest 300 and set its `historyComplete` to false;
   - never touch the active chat, a chat with a send in flight (status `sending`) or a live AI draft. Cite how you detect each.
   - Call it from web `openChat` (`apps/web/src/store/effects/history.ts`), after `activeChatId` is set. Mobile is unchanged in this task.
   - Check that `loadOlderPage`'s merge dedupes by id (`k.sameMessage`) when a fetched page overlaps kept messages. If it doesn't, add the dedupe there with at most +2 lines, or in `prune.ts`, and cite it.
2. **Web window:**
   - a new `apps/web/src/components/useMessageWindow.ts` returns the newest `WINDOW = 150` render items, plus a function to grow the window by 150;
   - in `MessageList.tsx`, at the top, first grow the window while hidden items remain, and only page the archive (today's top-reached load) once the window shows everything;
   - keep the reading position when the window grows (the same technique the list uses for an older page, T-1199; cite it);
   - the unread divider, the jump to a message (search or pin) and reply-quote jumps must still find their target. When the target is outside the window, grow the window to include it first;
   - `MessageList.tsx` must end at most 400 lines.
3. **Tests** (the message pipeline), up to 2, in `packages/client-core/src/store/history.test.ts` or a new `prune.test.ts`:
   - prune keeps the newest 300 of an inactive chat and leaves the active chat untouched;
   - a chat with a sending message isn't pruned.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` PERF-3 and PERF-13, `packages/client-core/src/store/history.ts`, `apps/web/src/store/effects/history.ts`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageListRow.tsx` and `work/T-1199-*.md` (how older pages keep the position).

### Allowed files
`packages/client-core/src/store/prune.ts`, `packages/client-core/src/store/prune.test.ts`, `packages/client-core/src/store/history.ts`, `packages/client-core/src/store/history.test.ts`, `packages/client-core/src/store/index.ts`, `apps/web/src/store/effects/history.ts`, `apps/web/src/components/useMessageWindow.ts`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageListRow.tsx`, `work/T-1278-web-message-window.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every file stays at most 400 lines.
- **The lead's check on the web mock:** a chat opens at the bottom; scrolling up through a long chat shows earlier messages without a jump; a search hit and a pinned message still land.

---

## Report (written by the worker when done)

**Status: done, ready for review.** All checks pass and every touched file is at
most 400 lines.

### What I built

**1. client-core prune (`packages/client-core/src/store/prune.ts`, new)**
`pruneInactiveChats(ctx, activeChatId)` caps every chat but the open one to its
newest `KEEP_INACTIVE = 300` messages and sets that chat's `historyComplete` to
`false`, so its next open reloads from the newest page (`openHistory` resets the
cursor from `page.first`, `history.ts:302`). Messages are stored oldest first
(`sortMessages` on every write), so the tail is the newest. Skipped, with how
each is detected:
- the active chat — `chatId === activeChatId`;
- a send in flight — any message with `status === 'sending'` (its bubble must
  keep its retry target);
- a live AI draft — `state.drafts[chatId] !== undefined` (`CoreState.drafts` is
  keyed by chat id).
Exported from `packages/client-core/src/store/index.ts` (T6 history section).
Called from web `openChat` (`apps/web/src/store/effects/history.ts:108`), right
after `activeChatId` is set. Mobile untouched.

**Dedupe check (spec 1, last bullet):** `loadOlderPage` already dedupes by id.
It dedupes within the fetched page via `dedupePage(k.sameMessage, …)`
(`history.ts:153-156`) and against the already-loaded list via
`added = withEditsApplied.filter((message) => !loaded.some((item) =>
k.sameMessage(item.id, message.id)))` before `sortMessages([...added, ...loaded])`
(`history.ts:157-166`). No change was needed; a page that overlaps kept messages
still shows each message once.

**2. Web window (`apps/web/src/components/useMessageWindow.ts`, new; `MessageList.tsx`)**
`useMessageWindow(chatId, items, anchorIndex)` returns the newest
`WINDOW = 150` render items (`windowItems`), the slice `start`, `hasHidden`, the
pending `reveals`, and `grow` (adds 150). `MessageList` draws `windowItems` and
passes each row its full-array index (`start + index`), so the unread divider
(`dividerIndex === index`) still matches. `anchorIndex` is the divider index, so
the window always includes the divider and the mount effect can scroll to it.
`handleScroll` now, at the top, first grows the window while `hasHidden`
(setting `prependScrollHeight` first), and only calls `store.loadOlder` once the
window shows everything. The reading position is kept with the T-1199 technique:
the same `prependScrollHeight`/`useLayoutEffect` compensation
(`MessageList.tsx:169-192`, "WUX-11: compensate for a prepended page before
paint"), which the window growth reuses (a window grow is a prepend too).

**Jumps (search, pin, reply quote):** the jump callers and
`apps/web/src/lib/scrollToMessage.ts` are outside this task's Allowed files, so I
recorded the target at the only allowed seam: web `openChat`'s module wraps
`openAtMessage` (`apps/web/src/store/effects/history.ts:88-95`) and, on success,
calls `requestMessageWindowReveal(chatId, messageId)`. The window hook
subscribes (`useSyncExternalStore`) and grows to include the target, then scrolls
to it once drawn and forgets the reveal; the forced width is kept in state so the
position stays put. The list's mount scroll skips while a reveal is pending, so a
search hit that mounts the chat lands on the target, not the bottom. No caller
file was touched.

### Files changed (all inside Allowed files, all ≤ 400 lines)
- `packages/client-core/src/store/prune.ts` (new, 44)
- `packages/client-core/src/store/prune.test.ts` (new, 73)
- `packages/client-core/src/store/index.ts` (one export line)
- `apps/web/src/store/effects/history.ts` (308: prune call, reveal registry,
  wrapped `openAtMessage`)
- `apps/web/src/components/useMessageWindow.ts` (new, 122)
- `apps/web/src/components/MessageList.tsx` (388, was 364)
- `work/T-1278-web-message-window.md` (this report)

`packages/client-core/src/store/history.ts` (400) and
`MessageListRow.tsx` were not changed.

### Commands and real results
- `pnpm install`: done (10.7s, warning about a mobile `@types/react` peer, pre-existing).
- While working, single tests (quiet reporter, `--maxWorkers=2`):
  - `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/prune.test.ts` → 2 passed.
  - `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts src/store/prune.test.ts` → 21 passed.
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/sendFailure.test.ts src/store/effects/switchUser.test.ts` → 5 passed.
- Checks, `pnpm --filter @zilar/client-core exec vitest run src/store/history.test.ts --reporter=dot` → 19 passed.
- `pnpm gate` (repo root): **GATE PASS**. Summary lines:
  `PASS install (frozen) (1.3s)`, `PASS format (1.3s)`, `PASS lint (0.6s)`,
  `PASS typecheck (4.0s)`, `PASS effect (0.8s)`,
  `PASS tests @zilar/client-core (4.3s)`, `PASS tests @zilar/web (3.3s)`,
  `scope: every changed file is inside the Allowed files`,
  `migration: every added migration continues from the base`, `GATE PASS`.
  (The first gate run failed the lint step: `react(set-state-in-effect)` and
  `react-hooks(exhaustive-deps)` on my first draft, which used an effect to
  persist the window width and to clear a mount state. I moved the width
  persistence to React's adjust-state-during-render pattern and the mount check
  to a ref, and the second run passed.)

### Deviations / notes
- The spec says "grow the window to include it first" for jumps, but the only
  files that can observe a jump are the list and the window hook; the jump
  callers and `scrollToMessage.ts` are not in Allowed files. I therefore record
  the target in the allowed `openAtMessage` seam and share it with the hook
  through a small chat-keyed registry in `effects/history.ts` (ids only). The
  `Effect`/`Promise` contract of `openAtMessage` is unchanged, so the store's
  callers and `realStore.history.test.tsx` are unaffected.
- Ledger id pruning is PERF-13, not this task; pruned messages keep their ledger
  ids (noted in a comment in `openChat`).
- Known nuance: while the reader is off the bottom, a new message slides the
  newest-150 window by one row above the viewport; this relies on the browser's
  scroll anchoring, as with any newest-anchored window. The unread divider is
  always included, so an open with many unread can draw more than 150 rows, by
  design.

### Security checklist
No secrets/tokens touched. No deletes/updates (in-memory state only). No new
routes, caps or uniqueness rules. The reveal registry stores message ids only,
never text. No user input reaches logs or URLs.

## Review (written by Claude)


**Lead, 2026-10-12: approved. Pre-review clean (2 nits).**
- **The change:**
  - client-core `prune.ts` keeps the newest 300 messages of a chat that isn't open, skipping chats with a send in flight or a live draft; it's called from web `openChat`, with 2 tests in `prune.test.ts`;
  - web `useMessageWindow.ts` renders the newest 150 items and grows the window before paging the archive, including for jump targets outside the window.
- **Lead's check on the web mock:**
  - Dev team General (32 rows) opens with the "Unread messages" divider in view;
  - scrolling to the top shows the oldest message ("October 9") with no jump.
  - The mock has no chat over 150 rows, so the window-growth path isn't exercised here.
- **Lead's checks after the rebase:** client-core 135 passed; tsc on web and mobile: 0 errors. `MessageList.tsx` is at 388 lines.
- **Live check after deploy (Julio's account, read-only):** scroll a long chat on chat.zilar.app.
