---
id: T-1171
title: "WUX-7: web 'New message' lists your contacts with a filter and opens the DM at once; the contact card shows Message for every contact (a contact whose row has not arrived yet gets a chat refresh and opens when it lands)"
status: merged
milestone: M5
branch: task/T-1171-web-new-message-dialog
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1171: New message starts a DM

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-7 (P1, confirmed).
- **The "New message" dialog** is only a sentence, "Invite a friend… or type their @username in the search bar above" (`apps/web/src/components/NewChatButton.tsx:219-246`). There is no contact list, although the store has `contacts`.
- **The pattern to copy:** `NewGroupDialog.tsx:65` reads `s.contacts`, and `:181-205` renders the rows with `Avatar` and `HandleSuffix`.
- **The contact card** shows Message only when a DM chat row already exists (`apps/web/src/components/ContactProfileRow.tsx:131-147`).
- **Every contact already has a DM row from the server** (`apps/server/src/chats/api.ts:104-110`), so a missing row only means the chat list hasn't refreshed since the contact was added. The refresh action is `refreshChats` (`apps/web/src/store/effects/chatActions.ts:123`).
- **Telegram:** New message gives a searchable contact list, and picking one opens the chat at once.

### What to build
1. **A new `apps/web/src/components/NewMessageDialog.tsx`** (at most 200 lines):
   - a `Dialog` titled "New message", with a filter input at the top, autofocused, that filters by name and handle (case-insensitive prefix match on any word, or on the handle);
   - the contact rows, styled as in `NewGroupDialog.tsx:186-205` but as buttons. Arrow up and down move the selection, and Enter opens the selected contact;
   - picking a contact closes the dialog and navigates to `/c/${encodeURIComponent(contact.jid)}`;
   - **No contacts:** keep today's text and the "Invite a friend" button.
2. **`NewChatButton.tsx:219-246`:** render `NewMessageDialog` in place of the text-only dialog, passing `onInvite = () => openDialog('invite')`.
3. **`ContactProfileRow.tsx:131-147`:** show Message for every contact. If the row isn't in `chats` yet, call `refreshChats()` and then navigate; the shell shows the chat when the row lands. Fix the comment.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-7), `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/NewGroupDialog.tsx:56-210`, `apps/web/src/components/ContactProfileRow.tsx:100-200`, `apps/web/src/routes/ChatShell.tsx` and `apps/web/src/store/effects/chatActions.ts:110-135`.

### Allowed files
`apps/web/src/components/NewMessageDialog.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/ContactProfileRow.tsx`, `work/T-1171-web-new-message-dialog.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web:** New message lists the contacts, typing filters them, and Enter opens the DM.

---

## Report (written by the worker when done)

### What I did

- **New `apps/web/src/components/NewMessageDialog.tsx`** (161 lines; all touched files stay under the 400-line cap). A `Dialog` titled "New message" with an autofocused `SearchField` at the top. The filter is a case-insensitive prefix match on any word of the name or on the handle (`matchesFilter`). Contact rows are `button`s styled like `NewGroupDialog.tsx:186-205` (Avatar + name + `HandleSuffix`); the selected row uses `bg-surface-raised`, the rest `hover:bg-list-hover`. Arrow up/down move the selection, Enter opens the selected contact. Picking a contact closes the dialog and navigates to `/c/${encodeURIComponent(contact.jid)}`. When `contacts` is empty it renders today's text and the "Invite a friend" button (`onInvite`), plus Close.
- **`NewChatButton.tsx`**: replaced the text-only `dialog === 'message'` block (old lines 219-246) with `<NewMessageDialog onClose={closeDialog} onInvite={() => openDialog('invite')} />` and added the import. The `Dialog`/`Button` imports are still used by the topic picker.
- **`ContactProfileRow.tsx`**: `Message` now shows for every `contact` when the store knows their JID. `openChat` navigates to the contact's JID and calls `refreshChats()` first when no chat row with that id is in `chats` yet; the shell opens the chat when the row lands. Replaced the old `dmChatId` lookup and updated the comment. Added `useChatStoreApi`.

No tests added (UI, per spec).

### Files changed

- `apps/web/src/components/NewMessageDialog.tsx` (new)
- `apps/web/src/components/NewChatButton.tsx`
- `apps/web/src/components/ContactProfileRow.tsx`
- `work/T-1171-web-new-message-dialog.md`

### Commands and results

- `pnpm install`: done, no errors (only the pre-existing `@types/react` peer warning in `apps/mobile`).
- `pnpm gate`: **GATE PASS**
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  effect`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
- No test files were run individually (the task is UI-only and the gate skipped the web tests for the same reason).

### Deviations / notes

- The `Message` button in `ContactProfileRow` still needs the contact in the store's `contacts` list to resolve the JID, because `HandleProfile` carries no JID (only `userId`, `name`, `handle`, `image`, `relation`). This matches the spec's model ("every contact has a DM row from the server"); if a profile reports `relation: 'contact'` but is absent from `contacts`, the row falls through as before rather than showing a broken button.
- `NewMessageDialog` only closes and navigates; it does not call `refreshChats` (the spec only asks for the refresh in the contact card path), since a contact picked from the list already has its DM row loaded.

### Live check for the lead

New chat → New message lists the contacts, typing filters by name/handle, arrow keys move the highlight and Enter (or a click) opens the DM. The contact card's Message button opens the DM for any contact, refreshing the chat list first if the row is missing.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The new `NewMessageDialog`:**
  - the contact list filters on a word prefix or the handle;
  - the arrow keys move the selection, and Enter or a click opens `/c/<jid>`;
  - with no contacts, it shows the invite text.
- **`ContactProfileRow`:** Message shows for every contact, and a missing row calls `refreshChats()` and then navigates.
- **Still to do:** the live check on web.
