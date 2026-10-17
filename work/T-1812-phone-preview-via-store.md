---
id: T-1812
title: "Phone Join preview reads through the store: a topicPreview(chatId) store action resolves the topic id and uses the store's topics port (mock-aware), replacing the view's own production client that passes the chat JID"
status: merged
milestone: M5
branch: task/T-1812-phone-preview-via-store
model: auto
effort: default
depends_on: [T-1808]
estimate: 25 min
---

# T-1812: Phone preview through the store

## Spec (written by Claude, do not edit)

### Why
**Emulator, mock build of main on 2026-10-17:** "Dev team › Ideas" shows the Join key but "Could not load messages", even though the mock backend now serves the preview (T-1808). There are two causes:
- **It bypasses the mock backend:** the view builds its own production client, `createTopicsApi(getSessionToken, undefined, API_URL)` (`apps/mobile/src/components/chat/topic-join-view.tsx:42`), instead of the store's topics port, which is mock-aware (`apps/mobile/src/store/chat-store-provider.tsx:76`, `apps/mobile/src/store/effects/ports.ts:204`).
- **It passes the wrong id:** it calls `api.topicPreview(chat.id)` (`:54`) with the chat's id (the room JID). The route takes the **topic id** (`GET /topics/:id/preview`, `packages/api-contract/src/topics.ts:330`). Web resolves the topic id first (`apps/web/src/components/topic/TopicJoinView.tsx:42`), and every phone topic action does too, through `topicIdForCore` (`apps/mobile/src/store/effects/group-actions.ts:148`). So on the real server the phone preview likely 404s too.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/store/effects/group-actions.ts`** (319 lines):
  - `listTopicMembers` at `:145-151` is the pattern: `topicIdForCore(ctx.coreCtx, actionStore(), chatId)`, then `lift(() => topics.listTopicMembers(topicId))`;
  - `joinTopic` is at `:123-126`.
- **`apps/mobile/src/store/effects/groups.ts:25-45`** is the `GroupActions` pick list.
- **`apps/mobile/src/store/types-groups.ts`** (265 lines): `joinTopic` is typed at `:97`, and `listTopicMembers` at `:101`.
- **`apps/mobile/src/lib/topics-api.ts:125`:** `topicPreview(id: string): Promise<TopicPreviewMessage[]>`.

### Steps
1. **A new store action, `topicPreview: (chatId: string) => Promise<TopicPreviewMessage[]>`:**
   - typed in `types-groups.ts` next to `listTopicMembers`, with a one-line doc;
   - added to the `GroupActions` pick;
   - implemented in `group-actions.ts` like `listTopicMembers`, calling `topics.topicPreview(topicId)`.
2. **`topic-join-view.tsx`:** use `useChatStore((s) => s.topicPreview)` and call it with `chat.id`. Remove the view's own `createTopicsApi`, `getSessionToken` and `API_URL` imports and the `useMemo` client. Keep the mounted-id guard and the states.
3. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `work/T-1812-phone-preview-via-store.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In the mock build, "Ideas" shows its 4 preview messages above the Join key.
- On a real server, the call goes to the topic id.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `topicPreview: (chatId: string) => Promise<TopicPreviewMessage[]>` to
  `ChatStoreGroups` (next to `listTopicMembers`, with a one-line doc) and
  imported `TopicPreviewMessage` from `../lib/topics-api`.
- Added `topicPreview` to the `GroupActions` pick in `effects/groups.ts`, next
  to `listTopicMembers`.
- Implemented it in `effects/group-actions.ts` the way `listTopicMembers` is
  written: `topicIdForCore(ctx.coreCtx, actionStore(), chatId)` first, then
  `lift(() => topics.topicPreview(topicId))`, so the call goes to the topic id
  and through the store's mock-aware `topics` port.
- `topic-join-view.tsx` now reads `useChatStore((s) => s.topicPreview)` and
  calls it with `chat.id`. Removed the view's own `createTopicsApi`,
  `getSessionToken`, `API_URL` and the `useMemo` client; the effect deps are
  `[topicPreview, chat.id, attempt]`. The mounted-id guard, the loading/error/
  empty/ready states and the retry attempt counter are unchanged.

Files changed (all inside the Allowed files):

- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/components/chat/topic-join-view.tsx`
- `work/T-1812-phone-preview-via-store.md` (status + this Report)

No tests were added (the spec says UI, no tests). No other file was touched.

### Checks run

`pnpm gate` from the repo root (it also ran `install (frozen)`; no separate
`pnpm install` was needed) — final output:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (11.5s)
PASS  format  (1.5s)
PASS  lint  (1.0s)
PASS  typecheck  (4.1s)
PASS  effect  (1.5s)
PASS  tests @zilar/mobile  (5.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file was run on its own; the task adds no test and the gate's
`tests @zilar/mobile` step passed.

I did not run the emulator or the mock build, so I did not personally see the
"Ideas" preview. What I verified in code: mock mode injects
`topicsApi: createTopicsApi(mockToken, mockFetch, API_URL)`
(`apps/mobile/src/store/chat-store-provider.tsx:76`), the store's `topics` port
defaults to that dep (`effects/ports.ts:204`), and the T-1808 preview route
lives in `packages/mock-backend` — so the view now reaches the mock backend
through the store instead of building its own production client.

### Notes for the lead

- The effect depends on `topicPreview`: selectors return a stable action, but
  if the store were ever recreated the effect re-runs, which is the same
  behaviour the old `api` dep had.
- Acceptance on a real server (topic id instead of the room JID) is covered by
  the `topicIdForCore` call, matching `listTopicMembers` and `joinTopic`; not
  exercised against a live server here.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `2d911553f`.
- **The new store action** `topicPreview(chatId)` resolves the topic id with `topicIdForCore` and calls the store's topics port (mock-aware), like `listTopicMembers`. The view's own production client (which passed the room JID) is gone.
- **The emulator check** on main ("Dev team › Ideas" with its 4 messages) runs right after this merge.
