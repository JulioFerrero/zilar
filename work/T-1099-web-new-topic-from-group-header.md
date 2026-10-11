---
id: T-1099
title: "Web bug: New topic from a group header's + fails ('Could not create the topic', blank group name): the header passes the group id where the dialog expects a chat id"
status: merged
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

### Root cause (confirmed)
`GroupHeaderRow`'s `+` passed `group.groupId`, the **server group id** (`g-familia`), through `ChatListBody`/`ChatList` to `NewTopicDialog`. The dialog and the store both key on a **chat row id** (a topic row's `chatJid`), not the server group id:

- `NewTopicDialog` looks the row up with `s.chats.find((entry) => entry.id === groupId)` — no row has id `g-familia`, so the subtitle falls back to "the group".
- `store.createTopic` → core `createTopic` (`packages/client-core/src/store/group-actions.ts:87-91`) finds no row and `groupIdFor(chatId)` = `ctx.groupIds.get('g-familia')` is `undefined` (that map is keyed by row id), so it fails with "This group is not available yet." before any POST. `NewTopicDialog` maps that to "Could not create the topic. Try again." The mock backend never receives the request, which is why its 201 on `/api/groups/g-familia/topics` is irrelevant.

### Is the real app affected?
**Yes, identically.** `GET /api/chats` group entries carry `groupId` and their topic rows (`apps/server/src/chats/api.ts:126-163`, `packages/api-contract/src/chats.ts:41`), and each topic row's id is its room JID from `toTopicViews` (`apps/server/src/topics/access.ts:366`), never the server group id. So on the real server the header passes the same unresolvable id through the same dialog and store path — same blank subtitle, same failure.

### Does NewChatButton's path work?
**Yes.** `NewChatButton` builds `topicGroups` from `chat.id` (`apps/web/src/components/NewChatButton.tsx:73-101`), which is a chat row id (the group's first row). Its call to `NewTopicDialog` therefore resolves a real row and the group, and it is unchanged by this fix.

### Fix (candidate 1, the header passes a chat id)
In `GroupHeaderRow` the `+` now passes the group's **General topic row id** (`topics.find((t) => t.topic?.isGeneral === true) ?? topics[0]`, falling back to the first row for a legacy group). Every group has a General topic since T-1090 and on the server, and General's `chatJid` is the group's room JID (`apps/server/src/topics/access.ts:366`), which is exactly the row id the dialog and the store already understand:
- the dialog finds the row → `chat.groupTitle` gives the "in Familia" subtitle, and `refreshGroupInfo(rowId)`/`groupInfo(rowId)` now load (since `groupIds.get(rowId) = g-familia`);
- the core resolves `groupId = g-familia` and POSTs to the right route.

Why this candidate and not the other: it is the smallest possible change (one caller), it keeps both `NewTopicDialog` (already documented as taking a chat id) and the store untouched, and it keeps `NewChatButton` working (it already passes a row id). The alternative — the dialog and `createTopic` accepting a group id — would require changing the shared core `createTopic` in `packages/client-core`, which is **outside the Allowed files**, or duplicating group-id resolution in web.

### Files changed
- `apps/web/src/components/TopicRow.tsx` — `GroupHeaderRow`'s `+` passes the General topic row id; `onOpenNewTopic` parameter renamed `groupId` → `chatId` (comment added).
- `apps/web/src/components/chatList/ChatListBody.tsx` — `onOpenNewTopic` prop type `(chatId: string)` (name only).
- `apps/web/src/components/ChatList.tsx` — state renamed `newTopicGroup`/`setNewTopicGroup` → `newTopicChatId`/`setNewTopicChatId` (name only, holds a chat id now).
- `work/T-1099-web-new-topic-from-group-header.md` — this Report + status.

`NewTopicDialog.tsx` and the store files needed no change: the dialog already documents its `groupId` prop as "The group's chat id (a topic row id or the legacy group id)" and the store already resolves a chat row id.

### Commands run (real results)
- `pnpm install` — done, 16 workspace projects, 0 errors.
- Throwaway store probe (temp file `apps/web/src/store/t1099.probe.test.tsx`, deleted before the gate; no test kept — UI code gets no tests):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/t1099.probe.test.tsx` → **1 passed (1)**.
  It built a store from a fake `getChats` with a `g-familia` group carrying its General topic (row id `familia@rooms.zilar.test`) and printed `ROWS [ 'familia@rooms.zilar.test|g-familia|Familia' ]`. It asserted:
  - `store.createTopic('g-familia', …)` **rejects** with "This group is not available yet." (root cause), and the dialog lookup `chats.find(id === 'g-familia')` is `undefined` (blank subtitle);
  - `chats.find(id === 'familia@rooms.zilar.test')?.groupTitle === 'Familia'`;
  - `store.createTopic('familia@rooms.zilar.test', { name: 'Night check' })` **resolves**, calls `api.createTopic('g-familia', …)`, returns the new row id `night-check@rooms.zilar.test`, and the created topic is listed with `groupId 'g-familia'` / `groupTitle 'Familia'`.
- `pnpm gate` (from the repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (0.9s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (`SKIP tests @zilar/web` is expected: the changed files have no nearby test files, and UI code gets no tests per AGENTS.md.)

### Deviations / open questions
- I did **not** run a browser on `?mock=1` (the spec says it is optional and a store probe is fine). The store probe confirms the root cause and that the General row id creates the topic under the right group; the same five code facts are read from the real server path above. The lead's browser check on `?mock=1` (subtitle "in Familia", "Night check" created, listed under Familia, Dev team too) remains the final acceptance step.
- No new dependencies. No new tests kept. No store or dialog logic changed.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The root cause,** confirmed by the worker's store probe: the group header's **+** passed the server group id. The dialog and the core `createTopic` resolve a chat row id, so the lookup failed before any request was sent. **The live app takes the same path**, so this is a live bug and not mock-only.
- **The fix:** `GroupHeaderRow` passes the group's General topic row id (falling back to the first row); the other two files change only names. `NewTopicDialog`, the store and `NewChatButton` (which already passed a row id) are unchanged.
- **The lead's web check** (`?mock=1`):
  - Familia's **+**: the dialog says "in Familia", and creating "Night check" opens "Familia › Night check". Familia now shows "2 topics";
  - Dev team's **+**: the dialog says "in Dev team".
- **A follow-up, not in this task:** the new mock topic's header says "9 members, 9 online" for a 2-member group.
- **Check:** the gate passed.
