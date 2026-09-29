---
id: T-0114
title: Pinned messages in chats, groups and topics (server + web)
status: planned
milestone: M5
branch: task/T-0114-pinned-messages
model: meta/muse-spark-1.3-contributor
depends_on: [T-0108]
estimate: 1.5 days
---

# T-0114: Pinned messages

## Spec (written by Claude, do not edit)

### Why
D28 (Telegram basics). A topic like "Release 2.4" or "General" needs the important message kept at the top, as in Telegram: a slim banner under the header, click to jump to it, a list of all pins.

### Data and API (server)
- Table `pinned_messages`: `id`, `chat_jid` (the room JID or the DM's JID pair key; for DMs store the **canonical pair** `min(jidA,jidB)|max(jidA,jidB)` so both people share one list), `message_id` (the identifier the clients already use to target corrections, retractions and reactions: T-0059/T-0061; use the same one), `sender_name` (snapshot, ≤ 80), `text` (snapshot, ≤ 300 chars; empty for attachments, then `kind` says `image` | `file` | `voice` | `card`), `kind`, `pinned_by` (fk user), `pinned_at`. Unique `(chat_jid, message_id)`. Max 20 per chat (400 `pin_limit`). Migration only via `pnpm --filter @galena/server db:generate`.
- **Who may pin/unpin:** DM: either person. Group topic (incl. General): a group owner/admin **who can see the topic** (`canSeeTopic`), or the topic creator; plain members may not (they can still read pins). Anyone else gets the same 404 as for an unknown chat.
- Routes: `GET /api/pins?chat=<jid>` (visible chats only; newest first), `POST /api/pins` `{ chat, messageId, senderName, text, kind }` (validated with zod; the server trusts only the snapshot for display, never for authorization), `DELETE /api/pins/:id`. Rate limit 60 writes/min/user. Audit `message.pinned` / `message.unpinned` with ids only (**no snapshot text**; for private topics no topic name).
- Snapshots exist because the clients may not have the message loaded; a retracted original is shown as "Message deleted" by the client when it learns of the retraction, and a manager can unpin it.

### Web (`apps/web`)
- `lib/api.ts` + store: load pins when a chat opens, on focus, and every 60 s while it is open (no realtime channel yet; say so in the Report); optimistic pin/unpin.
- **Pinned banner** (new `PinnedBanner.tsx`) under the header (and under the task strip for topics): a 2-line-max raised well with the sender, the text or a kind label, a "1 of N" cycle indicator when there are several (click cycles; a "list" button opens the pins panel). Clicking the text scrolls to the message when it is loaded, otherwise loads history around it (the existing MAM/history loader) and scrolls; if that fails show "Message not found" inline.
- **Message actions menu** (`MessageActionsMenu.tsx`): Pin / Unpin for those allowed.
- **Pins panel**: list with jump and (for managers) unpin; reachable from the banner and from the chat/topic info panels.
- The pin snapshot text goes through the same safe-text renderer as messages (no HTML, safe links).
- Mock mode keeps pins in memory.

### Read first
- `AGENTS.md`; `work/T-0108-topics-server.md` (access helpers), `work/T-0059`, `T-0061` (message ids)
- `apps/server/src/topics/access.ts`, `rate-limit.ts`, `authz-sweep.test.ts`; `apps/web/src/components/{MessageActionsMenu,MessageList,ChatHeader}.tsx`, `store/realStore.ts` (history loading), `docs/design/ui-style.md`

### Allowed files
- `apps/server/src/pins/**` (new), `apps/server/src/db/schema.ts` + migration, `apps/server/src/app.ts`, `authz-sweep.test.ts`, `apps/server/src/audit/**` (names)
- `apps/web/src/**` (components, lib, store, mock, tests)
- `work/T-0114-pinned-messages.md`

**Not allowed:** mobile, packages, dependencies.

### Tests
- Server: permissions (DM both sides, topic admin who can see it, plain member 403/404, stranger 404), limits, unique pin, snapshot validation (size, control characters), audit without text, sweep.
- Web: banner cycling, jump (loaded and not loaded), unpin, permission gating of the menu items, polling refresh, safe rendering of hostile snapshot text, mock mode.

### Acceptance criteria
- [ ] A pin is visible only to people who can see the chat/topic; only allowed people pin.
- [ ] Jumping to a pinned message works even when it is far back in history.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; full suites once at the end, `--maxWorkers=2`)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```

### Out of scope
- Realtime pin updates over XMPP, a "X pinned a message" system line, mobile UI, unread-mention logic, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
