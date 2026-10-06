---
id: T-0419
title: "Forwarding step 4 (web UI): Forward in the message menu opens a picker; choose chats, add an optional comment, send"
status: todo
milestone: M5
branch: task/T-0419-web-forward-picker
model: auto
effort: low
depends_on: [T-0414]
estimate: 0.4 day
---

# T-0419: Forward menu item and picker (single message)

## Spec (written by Claude, do not edit)

### Why
This is the first half of task T-E in `docs/audit/forwarding-plan.md` §4, approved by Julio on 2026-10-06. T-0414 (merged before this launches) adds `forwardMessages(targets, messages, { comment })` to the store. This task adds the user-facing flow for **one message**. Multi-select (checking several messages, then a selection bar) is the next task, so do not build it here.

### Julio's decisions (§5)
- Channels where the user cannot post are **hidden** from the picker.
- Private topics appear only when the user can see them. The store only holds visible topics.
- The comment is optional and is sent as a separate message after the forward (the store action already does this).

### Verified facts (do not re-derive)
- **`apps/web/src/components/MessageActionsMenu.tsx`:**
  - props interface at lines 5-26 (`onReply`, `onCopy`, `onEdit`, `onDelete`, `onPin`, `onUnpin`, `onReact`, `onClose`, …);
  - the items render at lines 70-82 with `MenuItem` from `./ui/menu`: Reply, Edit, Copy, Delete (destructive), Pin/Unpin.
- **`apps/web/src/components/MessageBubble.tsx`:**
  - props include `onReply: (message: UiMessage) => void` (line 187);
  - `MessageActionsMenu` is rendered twice, at line ~396 (sticker layout) and line ~713 (text layout), each passing `onReply={() => { …; onReply(message); }}`.
- **`apps/web/src/components/MessageList.tsx`:** props `{ chat, onReply }` (lines 20-27), and it passes `onReply` to each `MessageBubble` (line ~249).
- **`apps/web/src/routes/ChatView.tsx`:** `startReply` (line 71) is passed as `<MessageList key={chat.id} chat={chat} onReply={startReply} />` (line 118).
- **Kit:**
  - `apps/web/src/components/ui/dialog.tsx`: `Dialog({ title, description?, … })`, modal with a focus trap and Escape;
  - `apps/web/src/components/ui/search-field.tsx`: `SearchField`;
  - `apps/web/src/components/ui/checkbox.tsx`: `Checkbox({ checked, onCheckedChange, disabled?, label })`;
  - `apps/web/src/components/ui/text-input.tsx`: `TextArea`;
  - `apps/web/src/components/ui/button.tsx`: `Button`;
  - `apps/web/src/components/ui/list-row.tsx`: `ListRow`.
- **`packages/chat-core/src/types.ts` (`ChatSummary`, lines 134-185):**
  - `id`, `title`, `kind`, `isAI`, `archived?`;
  - `chatKind?: 'group' | 'channel'`;
  - `myRole?: 'owner' | 'admin' | 'member'` ("admins post, members read");
  - `groupTitle?` and `topic?` (for topics).

### What to build
1. **`MessageActionsMenu`:**
   - add `onForward: () => void` to the props;
   - add `<MenuItem onSelect={onForward} icon={<Forward …/>}>Forward</MenuItem>` right after Reply. Use whatever icon prop pattern the other items use; if they have none, add no icon.
   - Forward is hidden for deleted messages and for my own failed or sending messages: add a `canForward` prop and compute it in MessageBubble.
2. **`MessageBubble`:** add an optional `onForward?: (message: UiMessage) => void` prop, and pass `onForward={() => { close the menu the way onReply does; onForward?.(message); }}` to both menus.
3. **`MessageList`:** add an optional `onForward` prop and pass it through to `MessageBubble`.
4. **New file `apps/web/src/components/ForwardPicker.tsx`:** `ForwardPicker({ messages, onClose })`, built on the kit `Dialog` with the title "Forward".
   - **Search:** a `SearchField` filters the chats by `title` (and `groupTitle` for topics, shown as "Group › Topic").
   - **List:** rows from the store's `chats`, excluding archived chats and channels where `myRole` is `'member'` or absent. Each row has a kit `Checkbox` (several targets allowed), an avatar or initials, and the title.
   - **Comment:** an optional `TextArea` labelled "Add a comment (optional)".
   - **Send:** a primary `Button` labelled `Send` when one chat is chosen and `Send to N chats` for more. It is disabled with no target. It calls `forwardMessages(selectedIds, messages, comment.trim() === '' ? undefined : { comment })` and then `onClose()`.
   - **Cancel:** an outline `Button`.
5. **`ChatView`:** hold `forwarding: UiMessage[] | null` state, pass `onForward={(message) => setForwarding([message])}` to `MessageList`, and render `<ForwardPicker messages={forwarding} onClose={() => setForwarding(null)} />` while it is set.
6. **Tests:**
   - **new `apps/web/src/components/ForwardPicker.test.tsx`:** it lists DMs, groups and topics; hides archived chats and member-only channels; search filters; Send is disabled with no target; Send calls `forwardMessages` with the chosen ids and the comment; Cancel closes;
   - **new `apps/web/src/components/MessageActionsMenu.test.tsx`** (no test exists for the menu today): Forward shows and calls `onForward`, and it is hidden when `canForward` is false;
   - **`apps/web/src/routes/ChatView.test.tsx`:** add one case where Forward in a message menu opens the picker.

   Mirror these files' existing render and store setup.

### Read first
`AGENTS.md`, `docs/audit/forwarding-plan.md` §3.3 and §4 (T-E), `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/MessageBubble.tsx:180-230`, `:390-420` and `:705-735`, `apps/web/src/components/MessageList.tsx:1-60` and `:235-255`, `apps/web/src/routes/ChatView.tsx:60-130`, `apps/web/src/components/ui/dialog.tsx`, and `apps/web/src/components/ui/checkbox.tsx`. For a picker pattern, see how `apps/web/src/components/NewGroupDialog.tsx` lists people with checkboxes.

### Allowed files
`apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/MessageActionsMenu.test.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/ForwardPicker.tsx`, `apps/web/src/components/ForwardPicker.test.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0419-web-forward-picker.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ForwardPicker MessageActionsMenu ChatView
pnpm gate
```

### Acceptance
- Forward in the message menu opens the picker.
- Choosing one or more chats and Send calls `forwardMessages` with the comment.
- Non-postable channels and archived chats are not offered.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
