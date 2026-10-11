---
id: T-1099
title: "Web bug: New topic from a group header's + fails ('Could not create the topic', blank group name): the header passes the group id where the dialog expects a chat id"
status: todo
milestone: M5
branch: task/T-1099-web-new-topic-from-group-header
model: auto
effort: default
depends_on: [T-1096]
estimate: 0.2 day
---

# T-1099: New topic from the group header

## Spec (written by Claude, do not edit)

### Why
**What the lead saw, 2026-10-11** (`?mock=1` on main, and on `93aa01e4`, before T-1090, so it is older than tonight):
- in the chat list, click the **+** next to "Familia" ("New topic in Familia");
- the dialog's subtitle reads "in the group" with **no group name**;
- type a name, then click Create topic;
- the result is "Could not create the topic. Try again.".

The mock backend itself creates the topic: `POST /api/groups/:groupId/topics` with `g-familia` answers 201.

**What the lead read:**
- `apps/web/src/components/TopicRow.tsx:277` calls `onOpenNewTopic(groupId)`. That id is `group.groupId`, the **server group id** (`apps/web/src/store/chatGroups.ts:75`, filled from `chat.groupId` at `:50-53`), and it is passed through `apps/web/src/components/chatList/ChatListBody.tsx:130` and `apps/web/src/components/ChatList.tsx:177,183`.
- `apps/web/src/components/NewTopicDialog.tsx:61-62` documents its prop as "The group's chat id (a topic row id or the legacy group id)". At `:76` it looks it up with `s.chats.find((entry) => entry.id === groupId)`, so for a group id it finds nothing.
- `:139` calls `storeApi.getState().createTopic(groupId, …)`. The store's `createTopic` (`apps/web/src/store/effects/topics.ts:34-51`) resolves the group through `groupIdOf(ctx, chatId)` (`apps/web/src/store/effects/groupShared.ts:21-22`), which also looks for a chat row with that id.
- `apps/web/src/components/NewChatButton.tsx:193` opens the same dialog with `topicGroupId`.

### What to build
1. **Confirm the root cause.** Use a throwaway probe or the browser on `?mock=1`, and find which step fails.
   - Say in the Report whether the **real** app takes the same path. On the server, `GET /api/chats` group entries carry `groupId` and their topic rows (read `apps/server/src/chats/` and `packages/api-contract/src/chats.ts`).
   - Say whether `NewChatButton`'s path works, and what id it passes.
2. **Fix it with the smallest change.** Two candidates:
   - the header passes a chat id the dialog and store already understand (for example the group's General topic row id, which every group now has since T-1090 and on the server);
   - or the dialog and `createTopic` accept a group id explicitly (resolve the group's title through `chatGroups`/`groupInfo`, and call the API with the group id).

   Pick one, explain why in the Report, and keep the other caller (`NewChatButton`) working.
3. **After the fix,** on `?mock=1`:
   - the dialog's subtitle shows "in Familia";
   - creating "Night check" in Familia succeeds and opens the new topic;
   - the topic is listed under Familia;
   - Dev team works too.

   Describe what you saw in the Report. A browser is optional; a probe against the store is fine.
4. **No new tests:** this is UI, not one of the crucial areas. Every file stays at most 400 lines.

### Read first
`AGENTS.md` and the files cited above.

### Allowed files
`apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/store/effects/topics.ts`, `apps/web/src/store/effects/groupShared.ts`, `apps/web/src/store/chatGroups.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `work/T-1099-web-new-topic-from-group-header.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report states the root cause and whether the real app is affected.
- The lead's browser check on `?mock=1` passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
