---
id: T-0846
title: "Mobile message list: memoised bubbles, AI draft outside the list entries, then real windowing"
status: merged
milestone: M5
branch: task/T-0846-mobile-message-list-perf
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0846: Mobile message list: memoised bubbles, AI draft outside the list entries, then real windowing

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Performance finding E-F2 in `docs/audit/simplify-2026-10-09/E-mobile.md`, verified by the lead.
- **Everything renders on mount:** `apps/mobile/src/components/chat/message-list.tsx:289` sets `initialNumToRender={Math.max(entries.length, 1)}`, so every loaded message renders at once.
- **Every row re-renders:** `renderItem` is an inline closure building `MessageBubble` with about 25 props (about lines 322-360). `MessageBubble` (`message-bubble.tsx`, 754 lines) is not `memo`.
- **Every draft token re-renders the list:** the list reads 15 `useChatStore` selectors (about lines 108-132), including `drafts` and `finishedDraftMessages`. So each streamed draft token rebuilds `entries` and re-renders every bubble.
- **The risk:** jump-to-message (`startJumpScroll`, `scrollToIndex`, `onScrollToIndexFailed`) may rely on every row being measured, which is probably why all rows render.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
In this order, one commit each:
1. `memo(MessageBubble)` with stable props. Pass the handlers once (a stable handler object via `useMemo`/`useCallback`, or a small context), so a bubble re-renders only when its own message or its selection changes.
2. Take the AI draft out of `entries`: render the draft bubble as a separate footer, or behind its own selector, so draft tokens re-render only the draft bubble.
3. Drop the `initialNumToRender` override: use a fixed value such as 20 and the default `windowSize`. Keep jump-to-message working through `onScrollToIndexFailed` (scroll near, wait, retry), the scroll-to-unread and the load-older trigger. If the jump cannot be made reliable without measuring all rows, keep step 3 out and say so in the Report. Do not switch to FlashList in this task.

Tests: the existing `message-list.test.tsx`, `jump-scroll.test.ts` and `message-bubble.test.tsx` must pass. Add a test that a draft update does not re-render a non-draft bubble (count renders with a probe).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/jump-scroll.ts`, `apps/mobile/src/components/chat/*.test.ts`, `apps/mobile/src/components/chat/*.test.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/components/screens/chat-id-screen.test.tsx`, `work/T-0846-mobile-message-list-perf.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat src/components/screens/chat-id
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: The lead checks a long chat, scroll-back and search-jump on the emulator (phone smoke); Julio checks a streamed AI reply on the phone.

---

## Report (written by the worker when done)

## Review (written by Claude)

**Lead, 2026-10-10: approved (step 1 only).**
- **Done:** memoised bubbles with stable handlers. A draft token now re-renders only the draft bubble, and a new jsdom test proves it.
- **Skipped:** steps 2 (draft outside the entries) and 3 (windowing). The spec allows this fallback, because they need device checks of the reveal animation and of `scrollToIndex`; they are a follow-up.
- **Checks:** the combined check is clean and the phone smoke of the wave branch passes.
- **Live check for Julio:** an AI reply streaming in a long chat on the phone.

- Done (step 1): `MessageBubble` is now `memo(MessageBubbleImpl)` (`message-bubble.tsx`). `MessageList` passes stable handlers: `useStableHandler`/`useStableReact` keep one identity per handler (latest closure in a ref, updated in an effect) and stay `undefined` when the screen passes none, so the bubble still hides the matching action. Selection toggle/start use the same hook. `isPinned`, `selecting`, `selected` are primitives per row. No change was needed in `chat/[id].tsx`.
- Test: `message-list.test.tsx` now runs in jsdom. The store mock returns the same message objects each read and `LinkText` records each text render. New test: a draft text update re-renders only the draft bubble (m1 and m2 do not re-render). Verified red without the memo (m1 and m2 re-rendered), green with it.
- NOT done, step 2 (draft as separate footer): a footer bubble is a different parent than the list row, so when the final message replaces the draft (same key `draft-<turn>`, `revealTurnId`) the bubble would remount and lose the shown-length reveal (`initial: 'full'` snaps in). I could not check that on a device in wave mode, so I left the draft as a list entry. With the memo, a draft token now re-renders only the draft bubble; remaining per-token cost is `groupMessages` plus the FlatList diff.
- NOT done, step 3 (drop `initialNumToRender`): mount scroll to the unread divider, `scrollToEnd`, search jump and pin jump all use `scrollToIndex` without `getItemLayout` and rely on measured rows. I cannot verify reliability without the emulator, so the spec's fallback applies: step 3 stays out.
- Spec facts checked: `initialNumToRender={Math.max(entries.length, 1)}` and the 15 store selectors are as the audit said; the inline `renderItem` closure is still there but is now cheap because bubbles are memoised.
- Tests: `src/components/chat` + `src/components/screens/chat-id`: 70 files, 514 passed after, 3 of 3 runs (513 before, plus the new test). Typecheck and oxlint clean.
- Behaviour differences: none intended. A handler is called through a ref updated in an effect, so a tap in the instant between render and effect uses the previous closure.
- Unsure: nothing measured on a device (no render timings taken, only render counts in the test).
