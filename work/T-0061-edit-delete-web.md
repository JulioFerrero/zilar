---
id: T-0061
title: Edit and delete for everyone (web) — XEP-0308 corrections, XEP-0424 retractions, an edit bar, "edited" labels and tombstones; the gateway ignores both
status: planned
milestone: M1
branch: task/T-0061-edit-delete-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0059]
estimate: 1.5 days
---

# T-0061: Edit and delete for everyone (web)

## Spec (written by Claude, do not edit)

### Goal

The MVP list (`docs/PROJECT_PLAN.md` §21) has message edit and delete, and the web has neither. Add Telegram-like editing and delete-for-everyone to DMs and groups. Both must survive reloads: they come back from MAM history, just like T-0059's reactions.

### Protocol (decided)

**Edit: XEP-0308 (Last Message Correction).** A new message to the chat:
- the **new full body**;
- `<replace xmlns="urn:xmpp:message-correct:0" id="ORIGINAL"/>`, where `ORIGINAL` is the original stanza's **`id` attribute** (the id the sender generated), in DMs **and** in groups, as XEP-0308 requires;
- its own new message id;
- mentions (XEP-0372) rebuilt from the new text.

**Delete for everyone: XEP-0424 (Message Retraction, `urn:xmpp:message-retract:1`).** A message to the chat containing:
- `<retract xmlns="urn:xmpp:message-retract:1" id="TARGET"/>`;
- `<fallback xmlns="urn:xmpp:fallback:0" for="urn:xmpp:message-retract:1"/>`;
- a fallback body: `This person attempted to retract a previous message, but it's unsupported by your client.`;
- `<store xmlns="urn:xmpp:hints"/>`.

`TARGET` is the original's id attribute in DMs and its **stanza-id** (XEP-0359) in groups. That is the same rule as T-0059's reactions.

**Matching.** The store keeps both ids of a message linked through `messageAliases` (`sameMessage` in `realStore.ts`). Resolve every target with `sameMessage`, never with `===`.
- If the store can't reach the sender-generated id for a group message (an archive item has only the stanza-id), make xmpp-core expose it: add `ChatMessage.originId?: string` (the stanza's `id` attribute or `<origin-id/>`). Link it as an alias.
- Say in the Report how you resolved this.

**Authorization (receiver side).**
- Accept a correction or retraction **only from the original sender**:
  - in DMs, the same bare JID;
  - in groups, the same real JID when resolved, else the same `occupantId`, else the same nick.
- Anything else is ignored. That covers foreign ones and ones whose target isn't found once history is complete.

**Order.**
- Several corrections to one message: the latest in stanza order wins (MAM order for history, arrival order live).
- A retraction wins over everything, including later corrections and reactions.

**Limits (sender side, UI only).**
- Edit: only my own **text** messages (not voice, image or cards), within **48 hours** of sending.
- Delete for everyone: my own messages of any kind, with no time limit.

**Server archive.** Delete for everyone hides the message in our clients. It does not scrub ejabberd's MAM (a follow-up, see Out of scope). Don't promise more than that in the UI copy: "Delete for everyone" is fine.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0059-reactions-web.md` (the Report), and the code it added. The same pipeline (parse → store → pending items for targets not loaded yet) is the model here.
- `packages/xmpp-core/src/stanza.ts`, `types.ts`, `client.ts`, `namespaces.ts`, and their tests
- `apps/web/src/store/realStore.ts`: `toUiMessage`, history merge, live handling, `messageAliases`/`sameMessage`, `sendText`, and the reply quote resolution. Also `store.ts` and the mock store.
- `apps/web/src/components/MessageBubble.tsx`, `MessageActionsMenu.tsx`, `Composer.tsx`, `ReplyQuote.tsx`, `index.css`, `docs/design/ui-style.md` (D24)
- `apps/server/src/agents/gateway.ts`: `handleIncoming` and `handleRoomIncoming`

### Allowed files
- `packages/xmpp-core/src/stanza.ts`, `types.ts`, `client.ts`, `namespaces.ts`, `index.ts`, plus tests
- `packages/chat-core/src/types.ts`, `index.ts`, and a new `packages/chat-core/src/edits.ts` plus its test (the pure edit/retract reducer), if you want it there. That's recommended.
- `apps/web/src/store/realStore.ts`, `store.ts`, the mock store files, plus tests
- `apps/web/src/components/MessageBubble.tsx`, `MessageActionsMenu.tsx`, `Composer.tsx`, `ReplyQuote.tsx`, a new `EditBar.tsx`, a new `ConfirmDialog.tsx` if none exists, their tests, and `apps/web/src/index.css`
- `apps/web/src/routes/ChatView.tsx` (wiring only)
- `apps/web/src/mock/**`
- `apps/server/src/agents/gateway.ts` and `gateway.test.ts`: **only** the guard described below
- `work/T-0061-edit-delete-web.md` and `work/screenshots/T-0061/**`

**Not allowed:** mobile, docs, the server beyond the gateway guard.

### What to build

1. **xmpp-core.**
   - `sendCorrection(chatJid, kind, originalId, text, options)` returns the new id. `options` carries mentions, like `sendMessage` does.
   - `sendRetraction(chatJid, kind, targetId)`.
   - Parse:
     - `ChatMessage.correction?: { targetId: string }`, with `body` holding the new text;
     - `ChatMessage.retraction?: { targetId: string }`. When a retraction is present, drop the fallback body: `body` is undefined.
   - Carbons and MAM go through the same parse.
2. **Gateway guard (server).**
   - `handleIncoming` and `handleRoomIncoming` return early when `message.correction` or `message.retraction` is set, before any other work.
   - Two tests: an edit to the AI in a DM and a retraction in a room start no turn.
   - The AI re-answering edits is out of scope.
3. **Reducer** (pure, tested).
   - It applies corrections and retractions with the order, authorization and pending rules above.
   - Pending: history pages can hold a correction or retraction for a message that isn't loaded yet. Keep it until the target loads, as with reactions.
4. **Store.**
   - `UiMessage.edited?: boolean` and `UiMessage.deleted?: boolean`. A deleted message has no text, payload or reactions.
   - Correction and retraction stanzas **never render as bubbles**.
   - The chat list preview follows: an edited last message shows the new text; a deleted one shows "Message deleted".
   - A reply quote pointing at an edited message shows the new text; at a deleted one, "Deleted message".
   - `editMessage(chatId, messageId, text)` and `deleteForEveryone(chatId, messageId)` are optimistic and revert on a send error, with an inline error the way `sendText` shows one.
5. **UI.**
   - **Actions menu:** Edit (my own text messages under 48 h) and "Delete for everyone" (my own messages). Delete uses the danger style and sits last, below T-0059's quick bar, Reply and Copy.
   - **Edit mode:**
     - the composer shows an **edit bar**, like the reply bar: a pencil, "Edit message" and the original text truncated, with a close key;
     - the composer is prefilled with the text and the caret at the end;
     - Enter saves and Esc or close cancels;
     - an edit that doesn't change the text sends nothing;
     - an empty edit is not allowed: the send key is disabled.
     - Edit and reply are exclusive: starting one cancels the other.
   - **↑ in an empty composer** edits my last editable message, as in Telegram.
   - **Delete:** a confirm dialog titled "Delete message?" with the body "This deletes it for everyone in the chat." and the keys Cancel and **Delete** (danger). Esc cancels. Focus is trapped and returns to the bubble's ⋯ key or the composer.
   - **Bubbles:**
     - an edited message shows "edited" before the time in the meta row, in the same muted style;
     - a deleted message becomes a slim tombstone bubble with an italic muted line: "You deleted this message" (mine) or "This message was deleted" (theirs). It has no actions: the menu doesn't open. It keeps its place, and grouping still works.
   - The generating AI draft has no Edit or Delete.

### Tests (Vitest and Testing Library, no network)
- **xmpp-core:**
  - build a correction (the replace id, the new body, mentions);
  - build a retraction (the fallback, the store hint, the group stanza-id target);
  - parse both, including through carbons and MAM;
  - a retraction's fallback body is dropped.
- **Reducer:**
  - latest correction wins;
  - a retraction wins over a later correction;
  - a foreign sender is ignored (DM and group, including the occupant-id and nick fallbacks);
  - pending before the target, then the target loads;
  - duplicates.
- **Store:**
  - edit and delete, live and optimistic, with a revert on error;
  - history with a correction or retraction before and after the target;
  - the stanzas never render as bubbles;
  - the preview and reply quote update;
  - a group target by stanza-id.
- **UI:**
  - Edit is only shown on my own text messages under 48 h;
  - the edit bar flow (prefill, Enter saves, Esc cancels, no-op unchanged);
  - ↑ edits my last message;
  - the confirm dialog (Esc, Delete);
  - the tombstone and "edited" label;
  - no menu on a tombstone.
- **Gateway:** the two guard tests.

### Visual check
Mock mode. Add mock messages that are edited and deleted (mine and theirs) in a DM and a group. Take these screenshots:
- the menu with Edit and Delete;
- the edit bar active;
- the "edited" labels;
- both tombstones;
- the confirm dialog.

Take them at 1440×900 and 390×844 and put them in `work/screenshots/T-0061/`. Look at them. **Stop any dev server you start.** Use `localhost`, not `127.0.0.1`: Vite binds `::1`. Never use ports 3000, 3188, 5173 or 8081.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/xmpp-core --filter=@galena/chat-core --filter=@galena/web --filter=@galena/server
pnpm build
```

### Out of scope
- Scrubbing retracted messages from ejabberd's MAM (a follow-up: moderation or a retraction-aware archive).
- Delete for me.
- Edit history.
- Mobile.
- The AI re-answering edited messages.
- Admins deleting other people's messages (XEP-0425 moderation).

## Report (written by the worker when done)

## Review (written by Claude)
