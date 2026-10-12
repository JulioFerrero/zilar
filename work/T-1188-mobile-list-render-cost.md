---
id: T-1188
title: "PERF-2 (first step): the mobile message row is memoised and renderItem is stable, with windowSize/maxToRenderPerBatch set, so a typing or AI-draft tick no longer re-renders every loaded row; initialNumToRender and the mount scroll stay as they are"
status: merged
milestone: M5
branch: task/T-1188-mobile-list-render-cost
model: auto
effort: default
depends_on: [T-1172]
estimate: 0.2 day
---

# T-1188: Cheaper mobile list renders

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md` PERF-2 (P1, mobile, confirmed).
- **The row isn't memoised:** `MessageListRow` (`apps/mobile/src/components/chat/message-list-row.tsx:52`) is a plain function; only `MessageBubble` is `memo`.
- **`renderItem` is an inline arrow** (`apps/mobile/src/components/chat/message-list.tsx:266`) that passes about 20 props.
- **So every store tick re-runs every row:** typing, presence, or an AI draft frame every 150 ms. After 200 loaded messages, each draft frame re-renders about 200 rows.
- **No `windowSize` or `maxToRenderPerBatch`** is set.
- **`initialNumToRender` stays as it is** (`Math.max(entries.length, 1)`): the mount scroll (`use-message-list-scroll.ts`) relies on every row being rendered. Changing it is part of the inverted-list task (MUX-2), not this one.

### What to build
1. **Wrap `MessageListRow` in `memo`.** Make sure every prop the list passes is stable between ticks that don't change that row: callbacks wrapped in `useCallback` in `message-list.tsx`, or hoisted; objects memoised. Check each of the props, and list them in the Report with how each is stable.
2. **Make `renderItem` a `useCallback`** with the right dependencies.
3. **Set `windowSize={11}` and `maxToRenderPerBatch={10}`** on the `FlatList`. Don't add `removeClippedSubviews`: it breaks `maintainVisibleContentPosition` on Android.
4. **Don't touch** `initialNumToRender`, the scroll hooks or `maintainVisibleContentPosition` (T-1172).
5. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (PERF-2), `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list-row.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:370-390` and `apps/mobile/src/components/chat/use-message-list-scroll.ts`.

### Allowed files
`apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list-row.tsx`, `work/T-1188-mobile-list-render-cost.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:** a long chat opens at the bottom, scrolls, and an AI reply still streams.

---

## Report (written by the worker when done)

### What I did
1. `apps/mobile/src/components/chat/message-list-row.tsx`
   - `MessageListRow` is now `memo(MessageListRowImpl, areRowPropsEqual)`. `areRowPropsEqual` compares `item` with `isSameEntry` (by `key`/`type` and, for a message entry, `item.message` reference plus `firstInGroup`, `lastInGroup`, `isDraft`, `revealTurnId`; a separator by its date; a divider always equal) and every other prop by identity.
   - I used a comparator, not the default shallow compare, because `item` cannot be referentially stable: `renderItem` runs `groupMessages` on every list rebuild and `groupMessages` creates a new `MessageItem` (and the list a new `ListEntry`) for every row on each rebuild, so a default compare would re-render every row on each draft frame. The comparator compares the `item` fields the row actually renders.
2. `apps/mobile/src/components/chat/message-list.tsx`
   - `renderItem` is now a `useCallback` (deps: `chat`, `currentUserId`, `canPinChat`, `pinnedIds`, `openingAttachmentId`, `voiceHost`, `selection`, `onReply`, and the `stable*` handlers), so the `FlatList` is not handed a new function on every list re-render.
   - Added `windowSize={11}` and `maxToRenderPerBatch={10}` to the `FlatList`.
   - Untouched, as the spec asks: `initialNumToRender` (`Math.max(entries.length, 1)`), `maintainVisibleContentPosition`, the scroll hooks and `keyExtractor`. No `removeClippedSubviews`.

### Prop stability (each prop the list passes to `MessageListRow`)
- `item` — rebuilt by `groupMessages` on every rebuild (draft frame ~150 ms), so **not** referentially stable; compared field by field in `isSameEntry`.
- `chat` — prop from `ChatThread`; a draft frame re-renders `MessageList` from its own store subscription (`drafts[chat.id]`), not `ChatThread`, so the object reference is stable (identity compare).
- `currentUserId` (string), `canPinChat` (boolean), `openingAttachmentId` (string | undefined) — scalars; compared by value.
- `pinnedIds` — memoised in `use-chat-screen` on `pins` (`pinnedIds = useMemo(() => pins.map(...), [pins])`), so the reference is stable unless the pins change (identity compare).
- `voiceHost` — the stable value from `useVoicePlayerHost()` in `ChatThread`, which does not re-render on a draft frame (identity compare).
- `selection` — built fresh by `use-chat-screen` on each screen render, but the chat screen does not subscribe to `drafts`, so a draft frame does not re-render it; stable across the ticks this task targets (identity compare).
- `onReply` — `stableReply ?? onReply`; `onReply` is required so `stableReply` (from `useStableHandler`) is always defined and stable.
- `onReact` — `useStableReact`; stable.
- `onEdit`, `onDelete`, `onForward`, `onPin`, `onUnpin`, `onRetrySticker`, `onRetryAttachment`, `onCancelAttachment`, `onRetryVoice`, `onCancelVoice`, `onOpenAttachment`, `onToggleSelect`, `onStartSelect` — all `useStableHandler` values; stable.

`renderItem` itself is stable across a draft frame because all of its dependencies hold their reference: the only per-tick input, `entries`, is consumed through `item` inside the row, not read in `renderItem`.

### Files changed
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `work/T-1188-mobile-list-render-cost.md` (status only)

### Commands and results
- `pnpm install`: done in 13.4 s; only the pre-existing `@types/react-dom` peer warning in `apps/mobile`.
- `pnpm gate` (repo root), summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test files were run: the change is UI only, the chat components have no test files and the spec says no tests. An earlier `pnpm gate` run failed lint: my first attempt reused the previous `ListEntry` objects through a `useRef` read/written inside `useMemo`, and oxlint's `react(refs)` rule rejected the ref access during render. I removed that approach and used the memo comparator instead.

### Deviations and notes
- **Deviation from the spec's wording:** item 1 says to make every prop stable and memoise objects. `item` cannot be made referentially stable without either changing the grouping in `groupMessages` (outside the Allowed files) or reusing entry objects via a ref during render (rejected by the lint rule, above). So `MessageListRow` is wrapped in `memo` with an explicit comparator that compares `item` by the fields the row renders; every other prop is still compared by identity and is stable, as listed above. This keeps the spec's intent (a draft tick re-renders only the draft row, not every loaded row) and its "wrap in `memo`" step.
- No change to `initialNumToRender`, the scroll hooks or `maintainVisibleContentPosition` (T-1172).
- The emulator acceptance check (a long chat opens at the bottom, scrolls, and an AI reply still streams) is the lead's; I could not run it.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **`MessageListRow`** is `memo` with `areRowPropsEqual`. `isSameEntry` compares the message object identity, which the store replaces on every change, plus the group flags, the draft and reveal fields. Every other prop is compared by reference.
- **The list:**
  - stable handlers (`useCallback` and `useStableHandler`) and a `useCallback` `renderItem`;
  - `windowSize={11}` and `maxToRenderPerBatch={10}`;
  - `initialNumToRender` and the scroll hooks are unchanged.
- **Watch item:** a non-message entry (a separator, or any future divider) returns equal unless its key changes. A new entry type with changing fields needs a case.
- **Still to do:** the emulator check with the next APK (a long chat opens at the bottom, scrolling, and an AI stream).
