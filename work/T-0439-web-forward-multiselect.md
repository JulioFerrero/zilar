---
id: T-0439
title: "Forwarding (web): Select in the message menu starts select mode; check several messages; a bar forwards them together"
status: todo
milestone: M5
branch: task/T-0439-web-forward-multiselect
model: auto
effort: low
depends_on: [T-0419]
estimate: 0.4 day
---

# T-0439: forward several messages (web)

## Spec (written by Claude, do not edit)

### Why
This is the second half of task T-E in `docs/audit/forwarding-plan.md` §4. Julio accepted the recommendation for §5 question 7: the message menu enters select mode, more messages can be checked, and a bottom bar shows the count and Forward.

T-0419 already forwards one message. `ForwardPicker` takes `messages: UiMessage[]`, and the store's `forwardMessages` already handles several.

### Verified facts (do not re-derive)
- **`apps/web/src/components/MessageActionsMenu.tsx`:**
  - the props include `canForward` and `onForward` (lines 14-19);
  - the items render at lines ~76-90;
  - Forward is `<MenuItem onSelect={onForward} icon={Forward}>` at line 78, shown when `canForward`.
- **`apps/web/src/components/MessageBubble.tsx`:**
  - `onForward?` prop at line 189;
  - `canForward` computed at line 232;
  - the menus are passed `onForward` at lines ~415 and ~737;
  - the root of a normal bubble is `<div data-message-id={message.id} … onContextMenu=…>` at about line 322 (the deleted tombstone at ~292 has no actions).
- **`apps/web/src/components/MessageList.tsx`:** props `{ chat, onReply, onForward? }` (lines 21-29); it renders `MessageBubble` at lines ~244-255 and passes `onForward` at 252. The ordered list is `store.messages(chat.id)` (line 32).
- **`apps/web/src/routes/ChatView.tsx`:**
  - `forwarding` state at line 65;
  - `MessageList` at lines ~130-135;
  - the composer block at ~136-145;
  - `ForwardPicker` rendered at lines 160-162;
  - the "reset on chat change" pattern (`panelChatId`) at lines ~47-54.
- **Kit:** `Checkbox({ checked, onCheckedChange, disabled?, label })` (`apps/web/src/components/ui/checkbox.tsx`) and `Button` (`components/ui/button.tsx`). Icons come from `lucide-react`.
- **Tests:** `apps/web/src/components/MessageActionsMenu.test.tsx` and `apps/web/src/routes/ChatView.test.tsx` exist (from T-0419). `apps/web/src/components/MessageBubble.forward.test.tsx` and `apps/web/src/components/MessageList.test.tsx` render these components.

### What to build
1. **`MessageActionsMenu`:** a new prop `onSelectMessages: () => void` and an item `<MenuItem onSelect={onSelectMessages} icon={ListChecks}>Select</MenuItem>` right after Forward, shown only when `canForward`.
2. **`MessageBubble`:** new optional props:
   - `selecting?: boolean`;
   - `selected?: boolean`;
   - `onToggleSelect?: (message: UiMessage) => void`;
   - `onStartSelect?: (message: UiMessage) => void`.

   Behaviour:
   - the menu's Select calls `onStartSelect` (after closing the menu, like the other items);
   - **while `selecting`,** the normal bubble row shows a kit `Checkbox` before the bubble (`label` "Select message", `checked={selected === true}`, `disabled={!canForward}`, `onCheckedChange` → `onToggleSelect`);
   - clicking anywhere on the row toggles it too, when `canForward`;
   - the context menu and the hover action button do not open;
   - tombstones show no checkbox.
3. **`MessageList`:** an optional prop `selection?: { ids: ReadonlySet<string>; onToggle(message); onStart(message) }`, passed to every bubble as `selecting`, `selected`, `onToggleSelect` and `onStartSelect`.
4. **New `apps/web/src/components/SelectionBar.tsx`:**
   - `SelectionBar({ count, onForward, onCancel })`;
   - a bar shown in place of the composer, with "N selected" (`aria-live="polite"`), an outline Cancel button and a primary Forward button (disabled at 0);
   - Escape calls `onCancel`.
5. **`ChatView`:**
   - `const [selectedIds, setSelectedIds] = useState<string[] | null>(null)`, where `null` means not selecting; reset it when the chat changes, like `panelChatId`;
   - pass `selection` to `MessageList`: Start → `[message.id]`, Toggle → add or remove;
   - while selecting, render `SelectionBar` **instead of** the composer (or the channel composer bar);
   - Forward → `setForwarding(store.messages(chat.id).filter((m) => ids.has(m.id)))` (chronological order), then `setSelectedIds(null)`.
6. **Tests:**
   - `MessageActionsMenu.test.tsx`: Select is shown when `canForward`, and calls the handler.
   - **New `SelectionBar.test.tsx`:** the count text, Forward disabled at 0, Cancel, Escape.
   - `ChatView.test.tsx`: Select from a message menu enters select mode, which shows the bar and checkboxes; checking a second message makes "2 selected"; Forward opens the picker with both messages in chronological order; Cancel leaves select mode.
   - Fix the setup of `MessageBubble.forward.test.tsx` and `MessageList.test.tsx` only if the new props break them.

### Read first
`AGENTS.md`, `docs/audit/forwarding-plan.md` §4 (T-E) and §5 question 7, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/MessageBubble.tsx:180-240`, `:286-340`, `:400-425` and `:725-745`, `apps/web/src/components/MessageList.tsx:15-60` and `:230-260`, `apps/web/src/routes/ChatView.tsx:40-165`, `apps/web/src/components/ForwardPicker.tsx`, `apps/web/src/components/ui/checkbox.tsx`.

### Allowed files
`apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/MessageActionsMenu.test.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/SelectionBar.tsx`, `apps/web/src/components/SelectionBar.test.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0439-web-forward-multiselect.md`. Setup fixes only: `apps/web/src/components/MessageBubble.forward.test.tsx`, `apps/web/src/components/MessageList.test.tsx`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot MessageActionsMenu SelectionBar ChatView MessageList MessageBubble
pnpm gate
```

### Acceptance
- Select in the menu starts select mode, where several messages can be checked; the bar forwards them together in chat order.
- Cancel or Escape leaves select mode, and so does switching chat.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
