---
id: T-1204
title: "MUX-10: swiping a mobile chat row left reveals Pin/Unpin, Mute/Unmute and Archive/Unarchive buttons that call the existing chat-pref writes; long-press keeps the full sheet"
status: merged
milestone: M5
branch: task/T-1204-mobile-chat-swipe
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1204: Swipe actions on mobile chat rows

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-10 (P2, confirmed by code). Chat rows are plain `Pressable`s with `onLongPress`: `apps/mobile/src/components/chat/chat-rows.tsx:15-41`, rendered from `apps/mobile/src/components/chat/chat-list.tsx:86,124`. Every action hides behind the long press. In Telegram, swiping a row left shows archive, mute and pin.
- **The pref writes exist:** `useChatActions()` (`apps/mobile/src/components/chat/use-chat-actions.ts:23`) returns `saveChatPref(chatId, input)` (`:110-119`). It's created in `apps/mobile/src/app/(tabs)/index.tsx:67`, which renders `<ChatList` at `:198` and `<ChatActionsHost` at `:222`.
- **How the sheet calls them:** `apps/mobile/src/components/chat/chat-actions-host.tsx:39-60`:
  - mute: `{ mutedUntil: mutedUntilFor(duration, now) }`; unmute: `{ mutedUntil: null }`;
  - pin: `{ pinned: chat.pinnedAt === undefined }`;
  - archive: `{ archived: chat.archived !== true }`.
  - `MUTE_DURATIONS` and `mutedUntilFor` come from `apps/mobile/src/lib/chat-prefs.ts:21`.
- **Group rows:** a group row's prefs sit on its General topic chat (`use-chat-actions.ts:44-60`).
- **The pattern to copy:** the only `Swipeable` in the app is `apps/mobile/src/components/chat/swipe-to-reply.tsx:53`.

### What to build
1. **A new `apps/mobile/src/components/chat/chat-row-swipe.tsx`** (at most 150 lines): wrap a row in `ReanimatedSwipeable` (from `react-native-gesture-handler`, as `swipe-to-reply.tsx` does) with **right actions** (revealed by swiping left).
   - **Pin or Unpin** (`Pin` or `PinOff` icon);
   - **Mute or Unmute.** Mute uses the longest entry of `MUTE_DURATIONS` (or a "forever" one if it exists; check); unmute uses `null`;
   - **Archive or Unarchive.**
   - Each button is an icon over a short label, at least 64 px wide, with the app's colour tokens. Tapping one closes the swipe and calls the handler.
2. **`chat-rows.tsx` and `chat-list.tsx`:** pass an optional `onPref(chatId, input)` down to `ChatRow`, and wrap both the `chat` and the `group` row kinds.
   - For a group row, resolve the General topic chat the way `use-chat-actions.ts:50-60` does. If there's none, don't wrap that row.
   - Only one row may be open at a time: close the previous one when another opens.
3. **`(tabs)/index.tsx`:** pass `actions.saveChatPref` as `onPref`.
4. **Keep:** long-press opens the sheet as before, and a vertical scroll of the list still works (use the swipeable's default activation threshold).
5. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-10), `apps/mobile/src/components/chat/swipe-to-reply.tsx`, `apps/mobile/src/components/chat/chat-rows.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `apps/mobile/src/components/chat/chat-actions-host.tsx`, `apps/mobile/src/lib/chat-prefs.ts` and `apps/mobile/src/app/(tabs)/index.tsx:60-229`.

### Allowed files
`apps/mobile/src/components/chat/chat-row-swipe.tsx`, `apps/mobile/src/components/chat/chat-rows.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `work/T-1204-mobile-chat-swipe.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:** swipe the Julio row left, then Pin, and it pins (and moves to the top); swipe again, then Unpin; scrolling the list still works.

---

## Report (written by the worker when done)

### What I did
Swiping a mobile chat row left now reveals Pin/Unpin, Mute/Unmute and
Archive/Unarchive buttons that call the existing `saveChatPref` writes;
long-press still opens the full sheet.
- New `apps/mobile/src/components/chat/chat-row-swipe.tsx` (108 lines):
  `ChatRowSwipe` wraps a row in `ReanimatedSwipeable` (same import path as
  `swipe-to-reply.tsx`) with right actions. Each button is a lucide icon over
  a short label (`Pin`/`PinOff`, `Bell`/`BellOff`, `Archive`), `min-w-[64px]`,
  using the app's `bg-surface-raised` / `text-muted-foreground` tokens.
  Tapping a button closes the swipe first, then calls `onPref` with the same
  payloads the sheet uses (`pinned: chat.pinnedAt === undefined`,
  `mutedUntil: null` for unmute, `archived: chat.archived !== true`). Mute
  uses the `forever` entry of `MUTE_DURATIONS` (it exists today:
  `packages/chat-core/src/chat-prefs.ts:12-18`), falling back to `'week'`.
  Only one row stays open: the list owns a shared `openRef` and opening one
  row closes the previous.
- `chat-rows.tsx`: `ChatRow` takes optional `onPref` + `openSwipeRef` and
  wraps both row kinds. Chat rows wrap directly; group rows resolve the
  General topic via `topicsOfGroup` exactly like
  `use-chat-actions.ts:53-59` (General, else first topic; no topics means no
  wrap). Without `onPref` the row renders bare, so the search-results caller
  (`chat-search-results.tsx`) is untouched and keeps its current behavior.
- `chat-list.tsx`: owns the shared `openSwipeRef`, passes `onPref` (optional)
  to both the main list and the archived section rows.
- `(tabs)/index.tsx`: passes `actions.saveChatPref` as `onPref`.
- No tests (UI, per spec). No new dependencies.

### Files changed
- `apps/mobile/src/components/chat/chat-row-swipe.tsx` (new, 108 lines)
- `apps/mobile/src/components/chat/chat-rows.tsx` (107 lines)
- `apps/mobile/src/components/chat/chat-list.tsx` (149 lines)
- `apps/mobile/src/app/(tabs)/index.tsx` (230 lines, +1)
- `work/T-1204-mobile-chat-swipe.md` (this file)

### Commands and real results
- `pnpm install`: done, 1180 packages, one peer warning
  (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm exec prettier --write apps/mobile/src/components/chat/chat-rows.tsx`:
  fixed the one format fail from the first gate run (long JSX line).
- `pnpm gate` (final): `PASS install (0.9s)`, `PASS format`, `PASS lint`,
  `PASS typecheck (3.2s)`, `PASS effect`, `SKIP tests @zilar/mobile (no
  nearby test files)`, `scope: every changed file is inside the Allowed
  files`, `migration: ...`, `GATE PASS`. Per instructions I ran no other
  checks one by one; no single test files exist near this UI change.

### Notes / deviations
- The spec's payload for pin (`pinned: chat.pinnedAt === undefined`) is
  mirrored exactly, even though it derives the toggle from the store row
  shown; same for archive. Matches the sheet, so the two paths cannot drift.
- Default swipeable thresholds kept, so vertical list scroll is unaffected.
- Not verified on a device: I ran the gate only. The lead's emulator check
  (swipe Julio row left, Pin/Unpin) is still needed.

### Round 2 (fix round)
- Finding 1 (must-fix, group-row fallback): dropped the `?? topics[0]`
  fallback in `GroupRow` (`chat-rows.tsx`), so a group with no General topic
  renders unwrapped — matching the long-press sheet (`use-chat-actions.ts`),
  which leaves pref rows disabled when General is absent. Updated the two
  adjacent comments that said "no topics" to "no General topic". No test
  added: the spec (§5 "No tests (UI)") and AGENTS.md ("UI code gets no
  tests") both forbid tests here, and the finding names no exact test.
- Findings 2–3 (nits in `chat-row-swipe.tsx`): left untouched per
  instructions (nits only if in a changed line; neither line was changed).
- Disagreements: none.
- Gate result: `pnpm gate` → GATE PASS (`PASS install (frozen) (1.8s)`,
  `PASS format`, `PASS lint`, `PASS typecheck (3.4s)`, `PASS effect`,
  `SKIP tests @zilar/mobile (no nearby test files)`,
  `scope: every changed file is inside the Allowed files`). No single tests
  run (spec §5: no tests for this UI change).

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The new `chat-row-swipe.tsx`** (108 lines): `ReanimatedSwipeable` right actions, Pin or Unpin, Mute or Unmute and Archive or Unarchive, through `saveChatPref`.
- **Rows:** chat and group rows are wrapped (the group row through its General topic), one row open at a time. Long-press is unchanged.
- **The follow-up:** a failed swipe write is silent, because `actionError` only shows inside the long-press sheet. That's a later polish.
- **Still to do:** the emulator check with the next APK (swipe the Julio row, Pin and Unpin, scrolling).
