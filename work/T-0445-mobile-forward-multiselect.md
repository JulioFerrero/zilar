---
id: T-0445
title: "Forwarding (mobile): Select in the message sheet starts select mode; tap messages to check them; a bar forwards them together"
status: merged
milestone: M5
branch: task/T-0445-mobile-forward-multiselect
model: auto
effort: low
depends_on: [T-0435, T-0439]
estimate: 0.5 day
---

# T-0445: forward several messages (mobile)

## Spec (written by Claude, do not edit)

### Why
This is the mobile twin of web T-0439 (`docs/audit/forwarding-plan.md` §4 T-E, §5 question 7). Mobile already forwards one message: T-0435 added `ForwardSheet`, which takes `messages: UiMessage[]`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/message-actions-sheet.tsx`:**
  - props at lines 11-36 (`canForward?` at line 17, `onForward?` at line 27);
  - the Forward row is `<ActionSheetItem label="Forward" accessibilityLabel="Forward message" onPress={onForward ?? (() => {})} icon={Forward} />` at lines 102-108, shown when `canForward === true`;
  - icons are imported from `lucide-react-native` at line 3.
- **`apps/mobile/src/components/chat/message-bubble.tsx`:**
  - `onForward?` prop at line 210, with the function at line 235;
  - `canForward` is computed at lines 287-290;
  - a deleted message returns the tombstone early (lines 354-387), with no actions;
  - the normal row is `<SwipeToReply …><View className="flex-row px-2 …">…</View></SwipeToReply>` from line 390;
  - the menu opens through `openMenu` on long-press of several inner `Pressable`s (for example lines 425, 451 and 456);
  - `MessageActionsSheet` is rendered at lines 648-698, and its `onForward` closes the menu, then calls `onForward?.(message)` (lines 673-676).
- **`apps/mobile/src/components/chat/message-list.tsx`:** `onForward?` at line 41 and `MessageList` at line 71; `renderItem` renders `<MessageBubble …>` at lines 316-340, passing `onForward` at line 326.
- **`apps/mobile/src/app/chat/[id].tsx`:**
  - `chatId` at line 54 and `const [forwarding, setForwarding] = useState<UiMessage[] | null>(null)` at line 174;
  - it has **three** render branches, each with `<MessageList … onForward={(message) => setForwarding([message])} …>` at lines 518, 678 and 892;
  - each has a composer block below the list:
    - the first branch: `legacyComposer ? <Composer …> : <ChannelComposerBar …>`, from line 553;
    - the second branch: the channel bar or the composer, from about line 713;
    - the third branch: `<Composer …>`, from line 927;
  - each renders `<ForwardSheet messages={forwarding} …>` (lines 622-624, 782-784 and 1021-1023);
  - the ordered messages of the chat are the store's `messagesByChat[chatId]` (line 84, `loadedMessages`).
- **Kit:**
  - `Checkbox({ checked, disabled? })` (`apps/mobile/src/components/ui/checkbox.tsx`) only draws the box; the row owns the press and the `checkbox` accessibility role;
  - `Button` is `components/ui/button.tsx`;
  - `Text` is `components/ui/text.tsx`. **Every label goes inside `<Text>`.**
- **Tests:** there is no screen test for `[id].tsx`. Component tests live next to the components (`message-actions-sheet.test.tsx`, `message-list.test.tsx`, `forward-sheet.test.tsx`).

### What to build
1. **New `apps/mobile/src/lib/selection.ts`** (pure):
   - `toggleSelected(ids: readonly string[], id: string): string[]` adds or removes the id;
   - `selectedInOrder<T extends { id: string }>(messages: readonly T[], ids: readonly string[]): T[]` returns the messages in chat order, keeping only the selected ones.

   Test both in `lib/selection.test.ts`, including the case where selection order differs from chat order.
2. **`MessageActionsSheet`:** a new optional `onSelect?: () => void` and a row `<ActionSheetItem label="Select" accessibilityLabel="Select messages" onPress={onSelect} icon={ListChecks} />` right after Forward. It is shown only when `canForward === true && onSelect !== undefined`.
3. **`MessageBubble`:** new optional props:
   - `selecting?: boolean`;
   - `selected?: boolean`;
   - `onToggleSelect?: (message: UiMessage) => void`;
   - `onStartSelect?: (message: UiMessage) => void`.

   Behaviour:
   - **The sheet's Select** closes the menu, then calls `onStartSelect?.(message)`. Pass `onSelect` only when `onStartSelect` is set.
   - **While `selecting`,** the normal row shows `<Checkbox checked={selected === true} disabled={!canForward} />` before the bubble content. A transparent `Pressable` covers the whole row (absolute fill), with:
     - `accessibilityRole="checkbox"`;
     - `accessibilityState={{ checked: selected === true, disabled: !canForward }}`;
     - `accessibilityLabel="Select message"`;
     - `onPress`, which calls `onToggleSelect?.(message)` when `canForward`.

     The cover keeps inner taps and long-presses (menu, links, attachments) from firing.
   - The tombstone is unchanged: no checkbox.
4. **`MessageList`:** an optional `selection?: { ids: readonly string[]; onToggle: (message: UiMessage) => void; onStart: (message: UiMessage) => void }`. It passes each bubble:
   - `selecting={selection !== undefined && selection.ids.length > 0}`;
   - `selected`;
   - `onToggleSelect`;
   - `onStartSelect`.
5. **New `apps/mobile/src/components/chat/selection-bar.tsx`:** `SelectionBar({ count, onForward, onCancel })`.
   - A bar in the composer's place: "{count} selected" in `<Text>`, with `accessibilityLiveRegion="polite"`.
   - A ghost `Button` "Cancel", and a `Button` "Forward" (Forward icon) that is disabled when `count === 0`.
   - Android back calls `onCancel` while the bar is mounted: `BackHandler.addEventListener('hardwareBackPress', …)` returns true and is removed on unmount.

   Test it in `selection-bar.test.tsx`: the count text, Forward disabled at 0, Cancel, and Forward calling `onForward`.
6. **`[id].tsx`:**
   - `const [selectedIds, setSelectedIds] = useState<string[]>([])`, reset to `[]` when `chatId` changes (in an effect on `chatId`, like the existing ones);
   - `const selection = { ids: selectedIds, onToggle: (m) => setSelectedIds((ids) => toggleSelected(ids, m.id)), onStart: (m) => setSelectedIds([m.id]) }`, passed to all three `MessageList`s;
   - **in each branch,** while `selectedIds.length > 0`, render `<SelectionBar count=… onCancel={() => setSelectedIds([])} onForward=… />` **instead of** that branch's composer block (composer or channel bar);
   - Forward calls `setForwarding(selectedInOrder(loadedMessages ?? [], selectedIds))` and then `setSelectedIds([])`.
7. **Tests:**
   - `message-actions-sheet.test.tsx`: Select is shown only with `canForward` and `onSelect`, and calls it;
   - `message-list.test.tsx`: with a `selection` that has one id, the bubbles render the "Select message" checkboxes, and pressing one calls `onToggle` with that message;
   - fix the setup of other bubble tests only if the new props break them.

### Read first
`AGENTS.md`, `work/T-0439-web-forward-multiselect.md` (the web behaviour to mirror), `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:200-300`, `:350-400` and `:640-699`, `apps/mobile/src/components/chat/message-list.tsx:30-90` and `:300-346`, `apps/mobile/src/app/chat/[id].tsx:50-110`, `:170-180`, `:270-300`, `:510-630`, `:670-790` and `:880-1034`, `apps/mobile/src/components/chat/forward-sheet.tsx`, `apps/mobile/src/components/ui/checkbox.tsx`, `apps/mobile/src/components/ui/button.tsx`.

### Allowed files
`apps/mobile/src/lib/selection.ts`, `apps/mobile/src/lib/selection.test.ts`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx`, `apps/mobile/src/components/chat/selection-bar.tsx`, `apps/mobile/src/components/chat/selection-bar.test.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0445-mobile-forward-multiselect.md`.

Setup fixes only: `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot selection message-actions-sheet message-list message-bubble
pnpm gate
```

### Acceptance
- Select in the message sheet starts select mode in all three chat screen branches. Tapping messages checks and unchecks them.
- The bar replaces the composer, and Forward opens the forward sheet with the messages in chat order.
- Cancel, Android back and a chat switch leave select mode.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Implemented multi-select forwarding on mobile (T-0445, the twin of web T-0439). The message sheet's **Select** row enters select mode with that message checked. While selecting, every normal bubble shows a kit `Checkbox` and a transparent whole-row `Pressable` (`checkbox` role, "Select message") that toggles it and swallows the inner tap/long-press; tombstones stay unchanged. A new `SelectionBar` replaces the composer ("N selected", ghost Cancel, Forward disabled at 0, Android back cancels). **Forward** opens the existing `ForwardSheet` with the checked messages in chat order. Cancel, Android back and a chat switch leave select mode.

### Files changed (all inside Allowed files)
- `apps/mobile/src/lib/selection.ts` (new) — `toggleSelected`, `selectedInOrder`.
- `apps/mobile/src/lib/selection.test.ts` (new) — add/remove, no mutation, chat-order with an out-of-order pick, unknown ids.
- `apps/mobile/src/components/chat/message-actions-sheet.tsx` — optional `onSelect` and a `Select` row (`ListChecks`) after Forward, shown only when `canForward === true && onSelect !== undefined`.
- `apps/mobile/src/components/chat/message-actions-sheet.test.tsx` — `ListChecks` in the icon mock; Select shown/called with `canForward` + `onSelect`, hidden otherwise.
- `apps/mobile/src/components/chat/message-bubble.tsx` — new `selecting`/`selected`/`onToggleSelect`/`onStartSelect` props; the row is `relative`, renders the `Checkbox` before the bubble content and the absolute transparent `Pressable` cover; the sheet gets `onSelect` only when `onStartSelect` is set (closes the menu then starts).
- `apps/mobile/src/components/chat/message-list.tsx` — optional `selection` controller; maps it to each bubble (`selecting`, `selected`, `onToggleSelect`, `onStartSelect`).
- `apps/mobile/src/components/chat/selection-bar.tsx` (new) — the bar, with the `BackHandler` effect.
- `apps/mobile/src/components/chat/selection-bar.test.tsx` (new) — count text + live region, Forward disabled at 0 / enabled at 1, Cancel, Forward.
- `apps/mobile/src/app/chat/[id].tsx` — `selectedIds` state, reset effect on `chatId`, `selection` + `forwardSelected` handlers, `selection` on all three `MessageList`s, `SelectionBar` instead of each branch's composer block.
- `apps/mobile/src/components/chat/message-list.test.tsx` — Node render of the real list/bubbles with a `FlatList` stub and a `Pressable` stub that records props: two "Select message" checkboxes with one checked, pressing the checked one calls `onToggle` with `m1`, plus no checkboxes without a selection.
- `work/T-0445-mobile-forward-multiselect.md` — status/report.

I did **not** need to touch `message-bubble-layout.test.tsx`, `message-bubble-stickers.test.tsx` or `message-bubble-ticks.test.tsx`; the new props are optional and they still pass.

### Commands run (real results)
- `pnpm install` — done, 1170 packages added, exit 0 (peer warning only).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot selection message-actions-sheet message-list message-bubble` — **7 files passed, 36 tests passed**.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (17.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (7.1s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
- **`MessageList` receives `selection` always** (as item 6 says), not `undefined` while idle; `selecting` is `selection.ids.length > 0`, so the empty case behaves like the old list.
- **The checkbox sits before the avatar column** for incoming group bubbles (still "before the bubble content") and is vertically centered; outgoing rows stay right-aligned.
- **`message-list.test.tsx` renders the real list and bubbles** with a `FlatList` stub plus a `Pressable` stub that records its props on `globalThis`. Mobile has no React Native testing library, so this follows the repo's Node `react-dom/server` render pattern; the string labels/roles are asserted from the recorded props. This is why the file mocks the bubble's children (`react-native-svg`, cards, etc.).
- `SelectionBar` uses the composer's `px-2 pt-1.5` + safe-area padding so it sits in the composer's place.

### Blocked / needs a decision
None.

**status: review**

## Review (written by Claude)

Approved (lead, 2026-10-06). Select in the message sheet (ListChecks) starts select mode in all three chat screen branches. Bubbles show the kit Checkbox and a full-row cover that toggles and swallows inner taps; tombstones have no box. SelectionBar replaces the composer or channel bar, with the count, Cancel, Forward and Android back; a chat switch resets. Forward opens ForwardSheet in chat order (lib/selection.ts). Not checked on the emulator yet. Nits for a polish task: swipe-to-reply still fires while selecting; a selection that loses a retracted message can open a short or empty sheet; tests for the idle {ids: []} shape and for BackHandler.
