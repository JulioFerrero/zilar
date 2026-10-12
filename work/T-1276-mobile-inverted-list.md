---
id: T-1276
title: "MUX-2: mobile chats open at the bottom instantly — the message list becomes an inverted FlatList (newest first), so there is no full-history render and no five mount scrolls; older pages load at the list's end; every scroll path (divider, jump-to-bottom, search and pin jumps, keyboard, new messages) keeps working"
status: merged
milestone: M5
branch: task/T-1276-mobile-inverted-list
model: auto
effort: default
depends_on: [T-1275]
estimate: 0.5 day
---

# T-1276: Open chats at the bottom instantly (mobile)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-2 (P1, `:35`): opening a chat renders the whole loaded history, then scrolls five times, so there is a visible jump and long chats open slowly. Today:
- `apps/mobile/src/components/chat/message-list.tsx:289` sets `initialNumToRender={Math.max(entries.length, 1)}` (every row);
- `apps/mobile/src/components/chat/use-message-list-scroll.ts:62-79` scrolls to the end, or to the unread divider, at mount and again at 80, 200, 400 and 700 ms;
- re-pinning at the bottom uses `scrollToEnd` in `onContentSizeChange` and `onLayout` (`message-list.tsx:311-323`, MUX-7 from T-1172) and in the new-message effect (`use-message-list-scroll.ts:81-97`);
- older pages load when the scroll offset is near the top (`message-list.tsx:324-331`);
- the jump-to-bottom button (`message-list.tsx:203`, `JumpToBottom` at `:335`), the search jump (`use-message-list-scroll.ts:106-121`, `jump-scroll.ts`) and the pin jump (`:123-140`) use `scrollToIndex` on `entries` indexes.

The audit's fix: render the list `inverted`, with the entries reversed, so the bottom is where the list starts and no mount scrolls are needed.

### What to build
1. **The list is inverted:**
   - in `message-list.tsx`, pass the entries newest-first (a memoised reversed copy) with `inverted`. On screen the order is unchanged: date separators, the unread divider and grouping read as today;
   - `initialNumToRender` goes back to a small number (about 20), with `windowSize` and `maxToRenderPerBatch` kept.
2. **Every index is an index into the reversed data:**
   - the unread divider index, the search jump's `findIndex`, the pin jump's `findIndex` and `onScrollToIndexFailed`;
   - find each use and convert it in one place (a helper, or compute indexes on the reversed array). Cite each use in the Report.
3. **The bottom is offset 0:**
   - `scrollToEnd` calls become `scrollToOffset({ offset: 0 })`;
   - `atBottom` is `contentOffset.y < 40`.
4. **Mount:**
   - no unread divider: no scroll at all;
   - an unread divider: one `scrollToIndex` on the divider (reversed index, `viewPosition: 0.5`), with the existing `onScrollToIndexFailed` fallback;
   - remove the 80/200/400/700 ms timers.
5. **New messages and keyboard:**
   - a new last message keeps today's rule: follow it when at the bottom or when it's mine, otherwise count it for the jump button;
   - with an inverted list the bottom stays put as the content or keyboard changes. Remove the `onContentSizeChange`/`onLayout` re-pins if they're no longer needed, or keep them as `scrollToOffset(0)` while at the bottom, and say which you chose;
   - set `maintainVisibleContentPosition` so that someone reading older messages isn't moved when a new message arrives (for example `{ minIndexForVisible: 1 }`, plus `autoscrollToTopThreshold` only if it keeps the at-bottom rule).
6. **Older pages:** load through `onEndReached` (with `onEndReachedThreshold`) when `hasMore`, in place of the top-offset check.
7. **No tests** (UI). Keep every file at most 400 lines. Change only the list files.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-1, MUX-2, MUX-7, MUX-8), `work/T-1172-mobile-list-keep-position.md`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/jump-scroll.ts` and `apps/mobile/src/components/chat/message-list-row.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/jump-scroll.ts`, `apps/mobile/src/components/chat/message-list-row.tsx`, `apps/mobile/src/components/chat/jump-to-bottom.tsx`, `work/T-1276-mobile-inverted-list.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:**
  - opening Marta, and a long group topic, shows the bottom at once with no jump;
  - date pills and order read as before;
  - scrolling up shows the jump-to-bottom button, and it works;
  - sending a message keeps the bottom;
  - opening the keyboard keeps the last message visible;
  - a search hit and a pinned-message jump land on the message;
  - the unread divider shows on a chat with unread messages.

---

## Report (written by the worker when done)

### What I did
1. `apps/mobile/src/components/chat/message-list.tsx`
   - `data` is now `reversedEntries` (a memoised `[...entries].reverse()`), with `inverted`, so index 0 is the newest message and offset 0 is the bottom.
   - `initialNumToRender` is back to `20` (was `Math.max(entries.length, 1)`); `windowSize={11}` and `maxToRenderPerBatch={10}` kept.
   - The unread divider's reversed index is computed in one place: `reversedDividerIndex = entries.length - 1 - dividerIndex` (the divider is inserted at `dividerIndex` in `entries`), and that is what the hook's `scrollToIndex` uses.
   - `maintainVisibleContentPosition` is `{ minIndexForVisible: 1 }` (anchors the previous newest row) so a new message at index 0 does not move someone reading older messages.
   - `onScrollToIndexFailed` is unchanged: `info.index` is already a reversed index because every `scrollToIndex` now receives reversed indexes.
   - Jump-to-bottom uses `scrollToOffset({ offset: 0, animated: true })`.
   - `atBottom` is now `contentOffset.y < 40` (offset 0 is the bottom).
   - Older pages load through `onEndReached` (`onEndReachedThreshold={0.5}`, guarded by `hasMore`) instead of the top-offset check in `onScroll`.
   - Removed the `onContentSizeChange` and `onLayout` re-pins: with the inverted list the bottom is offset 0, so a growing draft or the keyboard changing the list's layout keeps the newest message visible (the audit predicted MUX-7 goes away with the inverted list).
2. `apps/mobile/src/components/chat/use-message-list-scroll.ts`
   - Every index here is an index into the reversed data: the search jump's `findIndex` and the pin jump's `findIndex` now run over the reversed `entries` prop, and `scrollToIndex` is called with those indexes.
   - The mount effect: no divider -> no scroll at all (the inverted list starts at the bottom); a divider -> one `scrollToIndex({ index: dividerIndex, viewPosition: 0.5, animated: false })`. The 80/200/400/700 ms timers are removed, and the `runLater`/`Fiber.interrupt` cleanup with them (the list's `onScrollToIndexFailed` still handles a divider that is not rendered yet).
   - The new-message effect now keys on `newestEntryKey` (index 0 of the reversed data) and scrolls with `scrollToOffset({ offset: 0, animated: true })`; the at-bottom (`atBottomRef.current`) or mine (`newestEntryOutgoing`) rule is unchanged.
   - Renamed the hook options `lastEntryKey`/`lastEntryOutgoing` to `newestEntryKey`/`newestEntryOutgoing` to match the reversed data.
3. `apps/mobile/src/components/chat/jump-to-bottom.tsx`: only the `atBottom` prop doc comment ("near the bottom" instead of "its end"). `jump-scroll.ts` and `message-list-row.tsx` needed no change.

### Files changed
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/jump-to-bottom.tsx` (comment only)
- `work/T-1276-mobile-inverted-list.md` (status + report)

### Commands and results
- `pnpm install`: done, 10.6s.
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files were run: the change is UI only, there are no `*.test.ts*` files under `apps/mobile/src/components/chat/`, and the spec says no tests (UI).

### Index conversions (each use, cited)
- **Unread divider index** — `message-list.tsx`: `reversedDividerIndex = dividerIndex === null ? null : entries.length - 1 - dividerIndex`, passed to the hook and used by the mount `scrollToIndex`.
- **Search jump `findIndex`** — `use-message-list-scroll.ts:108-111`, over `entries` (the reversed prop).
- **Pin jump `findIndex`** — `use-message-list-scroll.ts:125-127`, over `entries` (the reversed prop).
- **`onScrollToIndexFailed`** — `message-list.tsx:309-321`; `info.index` is already reversed because all `scrollToIndex` calls pass reversed indexes.
- **Jump-to-bottom** — `message-list.tsx:213`: `scrollToOffset({ offset: 0 })`.

### Deviations and notes
- I removed the `onContentSizeChange`/`onLayout` re-pins entirely (the spec offered "remove … or keep as `scrollToOffset(0)`"): with an inverted list the bottom is offset 0, so content growth and the keyboard no longer need a re-pin.
- I did not set `autoscrollToTopThreshold`: the explicit new-message effect already keeps the at-bottom rule (scroll to offset 0 when at the bottom or when the message is mine), and the spec said to add it "only if it keeps the at-bottom rule".
- Device checks (open Marta/a long group with no jump, date pills and order, jump-to-bottom, send keeps the bottom, keyboard keeps the last message, search and pin jumps, unread divider) are the lead's emulator checks; I could not run them.

### Fix round (lead's emulator bug: a sent message stayed below the fold)
The lead saw that at the bottom with the keyboard open, a sent message stayed just below the visible area and the jump button appeared. Cause: `maintainVisibleContentPosition` re-anchors the view when the row is inserted at index 0 (the inverted list's bottom), so it moved the offset off 0 *after* the new-message effect had already scrolled — the effect's `scrollToOffset(0)` lost the race.

What I changed:
- `message-list.tsx`: `maintainVisibleContentPosition` is now `{ minIndexForVisible: 1, autoscrollToTopThreshold: 40 }`. `autoscrollToTopThreshold` is the native mechanism for this ("automatically scroll to the top after making the adjustment if the user was within the threshold of the top before the adjustment was made"); in an inverted list the native top is the visual bottom (offset 0), so a new message follows while the user was at the bottom, and someone reading older messages (offset > 40) is still not moved.
- `use-message-list-scroll.ts`: the new-message effect sets a `followNewest` ref when it follows, and a new `handleContentSizeChange` (wired to the list's `onContentSizeChange`) re-runs `scrollToOffset(0)` once the inserted row has rendered, then clears the flag. This also covers "my message while scrolled up", where the native threshold does not apply. The flag is cleared on the first content-size change so an older page loading later never scrolls.
- My own message was already never counted as unseen: the count branch runs only when the user is not at the bottom *and* the new newest entry is not mine (`newestEntryOutgoing` is false there). The effect comment now says so explicitly.
- `onScroll` is now the hook's `handleScroll` (same `contentOffset.y < 40` rule), so the threshold lives next to the follow logic.

I chose `autoscrollToTopThreshold` over a plain delayed scroll because it lets the native adjustment itself land on offset 0, instead of racing a JS scroll against it; the `onContentSizeChange` re-pin is the belt for the case the native threshold cannot cover (my message while scrolled up).

Gate after the fix round:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (3.5s)
PASS  effect  (1.3s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round (prereview)

- **Finding 1 (must-fix) — fixed:** the mount divider scroll re-fired on every history/draft change because `reversedDividerIndex` was derived from the live `entries.length`. `message-list.tsx` now snapshots it once per chat open with a lazy `useState` initializer, next to the existing `dividerIndex` snapshot, so the value passed to the hook is stable and the mount `scrollToIndex` in `use-message-list-scroll.ts` runs once. The snapshot uses the same mount render as `dividerIndex`, so the divider's reversed position is exactly `entries.length - 1 - dividerIndex` at open.
- **Tests added:** none. Finding 1 names no test, spec point 7 says "No tests (UI)", AGENTS.md says UI code gets no tests, and the Allowed files list contains no test file (a new one would be outside scope and fail the gate's scope check). This is UI scroll behaviour, covered by the lead's emulator check.
- **Finding 2 (nit, `handleContentSizeChange` clearing `followNewest` on the first content-size change):** left untouched, per the fix-round rule to only change a nit inside a line already being changed.
- **Gate after the round:**
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Round (prereview 2)

- **Finding 1 (should-fix) — fixed.** `handleContentSizeChange` no longer clears `followNewest`; it re-pins on every content-size change while armed, so a stray size change before the inserted row renders cannot disarm the re-pin (failure scenario A) and the inserted row's own change still lands on offset 0.
- The flag is now disarmed only on a deliberate scroll away from the bottom, in `handleScroll`. Because the follow's own animated scroll emits scroll events with `contentOffset.y >= 40` on the way down, a bare `y >= threshold` check would disarm the follow the moment it started; the check therefore also requires the offset to be **growing** (`offset > lastOffset.current`). A fling back up mid-animation grows the offset, so it disarms the follow (failure scenario B) without cancelling the follow animation itself.
- A pending follow is also cancelled when a search jump takes over (`jumpTarget !== undefined`) and re-evaluated when `newestEntryKey` changes, so a follow cannot outlive the entry that armed it.
- Files changed: `apps/mobile/src/components/chat/use-message-list-scroll.ts` only.
- **Tests added:** none. Finding 1 names no test, spec point 7 says "No tests (UI)", AGENTS.md says UI code gets no tests, and the Allowed files list has no test file (a new one would be outside scope and fail the gate's scope check, and there are no `*.test.*` files under `apps/mobile/src/components/chat/`). This is emulator-checked scroll behaviour.
- **Nits left untouched:** nit 1 (`isOutgoingMessage` stale comment) and nit 2 (duplicated 40px threshold) are in lines this round does not otherwise change.

### Disagreements
None.

### Gate (prereview 2, final)
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (2.6s)
PASS  effect  (0.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 2 auto rounds and 1 lead round (2 nits).**
- **Lead round, found on the emulator:** my own sent message stayed below the view and the jump button appeared. Fixed by re-pinning to offset 0 after the insert.
- **Auto rounds:**
  - the divider index is snapshotted once per open, so new messages and drafts no longer re-scroll to the divider;
  - the follow flag isn't consumed by unrelated size changes.
- **Lead's checks on the emulator (mock build, final code):**
  - Marta and Dev AI open at the bottom with no jump (screenshots at 0.4 s and 2.5 s match);
  - scrolling up shows the jump button, and it returns to the bottom;
  - with the keyboard open the last message stays visible;
  - a sent message is followed ("Third check", before and after closing the keyboard);
  - in Dev team › General, a reply arriving while scrolled up doesn't move the view and is counted on the jump button.
  - **Not testable in the mock:** the unread-divider open, because the mobile mock seeds no unread topics.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `message-list.tsx` is at 351 lines.
