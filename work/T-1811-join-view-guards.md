---
id: T-1811
title: "Join view guards: web never shows 'Join <topic>' before the viewer's id and the topic's members are known (phone: members), and a ProgressCard in the web Join preview is read-only (no Stop)"
status: merged
milestone: M5
branch: task/T-1811-join-view-guards
model: auto
effort: default
depends_on: [T-1807]
estimate: 20 min
---

# T-1811: Join view guards

## Spec (written by Claude, do not edit)

### Why
**Live on 2026-10-17** (web, build `8cf019db0`): reloading the topic "cards test", which the viewer is a member of, showed the "Join cards test" key and an empty preview for a few seconds ("Waiting for network…"). The normal thread then replaced it. A member must never see a Join key.

The T-1807 pre-review also found that the web preview draws a live `ProgressCard`, whose Stop button stays active for a topic the viewer hasn't joined.

### Facts (read by the lead on 2026-10-17)
- **Web:**
  - `apps/web/src/routes/ChatView.tsx:222-226`: `joinPreview = chat.topic !== undefined && visibility === 'public' && isGeneral !== true && !isTopicJoined(chat.topic, currentUserId)`;
  - `currentUserId` starts as `''` (`apps/web/src/store/effects/lifecycle.ts:73`, `apps/web/src/store/realStore.ts:34`) until `/api/me` answers;
  - `isTopicJoined` (`packages/chat-core/src/topics.ts:57-62`) treats a missing `memberIds` as `[]`.
- **Phone:** `apps/mobile/src/app/chat/[id].tsx:80-85` already requires `screen.myUserId !== ''`, but not a known `memberIds`.
- **`apps/web/src/components/ProgressCard.tsx`:**
  - `ProgressCard({ progress })` (`:100`);
  - the Stop button shows when `stoppable` (`:136`);
  - the web Join preview renders it in `apps/web/src/components/topic/TopicJoinView.tsx` (`PreviewRow`).

### Steps
1. **Web `ChatView.tsx:222-226`:** add `currentUserId !== ''` and `chat.topic.memberIds !== undefined` to `joinPreview`. With either unknown, show the normal thread, as the phone does.
2. **Phone `[id].tsx:80-85`:** add `chat.topic.memberIds !== undefined`.
3. **`ProgressCard`:** add an optional `readOnly?: boolean` prop. When it's true, there's no Stop button and nothing calls `listAis()` (gate the query on `!readOnly`). `TopicJoinView`'s `PreviewRow` passes `readOnly`. The thread is unchanged.
4. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/ProgressCard.tsx`
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `work/T-1811-join-view-guards.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- A member reloading a public topic never sees the Join key.
- A non-member still gets the Join view once the ids are known.
- A progress card in the web preview has no Stop button.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Web `apps/web/src/routes/ChatView.tsx`: `joinPreview` now also requires `currentUserId !== ''` and `chat.topic.memberIds !== undefined`, so an unknown viewer id or member list keeps the normal thread instead of showing a Join key.
- Mobile `apps/mobile/src/app/chat/[id].tsx`: `joinPreview` now also requires `chat.topic.memberIds !== undefined` (the caller-id guard was already there).
- `apps/web/src/components/ProgressCard.tsx`: added optional `readOnly?: boolean`. When true the `listAis()` query is not built (`Effect.succeed(null)`, deps include `readOnly`) and `stoppable` is false, so no Stop button renders. The thread's cards are unchanged (default `readOnly = false`).
- `apps/web/src/components/topic/TopicJoinView.tsx`: `PreviewRow` passes `readOnly` to `ProgressCard`.
- No tests added: the spec says UI-only, no tests. All four touched source files stay within 400 lines (369/258/166/207).

### Checks run
- `pnpm install`: done, 1295 resolved, finished with the existing `@types/react-dom` peer warning only.
- `pnpm gate` from the repo root:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (5.1s)
PASS  effect  (0.9s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run: the change is UI-only and the gate found no nearby test files.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `83d685d09`.
- **Web `joinPreview`** requires `currentUserId !== ''` and a known `memberIds`; the phone adds the `memberIds` guard.
- **`ProgressCard readOnly`** skips `listAis()`, so there's no Stop and no Steps panel in the Join preview.
- **Nit accepted:** a topic without `memberIds` (an older server) never shows Join. Current servers always send it.
- **Live check after the deploy:** reload "cards test" and the Join key mustn't flash.

### Notes for the lead
- The Read-only card also loses the Steps panel, because `canViewSteps` derives from the same `ownedAi` value, which stays `null` when the query is skipped. In the Join preview that matches the intent (the viewer does not own that AI), and the thread is untouched. Say the word if the preview should still open Steps.
- Acceptance was verified in the code paths, not by hand in a browser/phone: a member with `memberIds` known is excluded by `isTopicJoined`; a non-member still gets the preview once `currentUserId`/`myUserId` and `memberIds` are known.
