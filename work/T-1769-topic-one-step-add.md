---
id: T-1769
title: "Topic people S1: one-step add — adding a person or an AI to any non-General topic also adds them to the group when missing (group rule: owner/admin), public topics accept people, and the group cap is checked under the group-join advisory lock"
status: merged
milestone: M5
branch: task/T-1769-topic-one-step-add
model: auto
effort: default
depends_on: [T-1762]
estimate: 45 min
---

# T-1769: The one-step add

## Spec (written by Claude, do not edit)

### Why
On the approved boards (`docs/design/mockups/topic-people/PhoneAdd.dc.html`, `WebAdd.dc.html`), a topic's **Add** puts a person or an AI straight into the topic, and into the group first when they aren't in it yet. This is plan task **S1**: `docs/plan/topic-people.md` §2.1, §2.2 and §4 item 3. Today:
- `addTopicMember` refuses public topics and people outside the group;
- `addTopicAi` refuses AIs outside the group.

### Facts (read by the lead on 2026-10-17)
- **`addTopicAi`** (`apps/server/src/topics/ais.ts:27-98`, 190 lines):
  - a missing or unseen topic, or a foreign AI, gives 404 (`:31-54`);
  - General gives 400 `already_in_general` (`:36-42`);
  - an AI that isn't in `group_ais` gives 400 `'The AI must be in the group first'` (`:55-67`);
  - otherwise it inserts `topic_ais`, then `syncTopicRoom`, audits and emits `ai-added` (`:72-97`).
- **`addTopicMember`** (`apps/server/src/topics/members.ts:125-164`, 327 lines):
  - `requireManagedTopic` (`:131`);
  - **400 `not_private` for any non-private topic** (`:132-134`);
  - the target must be in the group (`:135-138`);
  - then the `topic_members` insert, the room sync and an audit `topic.member_added` (`:139-163`).
- **`addGroupAi`** (`apps/server/src/groups/ais.ts:40-…`, 278 lines) already enforces the group rule (a group owner or admin, `:46-52`), that the actor owns the AI (`:53-56`), that the AI is active (409, `:75-77`), and the cap (`:79-92`). It then sets the affiliation and inserts `group_ais` in a transaction (`:94-113`), plus voice, events and so on.
- **`addGroupMembers`** (`apps/server/src/groups/members.ts:22-…`, 243 lines) enforces the group rule (`:28-34`), `assertContacts` (`:36-37`) and the cap (`:49-63`). It then sets the affiliations and inserts `group_members` in a transaction (`:64-89`), then `addToPublicTopics` and the room syncs (`:90-104`).
- **Both count the cap before their transaction**, so two concurrent adds can each pass at `MAX - 1`. The public join takes `pg_advisory_xact_lock(hashtext('group-join:' + groupId))` inside its transaction (`apps/server/src/groups/join.ts:104`).
- **The deps:** `TopicServiceDeps` = `{ db, adminClient, domain, logger, audit? }` (`apps/server/src/topics/schemas.ts:35-41`), which is all that `AddGroupMembersInput` and `AddGroupAiInput` need (`apps/server/src/groups/schemas.ts:132-154`).

### Steps
1. **`addTopicAi`:** when the AI isn't in `group_ais`, call `addGroupAi(deps.db, deps.adminClient, { groupId: topic.groupId, actorId, aiId, domain, logger })` instead of answering 400.
   - Its group rule (owner or admin, 403 `forbidden`) and its other refusals apply unchanged.
   - Then continue to the `topic_ais` insert as today.
2. **`addTopicMember`:**
   - General gives 400 `is_general` (`'Everyone in the group is in General'`). Drop the `not_private` refusal, so any other topic, public or private, accepts the add.
   - When the target isn't a group member, call `addGroupMembers(deps.db, deps.adminClient, { groupId, actorId, userIds: [target], domain, logger })` first. Its group rule and contact check apply unchanged.
   - Then insert `topic_members` as today.
   - Keep `requireManagedTopic` for the topic half. The group half's rule comes from `addGroupMembers`, so a plain-member topic creator can't add outsiders to the group.
3. **The cap under the lock:** in both `addGroupAi` and `addGroupMembers`, take `pg_advisory_xact_lock(hashtext(${'group-join:' + groupId}))` as the first statement inside their existing `sql.withTransaction`, and re-run the cap count inside it, after the lock. If over the cap, fail with the same 400 (`invalid_request`, `A group has at most … members`).
   - Keep the early check before the transaction, so the common case doesn't touch XMPP.
   - Keep every file at most 400 lines.
4. **Tests (permissions, 2):**
   - in `apps/server/src/topics/ais.test.ts`, an AI owner who is the group owner adds their AI that isn't in the group to a public topic: it lands in `group_ais` **and** `topic_ais`;
   - in a new `apps/server/src/topics/one-step-add.test.ts`, a plain group member who created a public topic adds a person who isn't in the group: 403 `forbidden`, and no `group_members` or `topic_members` row is written.
   - Update any existing assertion that expects `not_private` or `'The AI must be in the group first'`, and list it in the Report.

### Allowed files
- `apps/server/src/topics/ais.ts`
- `apps/server/src/topics/members.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/topics/ais.test.ts`
- `apps/server/src/topics/one-step-add.test.ts`
- `apps/server/src/topics/join-leave.test.ts`
- `work/T-1769-topic-one-step-add.md`

If another test asserts the old refusals, stop and list it in the Report.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/ais.test.ts src/topics/one-step-add.test.ts src/topics/join-leave.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A group owner or admin adds a person or an AI to any non-General topic in one call, and the group half happens when it's missing.
- A plain member can't add outsiders to the group through a topic.
- General refuses with 400.
- The cap holds under concurrency.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/topics/ais.ts` (`addTopicAi`)**: when the AI has no
  `group_ais` row, it now calls `addGroupAi(deps.db, deps.adminClient, { groupId,
  actorId, aiId, domain, logger })` instead of answering 400 `'The AI must be in
  the group first'`. `addGroupAi`'s group rule (owner/admin → 403 `forbidden`) and
  its other refusals apply unchanged; the `topic_ais` insert, room sync, audit and
  `ai-added` event then run as before.
- **`apps/server/src/topics/members.ts` (`addTopicMember`)**: dropped the
  `not_private` refusal. A non-General topic, public or private, now accepts the
  add; General answers 400 `is_general` (`'Everyone in the group is in General'`).
  When the target has no `group_members` row, it calls
  `addGroupMembers(deps.db, deps.adminClient, { groupId, actorId, userIds:
  [target], domain, logger })` first (group rule + contact check unchanged), then
  inserts `topic_members`. `requireManagedTopic` still gates the topic half.
- **`apps/server/src/groups/ais.ts` (`addGroupAi`)**: inside the existing
  `sql.withTransaction`, the first statement is now
  `SELECT pg_advisory_xact_lock(hashtext('group-join:' + groupId))`, then the
  member+AI count is re-read and checked against `MAX_GROUP_MEMBERS`; over the
  cap fails with 400 `invalid_request` `A group has at most … members`. The early
  pre-check before the transaction is kept.
- **`apps/server/src/groups/members.ts` (`addGroupMembers`)**: same lock + locked
  cap re-count. Because the pre-read happens before the transaction, the locked
  block also re-reads the current members and inserts only those still missing
  (`added`), so two racing adds serialize and the loser writes only the rest
  rather than hitting the `group_members` PK. `addToPublicTopics` and the log use
  `added`.
- **Tests**: added the AI one-step case to
  `apps/server/src/topics/ais.test.ts` (group owner adds their AI, which is not in
  the group, to a public topic → present in both `group_ais` and `topic_ais`) and
  the new `apps/server/src/topics/one-step-add.test.ts` (a plain member who
  created a public topic adds a non-member → 403 `forbidden`, with no
  `group_members` and no `topic_members` row written).
- No existing assertion expected `not_private` or `'The AI must be in the group
  first'` (grepped the whole repo, including web/mobile); nothing to update.
- All four changed source files stay under 400 lines (200/337/298/271).

### Checks run

- From `apps/server`:
  `pnpm exec vitest run src/topics/ais.test.ts src/topics/one-step-add.test.ts
  src/topics/join-leave.test.ts --maxWorkers=2 --reporter=dot`
  (the task's command, plus `--maxWorkers=2` per AGENTS.md):
  **3 files passed, 9 tests passed.**
- From `apps/server`, the existing tests that exercise the changed group functions:
  `pnpm exec vitest run src/topics/public-members.test.ts src/groups/ais.test.ts
  --maxWorkers=2 --reporter=dot`: **2 files passed, 7 tests passed.**
- `pnpm gate` (repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (19.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The first `pnpm gate` failed only on `format` for the new test file; I ran
  `prettier --write` on that one file and the second gate passed clean.
- `addGroupMembers` now recomputes the missing set inside the lock (not just the
  count). Without that, a racing duplicate add of the same user would pass the
  fixed count and then hit the `group_members (group_id, user_id)` primary key.
  The locked insert list is what `addToPublicTopics` and the `group_ai`/sync steps
  use, so a fully-lost race is a no-op instead of a 503.
- No deviations from the Spec; no files outside the Allowed files.

### Round 1 (prereview fixes)

#### Findings fixed

- **Finding 1 (should-fix) — lost-race AI add at a full group answered 400.**
  In `apps/server/src/groups/ais.ts` `addGroupAi`, inside the existing
  `sql.withTransaction` the code now rechecks the `group_ais` row right after
  `pg_advisory_xact_lock` and returns early when it already exists, before the
  cap count and the `setAffiliation`/insert. A racing loser therefore sees the
  winner's row and answers 200 instead of recounting the AI and failing 400 at
  a full group, mirroring `addGroupMembers`. The stale two-line comment above
  the insert was replaced with one that matches the new flow.
- **Nits 2 and 3 left as they are**, per the round's rule: neither sits in a
  line this round changes (nit 2 is `groups/members.ts:148`; nit 3 is
  `topics/one-step-add.test.ts`).

#### Tests added

- `apps/server/src/topics/ais.test.ts`: "answers 200 for both of two concurrent
  adds at a full group" — seeds a group one short of `MAX_GROUP_MEMBERS`, runs
  two `addTopicAi` calls for the same new AI in parallel (each routes through
  `addGroupAi`), and asserts both resolve, the group is exactly at the cap, and
  the AI is in `group_ais` and `topic_ais` once.

  **Honest limit:** the test harness is PGlite, one connection behind a
  semaphore (`@effect/sql-pglite`), so statements and transactions serialize:
  the loser's pre-checks always run either fully before or fully after the
  winner's transaction, and the losing interleaving this finding describes is
  not reachable. I confirmed this by stashing the `groups/ais.ts` fix and
  re-running the single test: it still passed, so this test pins the end-state
  contract but is not a regression test for the lost race. The fix itself rests
  on inspection (it mirrors the already-shipped `addGroupMembers` recheck) and
  the gate; the production `PgClient` pool (`SQL_POOL_MAX = 10`) is where the
  race is real.

#### Checks run

- From `apps/server`:
  `pnpm exec vitest run src/topics/ais.test.ts src/topics/one-step-add.test.ts
  src/topics/join-leave.test.ts --maxWorkers=2 --reporter=dot`:
  **3 files passed, 10 tests passed.**
- From `apps/server` (diagnostic, fix stashed, then restored):
  `pnpm exec vitest run src/topics/ais.test.ts --maxWorkers=2 --reporter=dot
  -t "answers 200 for both of two concurrent adds"`: **1 passed, 3 skipped**
  (see the honest limit above).
- `pnpm gate` (repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (24.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

#### Disagreements

None. `apps/server/src/groups/ais.ts` is 309 lines after the change (under 400).

### Round 2 (resumed session)

The interrupted turn had already applied and committed everything this round needs
(`14a2466dd` fixed finding 1; `038589497` wrote the Round 1 report). Resuming, I
re-ran the checks against the committed state and made no code change:

- Findings fixed this round: none outstanding. Finding 1 (should-fix) was already
  fixed; nits 2 and 3 stay untouched because neither sits in a line this round
  changes.
- Tests added this round: none.
- From `apps/server`:
  `pnpm exec vitest run src/topics/ais.test.ts src/topics/one-step-add.test.ts
  src/topics/join-leave.test.ts --maxWorkers=2 --reporter=dot`:
  **3 files passed, 10 tests passed.**
- `pnpm gate` (repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (20.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Scope re-check: the only remaining `not_private` / old-refusal strings are the
  untouched `topics/patch.ts` and `topics/roles.ts` paths and a comment in
  `topics/members.ts`; no stale assertion in any test.
- `git status` clean; `status: review` unchanged.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `543e91236`.
- `addTopicAi` calls `addGroupAi`, and `addTopicMember` calls `addGroupMembers`, when the group half is missing. Their group rule (owner or admin, 403) and contact check apply unchanged.
- `addTopicMember` accepts public topics and refuses General with 400 `is_general`.
- Both group adds take the `group-join:` advisory lock inside their transaction and recount the cap there.
- **Round 2's should-fix was already fixed:** `groups/ais.ts:106-114` rechecks the `group_ais` row after the lock and returns before the cap count. The second review looked at code that was already fixed.
- **Nits accepted:**
  - after a lost race, the loser still sends a duplicate, idempotent XMPP invite from the pre-lock `toAdd`;
  - the 403 test doesn't pin the group-rule message.
- I ran `src/topics` and `src/groups`: 71 passed.

