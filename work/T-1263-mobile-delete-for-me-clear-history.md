---
id: T-1263
title: "TG-7 DMs mobile: 'Delete for me' on any DM message (own messages keep 'Delete for everyone' too) and 'Clear history' in the DM's chat actions sheet, on client-core delete-own (T-1247) and the T-1236 routes; same labels and confirms as web"
status: merged
milestone: M5
branch: task/T-1263-mobile-delete-for-me-clear-history
model: auto
effort: default
depends_on: [T-1247]
estimate: 0.3 day
---

# T-1263: Delete for me and Clear history (mobile)

## Spec (written by Claude, do not edit)

### Why
This is the mobile half of TG-7 DMs.
- **The shared logic** is already in client-core (T-1247, merged): `deleteForMe` and `clearHistory` in `packages/client-core/src/store/delete-own.ts:50,93`, with the optional ports `deleteMessageForMe` and `clearChatHistory` in `packages/client-core/src/store/ports.ts:66,71`.
- **The web wiring to copy:**
  - the store: `apps/web/src/store/effects/chatActions.ts`, which imports `clearHistoryCore` and `deleteForMeCore` at `:5,8`;
  - the API: `apps/web/src/lib/api/chats.ts`;
  - the menus: `apps/web/src/components/message/MessageMenu.tsx` passes `deleteLabel = isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone'`;
  - the confirms: on another person's message, only "Delete for me" with "This removes it from your chat only. {Name} still has it."; on my own, both "Delete for me" and "Delete for everyone";
  - `apps/web/src/components/ChatActionsMenu.tsx` has Clear history (lucide `Eraser`) with "Clear your history with {Name}? This removes every message from your side only. {Name} keeps theirs.".
- **Mobile today** only has Delete for everyone on my own messages:
  - `apps/mobile/src/components/chat/message-actions-sheet.tsx` (202 lines, kit `ConfirmDialog`);
  - `apps/mobile/src/components/chat/chat-thread.tsx:29,111` (`deleteForEveryone`);
  - `canDelete` in `apps/mobile/src/components/chat/message-bubble.tsx:356`;
  - the chat actions sheet `apps/mobile/src/components/chat/chat-actions-sheet.tsx` (144 lines), wired in `apps/mobile/src/components/chat/chat-actions-host.tsx` and `apps/mobile/src/components/chat/use-chat-actions.ts`.

### What to build
1. **API and ports:** add `deleteMessageForMe(jid, archiveId)` and `clearChatHistory(jid)` to `apps/mobile/src/lib/chat-api.ts` (219 lines; follow `markChatRead` at `:72,210`) on the typed client, and pass them as the client-core ports where mobile builds its ports (find and cite).
2. **The store:** add `deleteForMe(chatId, messageId)` and `clearHistory(chatId)` to the mobile store types (`apps/mobile/src/store/types.ts`) and effects, the same way `markChatRead` is wired in `apps/mobile/src/store/effects/events.ts:31,153`. Both return the core outcome.
3. **The message sheet, in a DM** (not an AI chat):
   - offer delete on every message that isn't deleted or still sending, with the web's labels and confirms;
   - in groups nothing changes;
   - a failure shows "Could not delete. Try again.";
   - no `Alert.alert`.
4. **The chat actions sheet, DM only:** Clear history (lucide `Eraser`) with the web's confirm text, an in-sheet confirm and the same failure line.
5. **Mock:** the mock already serves both routes (T-1247, `packages/mock-backend/src/domains/chats/routes.ts`). Mobile mock mode must use them.
6. **No new tests** (client-core is tested). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `work/T-1247-web-delete-for-me-clear-history.md`, `packages/client-core/src/store/delete-own.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx` and `apps/mobile/src/components/chat/use-chat-actions.ts`.

### Allowed files
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/**`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-host.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `work/T-1263-mobile-delete-for-me-clear-history.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every file stays at most 400 lines.
- **The lead's emulator check (mock build), in Marta's DM:**
  - long-pressing her last message offers "Delete for me", and confirming removes only that message;
  - my own message offers both choices;
  - the chat actions sheet has Clear history.

---

## Report (written by the worker when done)

Done. The mobile DM delete-for-me and clear-history, on the client-core logic (T-1247) and the T-1236 routes, with the web's labels and confirm texts. `pnpm gate` is green and lists no files outside the Allowed files.

### What I built
- **`apps/mobile/src/lib/chat-api.ts`**: optional `deleteMessageForMe(jid, archiveId)` and `clearChatHistory(jid)` on `ChatApi`, implemented on the typed client next to `markChatRead` (`client.chats.deleteForMe` / `client.chats.clearHistory`, `DELETE /api/chats/:jid/messages/:archiveId` and `/history`).
- **`apps/mobile/src/store/real-store.ts`**: the two passed as client-core ports in `coreApi` (where mobile builds its ports, `real-store.ts:148-163`), exactly like `markChatRead`/`markChatDelivered`.
- **`apps/mobile/src/store/types.ts`**: `deleteForMe(chatId, messageId)` and `clearHistory(chatId)`, both `Promise<DeleteOutcome>` (the shared core outcome), documented with T-1247.
- **`apps/mobile/src/store/effects/events.ts`**: both actions wired like `markChatRead`, calling the core `deleteForMeCore`/`clearHistoryCore` on `ctx.coreCtx` via `ctx.run` so the Promise edge resolves the outcome.
- **`apps/mobile/src/components/chat/message-actions-sheet.tsx`**: the delete row's label is now per web (`Delete` on my own DM message, `Delete for me` on the peer's, `Delete for everyone` in groups). In a DM the confirm matches web: the peer's message opens a `ConfirmDialog` "Delete message?" / "This removes it from your chat only. {Name} still has it." / "Delete for me"; my own offers both choices in an in-sheet confirm ("Delete for me" and "Delete for everyone", body "Delete it for you only, or for everyone in the chat."). Groups keep the old dialog unchanged. No `Alert.alert`.
- **`apps/mobile/src/components/chat/message-bubble-actions.tsx`** and **`message-bubble.tsx`**: the bubble reads its chat from the store to compute `isDm` (DM and not AI) and `canDeleteForMe` (any DM message that is not deleted and not still sending), and the sheet calls the store's `deleteForMe` directly (the delete-for-everyone path still flows up through `chat-thread.tsx` unchanged). The core sets `actionError`, so failures show "Could not delete. Try again." in the thread's `DismissBanner`.
- **`apps/mobile/src/components/chat/chat-actions-sheet.tsx`**, **`chat-actions-host.tsx`**, **`use-chat-actions.ts`**: a DM-only "Clear history" row with lucide `Eraser`, an in-sheet confirm with the web's text ("Clear your history with {Name}? This removes every message from your side only. {Name} keeps theirs."), and the same "Could not delete. Try again." failure line via the existing sheet error path. `unavailable` closes silently like web; only `failed` shows the line.
- **Mock mode** uses the same real store with the mock fetch, so both routes go through the T-1247 mock backend automatically; no separate mock store exists.

### Files changed (all inside Allowed files)
`apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-host.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `work/T-1263-mobile-delete-for-me-clear-history.md`. Longest touched file: `message-bubble.tsx` at 392 lines; all ≤ 400.

### Commands and results
- `pnpm install` → Done.
- `pnpm gate` (repo root) → **GATE PASS**:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (3.1s)`
  - `PASS  effect  (0.9s)`
  - `PASS  tests @zilar/mobile  (3.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
- No single test file was run on its own: the change is UI only and the spec says no new tests, so the only test run is the mobile package suite inside `pnpm gate`. The first gate run failed format on three files; I ran `pnpm exec prettier --write` on those three and re-ran the gate, which passed.

### Deviations / notes
- The mobile `ConfirmDialog` kit only has one destructive action, and it is not in the Allowed files, so my own message's two-choice confirm is rendered as an in-sheet confirm (an `ActionSheet` step) instead of a second dialog button, as the spec already asks for Clear history. Labels, bodies and the destructive choices match web.
- `chat-thread.tsx` needed no change: delete-for-everyone still flows through it, and the delete-for-me failure line reaches the same `actionError` banner through the core.
- Untested by me: the emulator flow (Marta's DM) is the lead's check. Static checks and the mobile test suite pass.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit). That pre-review ran on the paid Muse after the lead switched it by hand: the free Muse answered 401.**
- **The change:** mobile ports `deleteMessageForMe` / `clearChatHistory` in `chat-api.ts`, store `deleteForMe` / `clearHistory` on client-core `delete-own`, and the web's labels and confirms in the message sheet and the chat actions sheet.
- **Lead's emulator check (mock build, SMOKE PASS, Marta DM):**
  - long-pressing Marta's last message shows "Delete for me", and its confirm says "This removes it from your chat only. Marta still has it.";
  - confirming removes only that message ("Yes, thanks!" stays), and the list preview moves to "Yes, thanks!";
  - long-pressing the Marta row shows Pin, Mute, Archive, Mark as unread and Clear history.
