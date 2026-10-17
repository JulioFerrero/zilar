---
id: T-1834
title: "General's 'AIs in this topic' lists the group's AIs (General is the whole group, its member count already adds them) instead of 'No AIs in this topic yet'; no Remove there on web or phone"
status: merged
milestone: M5
branch: task/T-1834-general-lists-group-ais
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1834: General lists the group's AIs

## Spec (written by Claude, do not edit)

### Why
**Web mock mode, 2026-10-17:** Dev team › General's panel says "Public topic · Everyone", but "AIs in this topic: No AIs in this topic yet", while Dev-1 posts in General.
- **General has no `topic_ais` rows** (`apps/server/src/topics/ai-access.ts:14`). Its AI membership is the group's (`group_ais`), so the topic AI list is always empty for General.
- **Yet its count includes them:** General's `memberCount` already adds the group's AIs (`apps/server/src/topics/views.ts:372-375`).
- **The phone sheet has the same empty "AIs" list,** because it reads `topic.ais` (`apps/mobile/src/components/chat/topic-info-sheet.tsx:160`).

### Facts (read by the lead on 2026-10-17)
- **Server:**
  - The `listAis` handler (`apps/server/src/topics/api.ts:310-321`, 373 lines) calls `listTopicAis(deps.db, topic.id)` after `requireVisibleTopic`.
  - `listTopicAis` (`apps/server/src/topics/views.ts:162-181`, 391 lines) selects from `topic_ais`, sorts by name then id, and adds pictures with the private `aiAvatarUrls` (`:144`) and `withAiAvatars` (`:153`).
  - **`views.ts` is near the 400-line cap,** so new code goes into a new file.
- **Web:**
  - `TopicPanel.tsx:171-174`: `canRemoveAi(aiId)` is true for the AI's owner or a manager. It feeds `TopicAisSection canRemove` (`:247-256`).
  - `groupAis = info?.ais ?? []` (`:112`), and the topic is `topic`, with `topic.isGeneral`.
- **Phone:**
  - `topic-info-sheet.tsx` uses `const ais = topic?.ais ?? []` (`:160`) and draws rows with memory but no Remove (`:214-252`).
  - The group detail is `detail`, whose `detail.ais` are `GroupAi { aiId, jid, name, ownerId, avatarUrl? }` (`packages/api-contract/src/groups.ts:105-113`).

### Steps
1. **Server:** export `aiAvatarUrls` and `withAiAvatars` from `views.ts` (no other change there).
   - Add `apps/server/src/topics/general-ais.ts` with `listGeneralAis(db, groupId): Promise<TopicAiView[]>`: the group's AIs from `group_ais` joined to `ais`, sorted and with pictures, the same way as `listTopicAis`. Read the `group_ais` columns in `apps/server/src/db/rows.ts` first.
   - In `api.ts` `listAis`, General returns `listGeneralAis(deps.db, topic.groupId)`; other topics are unchanged.
2. **Web:** `canRemoveAi` returns `false` when `topic.isGeneral === true`. An AI leaves General only by leaving the group, in the group panel.
3. **Phone:** in `topic-info-sheet.tsx`, for General use the group's AIs: map `detail?.ais` to `{ id: aiId, name, avatarUrl? }`. Other topics keep `topic.ais`.
4. **No tests** (UI and listing). Keep every file at most 400 lines.

### Allowed files
- `apps/server/src/topics/general-ais.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/api.ts`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `work/T-1834-general-lists-group-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On live, General's panel lists the group's AIs with no Remove.
- On the phone, General's sheet lists them.
- Other topics are unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Server:** exported `aiAvatarUrls` and `withAiAvatars` from `views.ts` (only the
  keywords changed). Added `apps/server/src/topics/general-ais.ts` with
  `listGeneralAis(db, groupId)`: `group_ais` joined to `ais`, sorted by name then id,
  pictures attached the same way as `listTopicAis`. In `api.ts`, `listAis` asks for the
  group's AIs when `topic.isGeneral`, and keeps `listTopicAis` for other topics.
- **Web:** `canRemoveAi` in `TopicPanel.tsx` returns `false` for General, so the list
  shows the group's AIs with no Remove action.
- **Phone:** `topic-info-sheet.tsx` maps `detail?.ais` to `{ id: aiId, name, avatarUrl? }`
  for General; other topics keep `topic.ais`.
- No tests added, as the spec says. Files changed: `apps/server/src/topics/general-ais.ts`
  (new), `apps/server/src/topics/views.ts`, `apps/server/src/topics/api.ts`,
  `apps/web/src/components/TopicPanel.tsx`,
  `apps/mobile/src/components/chat/topic-info-sheet.tsx`, plus this task file.

### Checks run

- `pnpm install` — completed with no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ais.test.ts`
  — 1 file passed, 4 tests passed.
- `pnpm gate` — first run: `FAIL format` on the new `general-ais.ts` (Prettier). Ran
  `pnpm exec prettier --write apps/server/src/topics/general-ais.ts`, then re-ran.
  Second run summary:
  ```
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (0.8s)
  PASS  tests @zilar/server  (8.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The gate was run again after this Report was written, with the same result (GATE PASS).

### Notes for the lead

- I did not run the app or check the live/phone views; verification of the acceptance
  bullets is left to the lead's smoke and Julio's live check.
- `views.ts` is 391 lines and unchanged apart from the two `export` keywords; the new
  file is 31 lines.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `c4dc2e12d`.
- **The server:** `listGeneralAis` (`group_ais` joined to `ais`, sorted, with pictures) answers `listAis` for General; other topics keep `listTopicAis`.
- **Web:** `canRemoveAi` is false in General.
- **Phone:** the sheet maps `detail.ais` for General.
- **The lead checks it live** in "ai test › General" after the deploy (the mock backend keeps its own list).
