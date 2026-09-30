---
id: T-0114
title: Pinned messages in chats, groups and topics (server + web)
status: merged
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
- Server (`apps/server/src/pins/`): `access.ts` (chat resolution + permissions), `service.ts` (list/pin/unpin + audit), `routes.ts` (`GET /api/pins?chat=`, `POST /api/pins`, `DELETE /api/pins/:id`, 60 writes/min/user limiter), mounted in `app.ts`. Schema `pinned_messages` + migration `0025_married_hobgoblin.sql` via `db:generate`.
  - DMs: canonical pair key `min|max` so both sides share one list; either side may pin. Rooms: stored bare JID; read needs `canSeeTopic`, write needs creator or owner/admin who can see it (plain members 403, strangers 404).
  - Snapshots validated (sender ≤ 80, text ≤ 300, no control chars, attachment kinds carry no text); unique `(chat_jid, message_id)` → 409 `pin_exists`; 20-pin cap → 400 `pin_limit`. Audit `message.pinned`/`message.unpinned` with ids only (`pinId`, `chatJid`, `messageId`); private-topic pins carry no `groupId` so they never surface in group activity.
- Web: `lib/api.ts` pins client; `mock/api.ts` in-memory pins (+2 seeds); store interface + mock-store impl + real-store impl (load on open, focus + 60 s poll while open, optimistic pin/unpin with rollback, `pinsError`); `PinnedBanner.tsx` (sender + LinkText snapshot or kind label, 1-of-N cycling, jump via `openAtMessage` + scroll, "Message not found" inline); `PinsPanel.tsx` (+ `PinsSection` row); Pin/Unpin in `MessageActionsMenu`/`MessageBubble` gated by `canPin` (DMs anyone, topics owner/admin); panel wired in `ChatView` (banner under header/task strip) and reachable from banner List, header menu, TopicPanel and GroupPanel.
  - No realtime channel (polling only), as specced; said here.
- Tests: server `pins.test.ts` (8: DM sharing, topic manager/member/stranger, creator edge, private-topic invisibility, dup/cap/validation, audit shape, rate limit, auth/404); web `PinnedMessages.test.tsx` (13: banner, cycling, jump loaded/missing, kind label, pin/unpin menu, DM/topic gating, hostile snapshot, panel jump/unpin + member gating, tombstone, failure inline, mock API); realStore pins (4: load on open, focus + 60 s refresh, optimistic + rollback, gating).

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0025_married_hobgoblin.sql` (+ meta journal/snapshot)
- `apps/server/src/pins/access.ts`, `service.ts`, `routes.ts`, `pins.test.ts` (new)
- `apps/server/src/app.ts` (mount)
- `apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`
- `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `realStore.test.tsx`, `realStore.topics.test.tsx`, `reload.test.tsx` (fake-API pins stubs)
- `apps/web/src/components/PinnedBanner.tsx`, `PinsPanel.tsx` (new), `MessageActionsMenu.tsx`, `MessageBubble.tsx`, `ChatHeader.tsx`, `GroupPanel.tsx`, `TopicPanel.tsx`, `PinnedMessages.test.tsx` (new)
- `apps/web/src/routes/ChatView.tsx`
- `work/T-0114-pinned-messages.md`

### Commands run and real results
- `pnpm install`: up to date (969 ms)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean)
- `pnpm typecheck`: pass (10/10 turbo tasks)
- `pnpm --filter @galena/server test --maxWorkers=2`: 80 files passed, 5 skipped; 1375 passed, 7 skipped (~279 s)
- `pnpm --filter @galena/server test --maxWorkers=2 src/pins/pins.test.ts` (round 2): 10 passed
- `pnpm --filter @galena/web test --maxWorkers=2`: 70 files passed; 759 passed
- `pnpm --filter @galena/web test --maxWorkers=2` (round 2): 70 files passed; 760 passed
- `pnpm build`: pass (2/2)
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any` in touched files: no hits (one false positive: the word "anyone" in a test name)

### Problems, deviations from the spec, open questions
- Client gating is owner/admin for topics; the topic-creator-who-is-a-plain-member edge is server-enforced only (the menu hides for them because `createdBy` is not exposed on `TopicView`, which I may not change). Noted, not blocked.
- Unpin echoes the deleted row (DELETE returns the pin), so the panel can animate/remove without a refetch; the store still reconciles on next poll.
- Mock pins key by client chat id (no JID access model in mock); seeds: one text pin in the Ana DM, one photo pin in Viernes.
- Raw BEL byte briefly landed in `pins.test.ts` from my editor; replaced with `\u0007` escape (file is ASCII, verified with `file`).
- No new dependencies. No realtime XMPP pin updates (out of scope, polling instead).

### Round 2 (review fixes)
- Finding 1 (MUST): pin text now allows `\t`/`\n` like message bodies (new `allowWhitespace` flag on the control-char check; sender names stay strict). Server test pins a 3-line message and reads it back; client test pins a 3-line bubble and asserts every line in the banner.
- Finding 2: the creator/admin test now proves its case — `other` is promoted to group admin via a direct row update (groups.test.ts precedent) so the 404s assert the admin-who-cannot-see path, and `topics.createdBy` is rewritten to the plain member (simulating a post-creation demotion, which T-0116 will do via API) so the 201 asserts the `createdBy` branch itself.
- Finding 3: count + insert run in one transaction under `pg_advisory_xact_lock(hashtext(chatJid))`; new concurrent test fires 25 parallel pins and asserts exactly 20 × 201, 5 × 400, 20 rows. Migration untouched (no schema change).
- Finding 4: panel unpin buttons disable per row (`unpinningId === pin.id`).
- Finding 5: removed the duplicated `expect(attachment.status).toBe(201)` line.
- Pre-review packet `PREREVIEW.md` read and deleted.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** merged after two fix rounds and a lead fix.

### Findings
- Server access is sound (read twice): DM pair key, stranger and unknown chat share one 404, unpin re-resolves visibility, private-topic pins carry no groupId in audit, audit detail has ids only, 20-cap is atomic (advisory lock) with a 25-parallel test.
- Fixed by the worker: multi-line snapshots (\n, \t) rejected; creator test proved the wrong thing; unpin disabled every row.
- Fixed by me: unpin echoed the stored pair key in `chat`; it now echoes the peer JID (test added).
- Accepted: the snapshot text and sender name are client-supplied and display-only; a pin manager could word a snapshot differently from the message, inside a chat they already belong to. Plain-member topic creators cannot pin from the UI (server allows it).
- Not live-checked: UI verified by tests and mock mode only.

### Follow-ups
- Unify the 404 message for a missing pin ("Pin not found" vs "Chat not found") if pin ids ever become guessable (they are UUIDs).
- Spec Checks line: `turbo test` does not accept `--maxWorkers`; run per-package.
