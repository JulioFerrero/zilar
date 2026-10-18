---
id: T-1991
title: "Permissions: admins can't give themselves a role that opens a private topic they can't see; only group owners/admins pick a topic's approver role; an approved action is cancelled when its AI left the topic; a question card is answered only from its own room — with tests"
status: merged
milestone: M5
branch: task/T-1991-roles-approvals-edges
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-1991: Roles and approvals edges

## Spec (written by Claude, do not edit)

### Why
The lead's private security review of 2026-10-18 (T-1985) found four permission gaps. This area is crucial, so tests are required.
1. **Self-granted role.** A group admin can add themselves to a role that opens a private topic, and so see it. The user guide says "a group owner or admin who is not in the private topic cannot see it" (`docs/USER_GUIDE.md:136`).
2. **Approver role by creator.** A plain member who created a private topic can name its approver role (one they hold). They can then approve other people's AIs' tier-2 requests in that topic.
3. **Approval after removal.** An approval decided after its AI was removed from the group or topic still runs. The only re-check is the AI's `status`.
4. **Wrong-room answer.** An AI's open question can be answered by a reply sent in a different room the AI is in.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Roles.** `roles/service.ts` (378 lines): `setRoleMembers` (`:250-…`) checks only `requireGroupManager(deps.db, groupId, actorId)` and `requireRoleInGroup`.
- **Topic access.** `topics/access.ts`: `canSeeTopic` lets a private topic be seen through `holdsTopicRole` (`:93-99`).
- **Topic roles.** `topics/roles.ts` (172 lines):
  - `setTopicRoles` starts with `requireManagedTopic(...)` (`:69-73`), which passes for the topic's creator;
  - it checks only that `approverRoleId` belongs to the group (`:93-99`);
  - it writes `approver_role_id` at `:128-131`.
- **Who may decide.** `approvals/access.ts` (245 lines): the decider is allowed when they hold `topic.approverRoleId` in the approval's group (`:44-60`), before the AI-owner check.
- **Running an approved action.** `actions/queries.ts` (377 lines):
  - `runOnApprovalDecided` re-checks only `ai.status !== 'active'` and then calls `cancelPending(deps, pending, 'ai_not_active', at)` (`:248-265`);
  - `isAiInTopic` is at `:180`;
  - `cancelPending` is at `:49`.
- **Removing an AI.** `groups/ais.ts` (`removeGroupAi`) and `topics/ais.ts` (200 lines) remove an AI's rows, but leave its pending approvals.
- **Answering a question.** In `agents/gateway/question-answer.ts` (148 lines), `findOpenQuestionByMessage(db, replyTo.id)` is followed only by `question.aiId !== session.aiId` (`:67-70`). The question row has `roomJid` (`questions/service.ts:24`). The query (`:199-210`) filters on `message_id`, `status` and `expires_at` only.
- **Existing tests:** `roles/roles.test.ts`, `approvals/service.test.ts`, `actions/unattended.test.ts` and `agents/gateway/question-answer.test.ts`.

### Steps
1. **Self-granted role.** In `setRoleMembers`, find the private topics the role opens (`topic_role_access`). For each user being **added**, refuse with `403 forbidden`, "You can't add people to a role that opens a private topic you're not in", unless the actor can already see every such topic (`canSeeTopic`). This covers the actor adding themselves or anyone else.
2. **Approver role.** In `setTopicRoles`, changing `approverRoleId` requires a current group owner or admin (`403` otherwise). A creator who is a plain member can still change role access, as today.
3. **Approval after removal.**
   - In `runOnApprovalDecided`, after the status re-check, cancel with reason `ai_not_in_topic` when the approval has a group and `isAiInTopic(...)` is false.
   - Also cancel the AI's pending approvals for that group (or topic) inside `removeGroupAi` and the topic AI removal, using the existing cancel path.
4. **Wrong-room answer.** In `question-answer.ts`, require `normBareJid(message.chatJid) === question.roomJid` before answering, and add the room to the query (`findOpenQuestionByMessage(db, messageId, roomJid)`).
5. **Tests (permissions are crucial).** Add one test per step in the nearest existing test file.
6. **Keep every file at or under 400 lines.** `roles/service.ts` and `actions/queries.ts` are close to the limit; put new helpers in a new small file next to them when needed.

### Allowed files
- `apps/server/src/roles/service.ts`
- `apps/server/src/roles/private-topic-guard.ts`
- `apps/server/src/roles/roles.test.ts`
- `apps/server/src/topics/roles.ts`
- `apps/server/src/actions/queries.ts`
- `apps/server/src/actions/topic-recheck.ts`
- `apps/server/src/actions/unattended.test.ts`
- `apps/server/src/approvals/service.test.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/agents/gateway/question-answer.ts`
- `apps/server/src/agents/gateway/question-answer.test.ts`
- `apps/server/src/questions/service.ts`
- `work/T-1991-roles-approvals-edges.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/roles src/actions src/approvals src/agents/gateway/question-answer.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- One passing test per step.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Step 1, self-granted role.** `setRoleMembers` now refuses an assignment that would add anyone to a role opening a private topic the actor cannot see, with `403 forbidden` and the spec's fixed message. The check runs inside the existing assignment transaction and before the insert, so a refusal writes nothing. It covers the actor adding themselves or anyone else. The logic lives in the new `roles/private-topic-guard.ts`; it is one SQL statement mirroring `canSeeTopic` for private topics (group member, and a `topic_members` row or a topic role).
- **Step 2, approver role.** `setTopicRoles` now requires a current group owner or admin when `approverRoleId` actually changes (`403 forbidden`, "Only group owners and admins can pick the approver role"). A plain member who created the topic can still change the topic's role access. The check runs before the transaction, so nothing is written.
- **Step 3, approval after removal.** `runOnApprovalDecided` re-checks `isAiInTopic` after the AI-status check and cancels with the new reason `ai_not_in_topic`. `removeGroupAi` and `removeTopicAi` also cancel the AI's waiting actions through the existing `cancelPending` path, via the new `actions/topic-recheck.ts`; the audit row is written there. Removal cancellation is best effort (logged, never thrown) because the removal has already committed and the run-time re-check still stops a survivor.
- **Step 4, wrong-room answer.** `findOpenQuestionByMessage` takes the room and filters on it; `answerOnReply` passes `normBareJid(message.chatJid)`, so a reply in another room the AI is in no longer closes the question.
- **Tests.** One test per step: two in `roles/roles.test.ts` (self-grant refused and nothing written, then the owner can grant; creator can change access but not the approver role, then the owner can), two in `actions/unattended.test.ts` (an approved action is cancelled after the AI left the group, with the audit reason; removing the AI from a topic or group cancels its waiting action), and one in `agents/gateway/question-answer.test.ts` (another room is ignored, the question's own room still answers).

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/roles/roles.test.ts` — 24 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/unattended.test.ts -t T-1991` — 2 passed, 3 skipped.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/question-answer.test.ts` — 5 passed.
- `pnpm gate` (final code state; summary of the last run):
  - `PASS  install (frozen)  (9.3s)`
  - `PASS  format  (9.0s)`
  - `PASS  lint  (5.2s)`
  - `PASS  typecheck  (2.4s)`
  - `PASS  effect  (3.0s)`
  - `PASS  tests @zilar/server  (83.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

Two earlier gate runs failed and were fixed before the final run: one Prettier warning in `actions/unattended.test.ts`, and one typecheck error where the guard's Effect error type was missing `SqlError`.

### Notes for the lead

- **Guard uses a SQL mirror, not `canSeeTopic`.** Calling the async `canSeeTopic`/`runSql` from inside `sql.withTransaction` deadlocked the PGlite test database (every `setMembers` test timed out). The guard therefore runs on the transaction's own SQL client with one query that mirrors `canSeeTopic` for private topics. If `canSeeTopic` gains another way in, this query needs the same change. It ignores archived private topics (`archived_at IS NULL`); `canSeeTopic` returns false for archived topics, which would otherwise make a role attached to an archived topic permanently unassignable.
- **Room argument is optional.** `findOpenQuestionByMessage(db, messageId, roomJid)` accepts an optional room so the existing `src/questions/service.test.ts`, which is outside the Allowed files, keeps compiling and passing. The message path always passes the room; a caller that omits it gets the old unfiltered lookup.
- **Removal cancellation builds its own audit recorder** from the database (`createAuditRecorder`), since `removeGroupAi`'s input and `TopicServiceDeps` carry only a logger. No announce hook is available on those paths, so a cancelled card posts no notice; `cancelPending` still writes `action.cancelled` with `reason: ai_not_in_topic`.
- `roles/roles.test.ts` was already well over 400 lines before this task; the gate's size check passed, and I did not split it because no new test file was in the Allowed files.

## Review (written by Claude)

Approved. The pre-review was clean, with 1 nit and 1 follow-up.
- **Roles.** `setRoleMembers` refuses to add people to a role that opens a private topic the actor can't see. The check runs in the same transaction as the insert.
- **Approver role.** Only group owners and admins can change a topic's approver role.
- **Approved actions.** They re-check `isAiInTopic` before they run. Removing an AI from a group or topic cancels its pending approvals there.
- **Question answers.** They must come from the question's own room.
- **Follow-up.** Make `roomJid` required in `findOpenQuestionByMessage` once its test file can change.
