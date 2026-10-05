---
id: T-0061
title: Edit and delete for everyone (web) — XEP-0308 corrections, XEP-0424 retractions, an edit bar, "edited" labels and tombstones; the gateway ignores both
status: merged
milestone: M1
branch: task/T-0061-edit-delete-web
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0059]
estimate: 1.5 days
---

# T-0061: Edit and delete for everyone (web)

## Spec (written by Claude, do not edit)

### Goal

The MVP list (`docs/PROJECT_PLAN.md` §21) has message edit and delete, and the web has neither. Add messenger-style editing and delete-for-everyone to DMs and groups. Both must survive reloads: they come back from MAM history, just like T-0059's reactions.

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
   - **↑ in an empty composer** edits my last editable message, as in most messengers.
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
pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/chat-core --filter=@zilar/web --filter=@zilar/server
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

### Summary

XEP-0308 corrections and XEP-0424 retractions end to end: build/parse in
`xmpp-core` (with `originId` on every message and a fallback body), a pure
reducer in `chat-core` (`edits.ts`), the store plumbing (live, MAM history,
optimistic with revert, alias-aware targets, pending before the target loads),
and the UI (actions menu Edit / Delete for everyone, an edit bar, a confirm
dialog, "edited" labels, tombstones, the preview and reply quotes, ↑ to edit my
last message). The server gateway ignores both kinds of stanza. All Checks pass.

### What I did

**1. xmpp-core.**
- `namespaces.ts`: `CORRECTION_NAMESPACE` (`urn:xmpp:message-correct:0`),
  `RETRACTION_NAMESPACE` (`urn:xmpp:message-retract:1`),
  `FALLBACK_NAMESPACE` (`urn:xmpp:fallback:0`).
- `types.ts`: `ChatMessage.correction?: MessageCorrection`,
  `ChatMessage.retraction?: MessageRetraction` and `ChatMessage.originId?: string`;
  `XmppCore.sendCorrection(chatJid, kind, originalId, text, options?)` returns
  the new id, and `XmppCore.sendRetraction(chatJid, kind, targetId)`.
- `stanza.ts`: `buildCorrection` (body + `<replace id=ORIGINAL>` + rebuilt
  XEP-0372 mentions), `buildRetraction` (`<retract>`, `<fallback for=…>`, the
  fallback body constant, `<store/>`), `parseCorrection`, `parseRetraction`,
  `originIdOf` (prefers `<origin-id/>`, else the stanza `id`). The decoder drops
  a retraction's fallback body, emits corrections/retractions as messages
  (so carbons and MAM go through one parse) and sets `originId`.
- `client.ts`: `sendCorrection`/`sendRetraction` require a live connection.

**2. Gateway guard.** `handleIncoming` and `handleRoomIncoming` return before
any routing/pairing/database work when `message.correction` or
`message.retraction` is set. Two tests: an edit in the owner's DM and a
retraction in a room (with a body and an @mention) start no turn.

**3. Reducer (`packages/chat-core/src/edits.ts`).** Pure and tested:
`applyEdit` (latest correction in stanza order wins; a retraction is sticky and
beats later corrections), `resolveEdits` (pending updates applied once the
target's author is known), `editsFor`, `mergeEdits`, `isSameAuthor` (DMs: bare
JID; groups: real JID when both resolved, else occupant-id, else nick), plus the
sender-side truth tables `canEditMessage` (my own text, under 48 h) and
`canDeleteMessage`.

**4. Store.** `ChatStoreState.edits` keyed by the alias-resolved target id,
exactly like reactions. Corrections/retractions are ingested and returned before
rendering, from live messages and from every history page (preview, first page,
older pages); the target's author is remembered per message id and pending
updates resolve when the target loads. `withEdits` rewrites the stored message
(new text + mentions, or a tombstone with no text/payload/reactions/mentions);
`refreshEdits` follows reply quotes ("Deleted message") and the chat-list
preview ("Message deleted"). `editMessage` / `deleteForEveryone` are optimistic
and revert on a send error (snapshot restore), with an inline error. Wire
targets: a correction names the origin id (XEP-0308, DMs and groups); a
retraction names the origin id in a DM and the stanza-id in a group (XEP-0424).

**How I resolved originId (the spec asked me to say).** The parser sets
`ChatMessage.originId` (stanza `id` or `<origin-id/>`). The store links it to
the message id with `linkMessageIds(originId, id)`, so it is a real alias in the
same map `sameMessage`/`aliasRoot` use. A correction always arrives keyed by the
origin id and resolves against a message stored under its archive stanza-id. I
also keep a small `messageOriginIds` side map to name the wire target when I
edit or retract my own message.

**5. UI.** `MessageActionsMenu` gained Edit (only when allowed) above Copy and a
danger "Delete for everyone" last; `MessageBubble` opens a `ConfirmDialog`
("Delete message?" / "This deletes it for everyone in the chat." / Cancel,
Delete; Esc and focus trap, focus returns to the ⋯ key), renders "edited"
before the time, and renders a slim `tombstone` bubble ("You deleted this
message" / "This message was deleted") with no ⋯ key and no context menu. The
new `EditBar` sits where the reply bar does; the composer prefills the text with
the caret at the end, Enter saves, Esc/× cancels, an unchanged edit sends
nothing and an empty edit disables the save key. ↑ on an empty composer starts
editing my last editable message. Edit and reply are exclusive (ChatView clears
the reply when an edit starts; starting a reply cancels the edit).

**6. Mock.** `c-ana` (DM) and `c-viernes` (group) seed an edited message, both
tombstones and reply quotes that point at an edited ("new text") and a deleted
("Deleted message") message; the mock store has working `editMessage` /
`deleteForEveryone` so the screenshots are interactive.

### Files changed (all Allowed)

Modified: `packages/xmpp-core/src/{namespaces,types,stanza,client,index}.ts`,
`packages/xmpp-core/src/{stanza,core}.test.ts`,
`packages/chat-core/src/{types,index}.ts`,
`apps/web/src/store/{store,realStore}.ts`, `apps/web/src/store/realStore.test.tsx`,
`apps/web/src/components/{MessageBubble,MessageActionsMenu,Composer}.tsx`,
`apps/web/src/components/{MessageActions,Composer}.test.tsx`,
`apps/web/src/routes/ChatView.tsx`, `apps/web/src/index.css`,
`apps/web/src/mock/messages.ts`, `apps/server/src/agents/{gateway,gateway.test}.ts`,
`work/T-0061-edit-delete-web.md`.

New: `packages/chat-core/src/edits.ts`, `packages/chat-core/src/edits.test.ts`,
`apps/web/src/components/EditBar.tsx`, `apps/web/src/components/ConfirmDialog.tsx`,
`work/screenshots/T-0061/*.png` (12).

### Commands (real results)

```bash
pnpm install       # 1010 packages, done in 6.3s
pnpm format:check  # All matched files use Prettier code style!
pnpm lint          # oxlint ., exit 0, no findings
pnpm typecheck     # 9 successful, 9 total
pnpm exec turbo test --force --filter=@zilar/xmpp-core --filter=@zilar/chat-core --filter=@zilar/web --filter=@zilar/server
                   # xmpp-core 158 passed | 3 skipped; chat-core 133 passed;
                   # web 325 passed; server 494 passed | 7 skipped; 4 tasks successful
pnpm build         # 2 successful, 2 total (@zilar/web, @zilar/mobile)
```

### Visual check (mock mode, `?mock=1`)

A throwaway Node server (in the approved temp dir, not committed) answered
`/api/auth/get-session`; `ZILAR_API_URL` pointed Vite at it, and this worktree's
Vite ran on `localhost:5250`. Both were stopped afterwards. Twelve PNGs at
1440×900 and 390×844 are in `work/screenshots/T-0061/`:

- `group-menu-1440x900.png` / `group-menu-390x844.png` — the actions menu with
  the quick bar, Reply, **Edit**, Copy text and danger **Delete for everyone**.
- `group-edit-bar-1440x900.png` / `group-edit-bar-390x844.png` — the edit bar
  (pencil, "Edit message", the original text) and the prefilled composer.
- `group-confirm-1440x900.png` / `group-confirm-390x844.png` — "Delete message?"
  with Cancel/Delete.
- `edited-label-1440x900.png` / `edited-label-390x844.png` — the muted "edited"
  before the time.
- `tombstones-1440x900.png` / `tombstones-390x844.png` — both tombstones
  (theirs and mine).
- `dm-edited-tombstones-1440x900.png` / `dm-edited-tombstones-390x844.png` — the
  Ana DM: an edited message, both tombstones, a reply quote showing the corrected
  text and one showing "Deleted message".

I looked at each one; the layouts hold at both sizes and nothing clips.

### Deviations / notes

- **Preview string.** `chat-core`'s `previewBody` (in `messages.ts`) is not in
  Allowed files, so the "Message deleted" preview is produced in the stores
  instead: the real store keeps a display copy on `chats.lastMessage`
  (the message itself stays text-less), and the mock store does the same. The
  edited preview needs nothing (the text is already the corrected one).
- **Baseline typecheck was already red.** At HEAD, `FakeCore` in
  `apps/server/src/agents/gateway.test.ts` was missing `sendReactions`
  (T-0059 merged `XmppCore.sendReactions` but not the fake), so `pnpm typecheck`
  failed before my change. I added the three no-op stubs
  (`sendReactions`/`sendCorrection`/`sendRetraction`) plus the two guard tests;
  the file's Allowed scope is the guard, so this is the one extra edit there.
- **Inline error.** There was no existing inline error for `sendText`; I added
  `actionError` on the store, shown as a `role="alert"` line above the composer
  when an edit or delete fails to send. The optimistic change is reverted.
- **Esc on the edit bar** stops propagation so it cancels the edit instead of
  also closing the chat on a narrow layout (the reply bar's Esc predates this
  and still closes the chat; I left it alone).
- **Unacked group message.** A group retraction needs the stanza-id, which only
  arrives with the MUC echo; deleting a still-`local-*` message is a no-op (no
  wrong target is ever sent). Edits use the origin id and work once the send
  promise resolves.
- Edit availability is the UI's 48 h rule plus "my own text message"; the store
  re-checks the same rules before sending.

## Review (written by Claude)

**Verdict:** Approved.

**Approved and merged by Claude.** Verified in the worktree: every changed path is inside Allowed files; `format:check`, `lint`, `typecheck`, `test` and `build` pass (web 325, xmpp-core 158 + 3 skipped, chat-core 133, server 494 + 7 skipped). The Muse pre-review found no must-fix or should-fix issues and re-ran the checks with the same numbers.

**Live check (lead, against the dev ejabberd, throwaway users and room):** I added a gated test, `packages/xmpp-core/src/integration-edits.test.ts` (`ZILAR_XMPP_INTEGRATION=1`), and it passes. In a DM and in a group: a correction arrives with the new body and the original's id, from the same sender/occupant; a retraction arrives with no fallback body (in the group it targets the room's stanza-id, read from history); and MAM replays both the corrections and the retractions to a client that connects later. This is the protocol truth that fakes cannot prove (playbook gotcha 19).

Receiver-side authorization (`edits.ts` `isSameAuthor`): bare JID in DMs; real JID, else occupant-id, else nick in groups; a retraction wins for good. Read the code and the tests (foreign sender rejected in DM and group).

### Findings
1. *(No change needed.)* `Composer.tsx` `editLastMessage` uses wall-clock `new Date()` for the 48 h window while the store uses the injectable `now()`. No production effect; accepted.
2. *(No change needed.)* `editMessage` relies on the Composer calling `cancelEdit()` afterwards. Accepted; revisit if a second caller appears.
3. *(No change needed.)* The nick fallback in groups (no real JID and no occupant-id) is weaker than the other two, but only applies when neither is known, in members-only rooms.

### Follow-ups
- Mobile edit/delete (xmpp-core now has `sendCorrection`/`sendRetraction`): a new task.
- Julio should try edit and delete once in his real chats (Helium) when he is up; the server gateway guard needs the restart I do right after this merge.
