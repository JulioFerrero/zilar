---
id: T-1355
title: "A channel created on web shows as a group with topics (list row '1 topic' + General, task strip 'Open · No owner · Add link') instead of a channel (megaphone, 'N subscribers', no topics): find where the channel kind is lost and fix it on web and mobile"
status: todo
milestone: M5
branch: task/T-1355-channel-shows-as-group
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1355: New channel shows as a group

## Spec (written by Claude, do not edit)

### Why
The lead's live check, 2026-10-14. On chat.zilar.app, as @claude_test: New chat → New channel → added 2 members → name "Zilar Updates", Private → Create. The new chat's id is `gigpdbu5lfkxmgipf@rooms.chat.zilar.app`.
- **What's wrong:**
  - the chat list shows "Zilar Updates" as a **group**: an expander, "1 topic", and a child topic row "General";
  - the chat header reads "Zilar Updates › General";
  - the group **task strip** shows (GENERAL · Open · No owner · Add link).
- **What's right:** the header subtitle does say "3 subscribers".
- **The expected channel look** (the mock's "Acme Announcements"): a megaphone badge, "N subscribers" in the row, no topics and no task strip, as a channel row (`apps/web/src/components/ChatListItem.tsx:92-96`, `isChannel = chat.chatKind === 'channel'`).

**What the lead read:**
- the server sends `chatKind: group.kind` in the chat list (`apps/server/src/chats/api.ts:75`, `:212`);
- the client type is `chatKind?: 'group' | 'channel'` (`packages/chat-core/src/types.ts:198`);
- labels branch on it (`packages/chat-core/src/chat-labels.ts:30`) and folders do too (`packages/chat-core/src/folders.ts:53`).

So either the server stores or answers this channel as `group`, or the chat list and topic code (topics: `apps/server/src/topics`) attach a General topic to every room, including channels, and the client then renders the parent as a topic group.

### What to do
1. **Reproduce in the mock or a test:** create a channel through the same code path the web New channel flow uses (find it from `apps/web/src/components/NewChatButton.tsx`), then cite every step:
   - the API call;
   - the server handler (`apps/server/src/groups` and/or `apps/server/src/topics`);
   - what's stored (`kind`);
   - what `GET` chats returns;
   - how the web list builds a topic tree.
   - Say exactly where "channel" is lost or where the topic is wrongly added.
2. **Fix it at the source,** so a channel has no topics and renders as a channel on web **and mobile** (check `apps/mobile/src/components/chat` for the list row and header).
3. **Existing channels:** if `Zilar Updates` already has a General topic row stored on the server, the fix must make it render as a channel too. Prefer render logic or a read-time rule over a data migration. If a migration is truly needed, write it as a hand-written SQL migration and say so.
4. **Tests:** one server test is allowed (the message pipeline and permissions area): creating a channel stores `kind = 'channel'`, and the chat list answers `chatKind: 'channel'` with no topics. **No UI tests.** Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/chats/api.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/NewChatButton.tsx`, `packages/chat-core/src/chat-labels.ts`, `packages/chat-core/src/types.ts`.

### Allowed files
`apps/server/src/groups/**/*.ts`, `apps/server/src/topics/**/*.ts`, `apps/server/src/chats/**/*.ts`, `apps/server/drizzle/*.sql`, `apps/server/src/db/rows.ts`, `packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/chatList/*.tsx`, `apps/web/src/components/chatList/*.ts`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `packages/mock-backend/src/**/*.ts`, `work/T-1355-channel-shows-as-group.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live check after the deploy:** "Zilar Updates" renders as a channel on web (megaphone, subscribers, no topics or strip), and on the Android build.

---

## Report (written by the worker when done)

## Review (written by Claude)
