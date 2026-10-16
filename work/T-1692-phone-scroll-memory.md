---
id: T-1692
title: "Phone per-chat scroll memory (parity gap 7, first half): reopening a chat with no unread messages lands where the reader left it in this session, like web's WUX-28 useScrollMemory — saved in memory per chat, restored only when no newer message arrived since"
status: merged
milestone: M5
branch: task/T-1692-phone-scroll-memory
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1692: The phone remembers where you left each chat

## Spec (written by Claude, do not edit)

### Why
On web, reopening a chat lands on the message you were reading (WUX-28, `apps/web/src/components/useScrollMemory.ts`). On the phone it always opens at the bottom, or at the unread divider (`docs/audit/parity-2026-10-16.md`, gap 7: "reopening a chat restores the last read position").

### Facts (the lead read them on 2026-10-16)
- **Web** (`apps/web/src/components/useScrollMemory.ts`, 143 lines):
  - the anchor is kept in a module-level `Map` (`const anchors = new Map<string, ScrollAnchor>()`, `:14`), "in memory only (no storage)", so it survives a chat remount and clears on a full reload;
  - it's disabled for a chat with unread messages, which keeps the divider (`enabled` false);
  - a pending jump (search, pin, quote) wins over the restore.
- **Phone** (`apps/mobile/src/components/chat/use-message-list-scroll.ts`, 193 lines):
  - the list is **inverted**: index 0 is the newest message and offset 0 is the bottom (`:26-31`);
  - `useMessageListScroll({ chatId, dividerIndex, jumpTarget, jumpToMessageId, entries, newestEntryKey, newestEntryOutgoing, clearJumpTarget, onJumped })` (`:34-44`);
  - refs `atBottomRef`, `followNewest` and `lastOffset` (the last scroll offset, `:58-60`), and `setAtBottom` (`:69-78`);
  - `handleScroll` updates `lastOffset.current` (`:85-99`);
  - `handleContentSizeChange` re-pins only while `followNewest` is armed (`:107-112`);
  - the mount effect scrolls to the divider when `dividerIndex !== null` and there's no `jumpTarget` (`:119-124`);
  - the pin jump runs when `jumpToMessageId` is set (`:161-178`);
  - it returns `{ listRef, atBottom, unseenCount, handleScroll, handleContentSizeChange }`.
- **The caller** is `apps/mobile/src/components/chat/message-list.tsx:210-221`:
  - it passes `dividerIndex: reversedDividerIndex`, which is `null` when the chat had no unread messages at open (`:169-170`, `:208`);
  - `newestEntryKey: reversedEntries[0]?.key`;
  - the FlatList takes `onContentSizeChange={handleContentSizeChange}` and `onScroll={handleScroll}` (`:350-351`).

### Steps (all in `use-message-list-scroll.ts`)
1. **Add a module-level `const savedScroll = new Map<string, { offset: number; newestKey: string | undefined }>()`** with a short comment (session memory only, like web's WUX-28 anchors).
2. **Save:** an effect keyed on `chatId` whose cleanup records the chat's spot:
   - if `lastOffset.current >= AT_BOTTOM_THRESHOLD`, set `savedScroll` for that chat to `{ offset: lastOffset.current, newestKey: previousNewestKey.current }`;
   - otherwise delete the entry, since the bottom is the default.
3. **Restore:** a ref `restorePending`, computed once at mount. It's true only when:
   - `dividerIndex === null`;
   - `jumpTarget === undefined` and `jumpToMessageId === undefined`;
   - a saved entry exists whose `newestKey === newestEntryKey` (no newer message since; if one arrived, the chat opens at the bottom as today).

   At the start of `handleContentSizeChange`, when `restorePending` is true, clear it, call `listRef.current?.scrollToOffset({ offset: saved.offset, animated: false })` and `setAtBottom(false)`, then return. Leave the rest of the function unchanged.
4. **Keep the file under 400 lines. No tests** (UI behaviour).

### Allowed files
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `work/T-1692-phone-scroll-memory.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Restore:** with a read chat, scroll up and go back to the chat list; reopening the chat shows the same spot, with the jump-to-bottom button showing.
- **The bottom stays the default:** a chat left at the bottom reopens at the bottom.
- **Fall-backs:**
  - a chat with unread messages still opens at the divider;
  - a chat that got a newer message since opens at the bottom;
  - a search or pin jump still wins.

---

## Report (written by the worker when done)

### What I did
Implemented per-chat scroll memory on the phone, mirroring web's WUX-28 `useScrollMemory`, in `apps/mobile/src/components/chat/use-message-list-scroll.ts`:
1. Added a module-level `savedScroll` `Map<string, { offset: number; newestKey: string | undefined }>` (session memory only, like web's anchors).
2. Added an effect keyed on `chatId` whose cleanup records the spot: when `lastOffset.current >= AT_BOTTOM_THRESHOLD` it stores `{ offset, newestKey: previousNewestKey.current }`, otherwise it deletes the entry (the bottom is the default).
3. Added a `restorePending` ref computed once at mount, true only when the chat has a saved entry whose `newestKey === newestEntryKey`, `dividerIndex === null`, and no `jumpTarget`/`jumpToMessageId`.
4. At the start of `handleContentSizeChange`, when `restorePending` is true it clears the flag, calls `scrollToOffset({ offset: saved.offset, animated: false })` and `setAtBottom(false)`, then returns. The rest of the function is unchanged.

Files changed:
- `apps/mobile/src/components/chat/use-message-list-scroll.ts` (233 lines, under the 400-line cap)
- `work/T-1692-phone-scroll-memory.md` (status + Report)

No tests written: UI behaviour, and the spec says "No tests". No dependencies added, no files outside Allowed files touched.

### Checks run
- `pnpm install` from repo root: done (39.5s), 1 deprecated subdep warning (`uuid@7.0.3`), pre-existing peer warning in `apps/mobile` (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18) — both unrelated to this change.
- `pnpm gate` from repo root: ended with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (8.9s)
  PASS  format  (2.8s)
  PASS  lint  (7.0s)
  PASS  typecheck  (18.4s)
  PASS  effect  (3.3s)
  PASS  tests @zilar/mobile  (16.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run separately: the change is UI-only with no test file to target, and the gate ran the `@zilar/mobile` tests once.

Acceptance behaviour is not verifiable from here (no simulator); the restore and each fall-back (unread divider, newer message, search/pin jump) follow directly from the guards in `restorePending` and the existing `dividerIndex`/`jumpTarget` effects. Requires the lead's phone smoke.

### Notes for the lead
- `restorePending` is computed once at mount by reading `newestEntryKey`; if the list's first render has no entries (so `newestEntryKey` is `undefined`) a pending restore will not arm. In practice the divider-less mount already has entries.
- The saved entry is read via `savedScroll.get(chatId)` at restore time rather than captured at mount; only this chat's unmount cleanup can change it, so the values are the same.

### Fix round 1
1. **Restore no longer lands short.** `handleContentSizeChange` now takes the FlatList's `(width, height)` and, while `restorePending` is true, re-requests `saved.offset` on every content-size change (updating a new `requestedOffset` ref), clearing `restorePending` only once `height >= saved.offset` so a clamped early scroll is retried as rows render.
2. **A newer message disarms the restore.** The existing newest-entry effect sets `restorePending.current = false` in its `newestEntryKey !== previousNewestKey.current` branch, so a message arriving during the restore window leaves the chat at the bottom and does not fight the follow.
3. **Comment updated** above `handleContentSizeChange` to say the restore repeats until the content covers the saved offset.
- Deviation from the fix note, item 1: the reader-scroll check in `handleScroll` disarms on `offset > requestedOffset.current + AT_BOTTOM_THRESHOLD` rather than on `Math.abs(offset - requestedOffset.current) > AT_BOTTOM_THRESHOLD`. The list clamps our own restore scroll when the content is still shorter than the saved offset, and that clamped landing can differ from the requested offset by more than the threshold, so the symmetric check would disarm the restore on its own scroll and re-introduce the bug. Comparing only a jump past the requested offset keeps the intent ("an offset change our own restore didn't cause") without that false positive. A reader who scrolls *down* during the short restore window is not detected; the window ends as soon as the content covers the spot.

### Checks run (fix round 1)
- `pnpm gate` from repo root: ended with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (8.5s)
  PASS  format  (5.5s)
  PASS  lint  (5.2s)
  PASS  typecheck  (16.4s)
  PASS  effect  (4.8s)
  PASS  tests @zilar/mobile  (16.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run separately (UI-only change, no test file to target).

### Fix round 2
1. **The restore now always ends.** Added a `lastRestoreHeight` ref (starts 0) and a `restoreChanges` counter (`MAX_RESTORE_CHANGES = 10`). In the restore branch of `handleContentSizeChange`, after `scrollToOffset` the restore clears `restorePending` when `height >= saved.offset`, or `height <= lastRestoreHeight.current` (the list stopped growing, so it drew all it will), or the counter reaches the cap; otherwise it stores the new height. A chat whose content never covers the saved offset no longer stays armed and can no longer pull the reader back up.
2. **A leave without scrolling keeps the spot.** Added a `scrolledSinceMount` ref, set at the top of `handleScroll`. The unmount cleanup returns early while it is still false, so reopening a chat and leaving before any scroll no longer deletes the saved spot.
3. **Comment updated** above `handleContentSizeChange` to name both ends of the restore (the content covers the spot, or the list stops growing / 10 changes have passed).

### Checks run (fix round 2)
- `pnpm gate` from repo root: ended with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (6.7s)
  PASS  format  (3.0s)
  PASS  lint  (7.2s)
  PASS  typecheck  (26.3s)
  PASS  effect  (5.2s)
  PASS  tests @zilar/mobile  (15.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run separately (UI-only change, no test file to target).

### Fix round 3 (pre-review findings)

1. **Finding 1 (must-fix): the restore no longer ends a viewport short.** The end
   condition `height >= saved.offset` ignored that a list only reaches
   `height - viewportHeight`, so a long chat cleared `restorePending` while the
   scroll was still clamped short. Added a `viewportHeight` ref filled from
   `handleScroll`'s `layoutMeasurement.height`, and the restore now ends only when
   `height - viewportHeight >= saved.offset`. While no viewport has been measured
   yet the reachable offset is unknown (kept at `-1`), so the restore waits rather
   than ending early on a bare height. The stopped-growing and 10-change backstops
   are unchanged, and the comment above `handleContentSizeChange` names the
   viewport end.
2. **Finding 2 (should-fix): leaving mid-restore keeps the good spot.** The
   unmount save now returns early while `restorePending.current` is still true, so
   the clamped intermediate offset the restore's own scroll left behind is not
   written over the saved entry (and the entry is not deleted when the clamp lands
   near the bottom).
3. **Nit 3 (not fixed).** The takeover check still only disarms on a scroll past
   the requested offset; a reader scrolling down during the short restore window is
   not detected. This is spec-silent and was already disclosed in fix round 1, and
   the two fixes above do not touch that line, so it is left as is.

Tests: none added. The spec says "No tests (UI behaviour)", AGENTS.md says UI code
gets no tests, the findings name no test, and the only Allowed files are the hook
and this task file — a test file would be outside the Allowed files. `pnpm gate`
ran the nearest suite, `tests @zilar/mobile`, as usual.

### Checks run (fix round 3)
- `pnpm gate` from repo root: ended with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (16.1s)
  PASS  format  (6.8s)
  PASS  lint  (6.2s)
  PASS  typecheck  (35.0s)
  PASS  effect  (6.0s)
  PASS  tests @zilar/mobile  (18.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run separately (UI-only change, no test file to target).
- Commits this round: finding 1 `18e19d0a0`, finding 2 `ef53b341b`.

### Disagreements

None: both pre-review findings were fixed as described.

## Review (written by Claude)

**Approved and merged.** This is parity gap 7, first half.

- **Rounds:** three fix rounds, two from the lead and one automatic.
  - **The lead's first spec was wrong:** it restored once, on the first content-size change, and a FlatList draws only its first batch then.
  - **The lead's round-1 fix was also wrong:** it ended the restore at `height >= offset`, ignoring the viewport. The pre-review caught that; the automatic round fixed it.
- **Final logic:** the restore repeats until the reachable offset (`height − viewport`) covers the saved spot, the list stops growing, or 10 changes pass. A reader's own scroll, or a newer message, ends it early. A visit without any scroll, or one left mid-restore, keeps the saved spot.
- **Emulator check (mock build of this branch, Pixel 7, API 36), the smoke passed (`/`, `/ais`, `/ais/ai-dev-1`):**
  - in Dev-1, scrolled up, went back and reopened: it lands on the same messages (within about 30 px), with the jump-to-bottom button showing;
  - jumped to the bottom, went back and reopened: it opens at the bottom with no jump button.
- **Not checked live:** the divider and jump fall-backs; they follow from code reading only (`restorePending` is false when `dividerIndex !== null` or a jump is pending).
- **The same build also confirmed T-1677:**
  - New message lists the contacts with "Search contacts" and the Invite footer;
  - "mar" filters to Marta, Marco and Marketing AI.


