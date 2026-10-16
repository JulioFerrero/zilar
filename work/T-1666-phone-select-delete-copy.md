---
id: T-1666
title: "Phone select mode gets Delete and Copy beside Forward, with web's per-message rules and the phone's existing delete confirms (parity audit gap 7, second half)"
status: merged
milestone: M5
branch: task/T-1666-phone-select-delete-copy
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1666: Delete and Copy in phone select mode

## Spec (written by Claude, do not edit)

### Why
On web, the multi-select bar offers Cancel, Delete, Copy and Forward (`apps/web/src/components/SelectionBar.tsx`, T-0439/WUX-32). On the phone, it offers only Cancel and Forward (`docs/audit/parity-2026-10-16.md`, gap 7).

### Facts (the lead read them on 2026-10-16, main after T-1664)
- **Web rules** (`apps/web/src/components/SelectionBar.tsx`):
  - **`deleteActionFor(message, meId, isDm)`:** `'sending'` → none; `canDeleteMessage(message, meId)` → everyone; `isDm && !message.deleted` → me; else none.
  - **`isDm`** is `chat.kind === 'dm' && chat.isAI !== true`. `deletable` is the selected messages whose action isn't none, and `allMine = deletable.every(m => m.senderId === meId)`.
  - **`copyable`** is the selected messages that aren't deleted and have non-empty `text`. Copy writes `copyable.map(m => `${m.senderName}: ${m.text}`).join('\n')`.
  - **Delete** shows only when `deletable.length > 0`; Copy is disabled when `copyable` is empty.
  - **The confirms:**
    - for a DM where everything is mine, a choice "Delete for me" / "Delete for everyone", with the body "Delete them for you only, or for everyone in the chat." (or "it" for one message);
    - for a DM otherwise, "Delete for me", with the body "This removes them from your chat only.";
    - for a group, "Delete", with the body "This deletes them for everyone in the chat.";
    - the title is "Delete messages?" or "Delete message?";
    - after a delete, select mode ends.
- **Phone:**
  - `apps/mobile/src/components/chat/selection-bar.tsx` (about 45 lines after T-1659): `SelectionBar({ count, onForward, onCancel })`, which uses `useBackCancel(onCancel)`;
  - it's rendered at `apps/mobile/src/components/chat/chat-composer-dock.tsx:146-151` with `count={screen.selectedIds.length}`, `onCancel={() => screen.setSelectedIds([])}` and `onForward={screen.forwardSelected}`; the dock has `chat`.
- **The phone's single-message delete UI to reuse** (`apps/mobile/src/components/chat/message-actions-sheet.tsx:225-283`):
  - an `ActionSheet` with "Delete for me" and "Delete for everyone" items, for an own DM message;
  - otherwise a `ConfirmDialog` from `@/components/ui/confirm-dialog`.
- **Store:**
  - `useChatStore((s) => s.messagesByChat[chatId])`, `s.currentUserId`;
  - `s.deleteForEveryone(chatId, messageId)` (`apps/mobile/src/store/types.ts:197`) and `s.deleteForMe(chatId, messageId)`.
  - `canDeleteMessage` and `canAct` come from `@zilar/chat-core` (the phone sheet also requires `canAct(message)`, `message-bubble-actions.tsx:108`).
- **Clipboard:** `expo-clipboard`'s `Clipboard.setStringAsync` (the phone pattern is `message-bubble-actions.tsx:41-43`).

### Steps
1. **`selection-bar.tsx`:**
   - props become `{ chat: { id: string; kind: string; isAI?: boolean }, selectedIds: string[], onForward, onCancel }`;
   - read the messages, `currentUserId` and the two delete actions from the store; compute `selected`, `deletable` (web's rule plus `canAct`), `allMine` and `copyable` as above;
   - render "N selected", Cancel, **Delete** (only when `deletable.length > 0`, destructive), **Copy** (disabled when `copyable` is empty) and Forward;
   - Copy writes the text and ends select mode;
   - Delete opens the matching confirm with web's copy:
     - the `ActionSheet` choice for a DM where all are mine;
     - a `ConfirmDialog` otherwise;
   - after the delete runs on every deletable message, select mode ends.
   - **Keep `useBackCancel(onCancel)`.** While a confirm is open, back closes the confirm instead.
2. **`chat-composer-dock.tsx`:** pass `chat` and `selectedIds={screen.selectedIds}` instead of `count`.
3. **Keep each file within 400 lines.** If the bar passes about 200 lines, put the confirms in a new `apps/mobile/src/components/chat/selection-delete.tsx`. **No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `apps/mobile/src/components/chat/selection-delete.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `work/T-1666-phone-select-delete-copy.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In phone select mode, Copy copies the selected texts** (one "Name: text" line each), and **Delete removes the deletable messages** after web's confirm.
- **Forward and Cancel behave as before.**

---

## Report (written by the worker when done)

### What I did

**Files changed** (all under Allowed files):
- `apps/mobile/src/components/chat/selection-bar.tsx` — new props `{ chat: { id, kind, isAI? }, selectedIds, onForward, onCancel }`. Reads `currentUserId`, `messagesByChat[chat.id]`, `deleteForMe` and `deleteForEveryone` from the store. Computes `selected`, `deletable` (web's `deleteActionFor` rule, plus `canAct`), `allMine` and `copyable` exactly as web's `SelectionBar`. Renders "N selected", Cancel, Delete (only when `deletable.length > 0`, `variant="destructive"`), Copy (`variant="outline"`, disabled when `copyable` is empty) and Forward. Copy writes `"Name: text"` per copyable message via `Clipboard.setStringAsync` (the `message-bubble-actions.tsx:41-43` pattern) and ends select mode. Delete opens the confirm. Both delete actions loop over `deletable`, then end select mode. Keeps `useBackCancel`, but back closes an open confirm first and only then leaves select mode.
- `apps/mobile/src/components/chat/selection-delete.tsx` (new) — `SelectionDeleteConfirm`, the two confirms with web's copy: an `ActionSheet` with "Delete for me" / "Delete for everyone" for a DM where `allMine` (body "Delete them/it for you only, or for everyone in the chat."), otherwise a `ConfirmDialog` (DM → "Delete for me" + "This removes them/it from your chat only. <sender> still has it."; group → "Delete" + "This deletes them/it for everyone in the chat."). Title is "Delete messages?" / "Delete message?" (`deletable.length > 1`). Same shells and labels as the single-message phone sheet (`message-actions-sheet.tsx`).
- `apps/mobile/src/components/chat/chat-composer-dock.tsx` — passes `chat` and `selectedIds={screen.selectedIds}` instead of `count`.
- This task file (status/Report).

No tests added: UI change (AGENTS.md says UI code gets no tests).

### Checks run

- Ran `pnpm install` first: done, no issues.
- No single test files run: no UI tests exist for these components and the spec says no tests.
- `pnpm gate` (from repo root), real output (re-run on the final tree, after the Report edit):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (3.9s)
  PASS  format  (1.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.5s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/mobile  (2.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  `git status --porcelain` shows only the three mobile files and this task file — nothing outside the Allowed files.

### Notes for the lead

- **Copy ends select mode**: the spec step says "Copy writes the text and ends select mode", so I call `onCancel()` after the clipboard write. Note this differs from web, which keeps select mode after Copy. Flagging in case that was unintentional.
- Delete variants/labels follow web: destructive Delete, outline Copy, the confirm copy quoted above. Cancel stays `variant="ghost"` as before; Forward is unchanged.
- Added `canAct` to `deletable`, as the spec says (web's `deleteActionFor` alone does not check the wire id).
- The confirm's Android back: `ConfirmDialog`'s `Modal` `onRequestClose` and the `ActionSheet` handle back natively; `useBackCancel`'s guard closes an open confirm if its listener still fires first, then leaves select mode.
- Both confirm shells are always mounted with `visible={confirmOpen}` (like `message-actions-sheet.tsx`), so the sheet presents cleanly on the first open.
- The bar now holds five rows of content; the four action buttons use `size="sm"` and `gap-2` so they fit a phone width. Worth a look in the phone smoke.

## Review (written by Claude)

**Approved and merged.** This is parity gap 7, second half.

- **Pre-review:** clean, 1 nit. The confirm renders on `visible` alone, while web also checks `deletable.length > 0`; that only matters if a message vanishes while the confirm is open. Accepted.
- **The change:**
  - the bar uses web's rules (`deleteActionFor` plus the phone's `canAct`) for Delete and Copy;
  - the confirms (in `selection-delete.tsx`) reuse the phone's single-message shapes with web's copy;
  - back closes an open confirm first.
- **Still to check:** the width of the five-control bar on a phone is in the combined emulator QA pass on main.
