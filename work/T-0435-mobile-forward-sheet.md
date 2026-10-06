---
id: T-0435
title: "Forwarding (mobile UI): Forward in the message sheet opens a forward sheet; pick chats, optional comment, send"
status: todo
milestone: M5
branch: task/T-0435-mobile-forward-sheet
model: auto
effort: low
depends_on: [T-0432]
estimate: 0.4 day
---

# T-0435: mobile forward sheet

## Spec (written by Claude, do not edit)

### Why
This is task T-F part 2 in `docs/audit/forwarding-plan.md` §4. T-0432 (merged) added `forwardMessages(targets, messages, { comment })` to the mobile store, both real and mock. Web has the same flow since T-0419 (`apps/web/src/components/ForwardPicker.tsx`); mirror its rules on mobile.

### Verified facts (do not re-derive)
- **Store:** `apps/mobile/src/store/types.ts:271` has `forwardMessages(targets: string[], messages: UiMessage[], options?: { comment?: string })`. The store has `chats: ChatSummary[]` (`types.ts:158`). It is read with `useChatStore((s) => …)` from `@/store/chat-store-provider`.
- **Web rules to copy** (`apps/web/src/components/ForwardPicker.tsx`):
  - `targetLabel` shows a topic as `Group › Topic`;
  - `canPostTo` hides a channel unless `myRole` is `owner` or `admin`;
  - archived chats are hidden;
  - search matches `title` and `groupTitle`;
  - the Send label is `Send`, or `Send to N chats` for more than one;
  - the comment is trimmed and passed only when it is not empty.
- **`apps/mobile/src/components/chat/message-actions-sheet.tsx`:**
  - props at lines 11-33;
  - items at lines 96-121, with `<ActionSheetItem label="Reply" onPress={onReply} icon={Reply} />` at line 96;
  - icons come from `lucide-react-native`.
- **`apps/mobile/src/components/chat/message-bubble.tsx`:** `<MessageActionsSheet …>` at lines ~639-680. `onReply` closes the menu (`setMenuOpen(false)`) and then calls `onReply(message)`.
- **`apps/mobile/src/components/chat/message-list.tsx`:** the props `onReply` (line 37) and `onDelete?` (line 40) are passed through at lines ~320-323.
- **`apps/mobile/src/app/chat/[id].tsx`:** `MessageList` is rendered in three layouts with `onReply={startReply}` at lines ~506, ~653 and ~854.
- **Kit:**
  - `BottomSheet` (`components/ui/bottom-sheet.tsx:9-17`: `visible`, `onClose`, `closeLabel`, `title?`, `maxHeightClassName?`, `children`);
  - `SearchField` (`components/ui/search-field.tsx`);
  - `TextField` (`components/ui/text-field.tsx`, which has `label?`);
  - `Checkbox` (visual only: `checked`, `disabled?`);
  - `Button` (labels inside `<Text>`).
- **Checkbox row pattern:** `apps/mobile/src/components/chat/new-topic-sheet.tsx:195-212`, a `Pressable` with `accessibilityRole="checkbox"`, `accessibilityState={{ checked }}`, a `Checkbox`, an `Avatar` and a name.
- **Tests that import the bubble** (mocks may need the new icon): `message-bubble-layout.test.tsx`, `message-bubble-stickers.test.tsx` and `message-bubble-ticks.test.tsx`. They already mock `Forward`. Also `message-list.test.tsx`.
- **Mobile tests render static markup with mocks** (there is no RN testing library). Example: `apps/mobile/src/components/ais/ai-activity.test.tsx:20-41`.

### What to build
1. **`message-actions-sheet.tsx`:** new props `canForward?: boolean` and `onForward?: () => void`. When `canForward === true`, show `<ActionSheetItem label="Forward" accessibilityLabel="Forward message" onPress={onForward ?? (() => {})} icon={Forward} />` right after Reply.
2. **`message-bubble.tsx`:**
   - new optional prop `onForward?: (message: UiMessage) => void`;
   - `canForward` = not deleted, not `status === 'sending'`, and not my own failed message;
   - pass `canForward={onForward !== undefined && canForward}` and `onForward={() => { setMenuOpen(false); onForward?.(message); }}`.
3. **`message-list.tsx`:** the optional `onForward` prop, passed through like `onDelete`.
4. **New `apps/mobile/src/components/chat/forward-sheet.tsx`:**
   - export the pure helpers `forwardTargets(chats: ChatSummary[], query: string): ChatSummary[]` (the web rules) and `forwardSendLabel(count: number): string`;
   - export `ForwardSheet({ messages, onClose })` on `BottomSheet`, with `title="Forward"` and `closeLabel="Close forward"`;
   - inside: a `SearchField` ("Search chats"), the checkbox rows with avatar and `targetLabel`, a `TextField` with label "Add a comment (optional)", then a `Cancel` outline Button and a primary Button with the send label, disabled with no target;
   - Send calls `forwardMessages(selected, messages, trimmed === '' ? undefined : { comment: trimmed })`, then `onClose()`.
5. **`app/chat/[id].tsx`:** `const [forwarding, setForwarding] = useState<UiMessage[] | null>(null)`. Pass `onForward={(message) => setForwarding([message])}` to all three `MessageList`s, and render `{forwarding !== null ? <ForwardSheet messages={forwarding} onClose={() => setForwarding(null)} /> : null}` once in each layout, next to the other overlays.
6. **Tests:**
   - **new `apps/mobile/src/components/chat/forward-sheet.test.tsx`:**
     - `forwardTargets` hides archived chats and member-only channels, keeps owner and admin channels, matches by title and by group title, and labels topics `Group › Topic`;
     - `forwardSendLabel(1)` is "Send" and `forwardSendLabel(3)` is "Send to 3 chats";
     - a static render shows the rows and a disabled Send.
   - Add one static-markup case (in `message-bubble-layout.test.tsx`, or a new `message-actions-sheet.test.tsx`) showing that "Forward message" appears when `canForward` is true and not when it is false.

### Read first
`AGENTS.md`, `apps/web/src/components/ForwardPicker.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx:180-215` and `:630-690`, `apps/mobile/src/components/chat/message-list.tsx:30-80` and `:310-330`, `apps/mobile/src/app/chat/[id].tsx:495-515`, `apps/mobile/src/components/chat/new-topic-sheet.tsx:180-245`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/ais/ai-activity.test.tsx:1-45`.

### Allowed files
`apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/forward-sheet.tsx`, `apps/mobile/src/components/chat/forward-sheet.test.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0435-mobile-forward-sheet.md`. Mocks only: `apps/mobile/src/components/chat/message-bubble-layout.test.tsx`, `apps/mobile/src/components/chat/message-bubble-stickers.test.tsx`, `apps/mobile/src/components/chat/message-bubble-ticks.test.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx`.

If any other test breaks through an import, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot forward-sheet message-actions-sheet message-bubble message-list
pnpm gate
```

### Acceptance
- Forward in the message sheet opens the forward sheet.
- Choosing chats and Send calls `forwardMessages` with the comment.
- Archived chats and non-postable channels are not offered.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
