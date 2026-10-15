---
id: T-1577
title: "AI questions step 7 (plan docs/audit/handoff-questions-plan.md): an open, posted ai_questions row makes its AI 'waiting' in the topic activity (beside pending approvals), and the activity entry carries the question's message id (questionId) through the contract, chat-core and the client mapping; batch read with a LIMIT"
status: merged
milestone: M5
branch: task/T-1577-activity-open-question
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1577: An open question makes the AI "waiting for you"

## Spec (written by Claude, do not edit)

### Why
In the approved AI work boards, an AI is "waiting for you" (amber dot) while it has a pending approval **or an open question** (`docs/design/mockups/ai-work/README.md`). Background:
- `docs/audit/handoff-questions-plan.md` §4 and §7 step 7;
- the lead's answers (`work/T-1566-audit-handoff-questions.md` › Review, item 7): the activity carries the question's message id, so the "AIs here" row can open it (step 8);
- the T-1571 Review's notes: add a `LIMIT` to the open-questions read. The activity only covers topics the viewer can already see, so no new permission path is opened.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/server/src/topics/ai-activity.ts` (299 lines):**
  - `topicAiActivity(deps, topics)` (`:40-128`) reads `loadPendingApprovals` and `loadLastCardStates` (`:64-67`);
  - `waiting` is built from approvals, with NULL-topic rows going to the group's General topic (`:57-76`);
  - the states merge as done < waiting < working (`:111-125`);
  - `loadPendingApprovals` (`:241-267`) is the batch-read model, with the empty-`IN` guard and best-effort `catch`;
  - the entries are named in `activityEntries` (`:182-205`): `{ aiId, name, jid, avatarUrl?, state }`;
  - the internal type `TopicAiActivity` is at `:20-23`.
- **The questions table** (T-1571, `0066_ai_questions.sql`): `ai_id`, `group_id`, `topic_id`, `message_id`, `status`, `expires_at`.
  - Open means `status = 'open' AND expires_at > now()`.
  - A row with `message_id IS NULL` was never posted and must not count.
  - The service is `apps/server/src/questions/service.ts` (`listOpenQuestions(db, { topicId })` is per topic).
- **Contract:** `TopicActivity` (`packages/api-contract/src/topics.ts:183-196`): `{ aiId, name, jid?, avatarUrl?, state }`.
- **`chat-core`:** `TopicAiActivity` (`packages/chat-core/src/types.ts:137-144`).
- **`client-core`:** `topicActivityOf` (`packages/client-core/src/store/topic-rows.ts:64-79`) copies the optional fields.

### Steps
1. **`questions/service.ts`:** `listOpenQuestionsForTopics(db, topicIds, generalGroupIds)` returns `{ topicId, groupId, aiId, messageId, createdAt }`.
   - Only rows that are open, unexpired and have `message_id IS NOT NULL`.
   - The same scope shape as `loadPendingApprovals`: `topic_id IN …`, plus NULL-topic rows of General groups.
   - `ORDER BY created_at DESC LIMIT 200`.
   - Also add `LIMIT 100` to `listOpenQuestions`.
2. **`ai-activity.ts`:**
   - read the questions next to the approvals (in the same `Promise.all`, best effort);
   - an AI with an open question is `waiting` in that topic;
   - the internal entry gains `questionId?: string`, the **newest** open question's `messageId` for that AI and topic;
   - `activityEntries` passes it through.
3. **Contract, `chat-core` and `client-core`:** `TopicActivity` and `TopicAiActivity` gain `questionId?: string`, and `topicActivityOf` copies it.
4. **Tests:** one case in `apps/server/src/topics/ai-activity.test.ts`: an open, posted question makes its AI `waiting` with `questionId`; an unposted (`message_id` NULL) or expired one does not.

### Not in scope
- client UI (step 8);
- the answer path (step 6);
- the mock (step 8 seeds a question).

### Allowed files
- `apps/server/src/questions/service.ts`
- `apps/server/src/topics/ai-activity.ts`
- `apps/server/src/topics/ai-activity.test.ts`
- `packages/api-contract/src/topics.ts`
- `packages/chat-core/src/types.ts`
- `packages/client-core/src/store/topic-rows.ts`
- `work/T-1577-activity-open-question.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/ai-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The new test passes, and the gate passes.
- `ai-activity.ts` stays under 400 lines; the Report gives its `wc -l`.

---

## Report (written by the worker when done)

### What I did

An AI that has an open, posted question is now `waiting` in its topic activity,
and the entry carries the question card's message id so the "AIs here" row can
open it (step 8).

- **`apps/server/src/questions/service.ts`**
  - New `listOpenQuestionsForTopics(db, topicIds, generalGroupIds)` returning
    `OpenQuestionForActivity` (`topicId`, `groupId`, `aiId`, `messageId`,
    `createdAt`). One batch read: `status = 'open' AND expires_at > now() AND
    message_id IS NOT NULL`, scoped exactly like `loadPendingApprovals`
    (`topic_id IN …`, plus the NULL-topic rows of the General groups), and
    `ORDER BY created_at DESC LIMIT 200` so the newest question is first.
  - `listOpenQuestions` gained `LIMIT 100`.
- **`apps/server/src/topics/ai-activity.ts`** (346 lines, under the 400 cap)
  - `topicAiActivity` reads the questions in the same `Promise.all` as the
    approvals and cards, through a best-effort `loadOpenQuestions` wrapper.
  - Rows are resolved to a topic like the approvals (a NULL `topic_id` goes to
    the batch's General topic) and are added to the `waiting` set; the first
    row per `(topicId, aiId)` (newest, since the read is newest-first) is kept
    as that entry's `questionId`.
  - `TopicAiActivity` gained `questionId?: string`; the returned entries carry
    it only when present.
  - `activityEntries` passes `questionId` through to the response entry.
- **`packages/api-contract/src/topics.ts`**: `TopicActivity` gained
  `questionId: Schema.optional(Schema.String)`.
- **`packages/chat-core/src/types.ts`**: `TopicAiActivity` gained
  `questionId?: string`.
- **`packages/client-core/src/store/topic-rows.ts`**: `topicActivityOf` copies
  `questionId` when the server sends it.
- **`apps/server/src/topics/ai-activity.test.ts`**: one new case seeding an
  open posted question (expects `waiting` + `questionId`), an unposted one and
  an expired one (neither makes the AI `waiting`). Questions are seeded through
  the real `createQuestion`/`setQuestionMessageId` service, so the test does
  not hand-write jsonb.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ai-activity.test.ts`
  → `Test Files 1 passed (1)`, `Tests 11 passed (11)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/questions/service.test.ts`
  → `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
- `wc -l apps/server/src/topics/ai-activity.ts` → `346`.
- `pnpm gate` (from the repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.3s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.7s)
  PASS  tests @zilar/client-core  (5.7s)
  PASS  tests @zilar/server  (7.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Server view type:** the response entry must carry `questionId`, but the
  server's `TopicActivityEntry` lives in `apps/server/src/topics/types.ts`, which
  is not in this task's Allowed files (and the spec's step 3 lists only the
  contract, `chat-core` and `client-core` as gaining the field). So the read
  model in `ai-activity.ts` gained the field on its internal entry (step 2) and
  `activityEntries` emits it via a local `ActivityEntry = TopicActivityEntry &
  { questionId?: string }`; the shared view type is untouched. The contract
  `TopicActivity` declares `questionId`, so the HTTP encoder keeps it and the
  client decodes it. If you would rather declare it on `TopicActivityEntry`
  too (the T-1537 pattern for `jid`), that is a one-line change in
  `types.ts` — please add that file to Allowed files and I will do it.
- The mock seeds are left alone, per "Not in scope".
- Security: read-only, no new route or permission path; the read is scoped to
  the topics the caller already asked about; both reads are bounded
  (`LIMIT 200` / `LIMIT 100`) and best-effort, so a failure reads as no
  questions and never fails the list.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits and 1 follow-up.
- **What the lead checked:**
  - **Tests:** the lead ran `src/topics/ai-activity.test.ts` on the branch, 11 passed. They include an open, posted question making its AI `waiting` with `questionId`, while unposted and expired questions do not count.
  - **Limits:** `listOpenQuestionsForTopics` has `LIMIT 200` and `listOpenQuestions` has `LIMIT 100`.
  - **Sizes:** `ai-activity.ts` is 346 lines.
  - **The new field:** `questionId` is optional in the contract, `chat-core` and the client mapping.
  - **Permissions:** the activity only covers topics the viewer can already list, so no new access path.
- **Follow-up for step 8:** declare `questionId?` on `TopicActivityEntry` in `apps/server/src/topics/types.ts` instead of the local alias.
