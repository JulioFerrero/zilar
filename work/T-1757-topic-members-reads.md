---
id: T-1757
title: "Topic people S4b: the reads switch to the new rule - only General is 'the whole group'; a non-General public topic's people are its topic_members (+ role holders) and its AIs are its topic_ais; re-run the backfill as 0070"
status: merged
milestone: M5
branch: task/T-1757-topic-members-reads
model: auto
effort: default
depends_on: [T-1754]
estimate: 45 min
---

# T-1757: The reads follow the new membership rule

## Spec (written by Claude, do not edit)

### Why
Julio's rule, from 2026-10-16 (`docs/design/mockups/topic-people/README.md`, "Round 2"): **a new public topic includes nobody until people join**. General stays everyone, and private stays invite only.

T-1754 (merged) made public topics carry real `topic_members` rows: the creator on create, members kept on going public, and backfill migration 0069.

This task switches **every membership read** so that **only General** means "the whole group". Any other topic, public or private, reads its people from `topic_members` plus role holders, and its AIs from `topic_ais`. **Visibility doesn't change:** a group member still *sees* and can read a public topic they haven't joined (that's the "Other topics" and Join screens).

### Facts (read by the lead on 2026-10-16; each line branches on `visibility !== 'private'` today)
- **`apps/server/src/topics/views.ts`** (347 lines):
  - `countTopicMembers` (`:13-55`): public is group members plus `group_ais` (`:15-27`); private is direct members plus role holders plus `topic_ais` (`:28-54`);
  - `loadTopicViewParts` repeats it for the list view (`:291-301`);
  - it loads direct rows only for private topics (`privateIds`, `:180`).
- **`listTopicMembers`** in `apps/server/src/topics/queries.ts:52-117` (117 lines): public is every group member (`:58-72`).
- **`desiredMembers`** in `apps/server/src/topics/room-members.ts:42-117` (208 lines): public is every group member, with the owner affiliation and the General channel-feed voice handling (`:48-79`); private is at `:80-117`.
- **`loadRoomGateState`** in `apps/server/src/agents/gateway/db.ts` (372 lines):
  - `memberIds` comes from `topic_members` only when `!isGeneral && visibility === 'private'` (`:344`);
  - the comment at `:309-312` says public is every group member;
  - a local `interface TopicMemberRow { userId: string }` sits at `:64-66`. T-1754 added a shared `TopicMemberRow` to `apps/server/src/db/rows.ts`; use `Pick<TopicMemberRow, 'userId'>` from there and delete the local one.
- **`apps/server/src/topics/ai-access.ts`** (106 lines):
  - `aiMayBeInTopic` returns true for any public topic (`:43-45`), and otherwise `canSeeTopic(owner)`;
  - `allowedTopicAiIds` does the same at `:75-77`.
  - **Note:** `canSeeTopic` stays true for every group member on a public topic, so membership must be read directly (`topic_members` row or role holder), not through `canSeeTopic`.
- **`emitDroppedGroupTopicAis`** in `apps/server/src/groups/topic-rooms.ts:61-88` skips non-private topics (`:65`).
- **Unchanged on purpose:**
  - `canSeeTopic` / `visibleTopics` (`apps/server/src/topics/access.ts:81-100,164`) and `visible-batch.ts`, because visibility is unchanged;
  - `archiveDrainedPrivateTopics` (`groups/topic-rooms.ts:93-110`), because a public topic with no members stays joinable;
  - `topics/roles.ts:74`, because roles stay private-only;
  - `topics/members.ts:132,179`, which are later tasks (S1, S5).
- **Migration 0069** (`apps/server/drizzle/0069_topic-members-backfill.sql`) backfilled public topics. Anyone who joins a group after 0069 runs and before this task deploys would be missing, so this task re-runs it.

### Steps
1. **A "member" helper:** where one helps, add a small exported `isTopicMember(db, topicId, userId)` to `apps/server/src/topics/access.ts` (246 lines): a `topic_members` row or a role holder.
   - Reuse the local `isPrivateMember` (`access.ts:60`) and `holdsTopicRole`, imported from `../roles/service` at `access.ts:17`.
   - Keep the file at most 400 lines.
2. **Switch each read to "General = whole group; every other topic = `topic_members` plus role holders, and its `topic_ais`":**
   - in `views.ts`: `countTopicMembers`, the `loadTopicViewParts` count (`:291-301`), and the direct-row load (`:180`, now for every non-General topic);
   - `listTopicMembers` in `queries.ts`;
   - `desiredMembers` in `room-members.ts`. Keep the General channel-feed handling and the creator owner affiliation; a non-General public topic now follows the private branch;
   - `loadRoomGateState` in `gateway/db.ts`: `memberIds` for every non-General topic. Update the comment;
   - `aiMayBeInTopic` and `allowedTopicAiIds` in `ai-access.ts`: a non-General topic of either visibility allows an AI only while its owner is a topic member (the helper from step 1, or the private branch's existing query);
   - `emitDroppedGroupTopicAis` in `groups/topic-rooms.ts:65`: check every non-General, non-archived topic.
   - **Update the comments** that say "a public topic is the whole group" (T-1492) in each place you change.
3. **Migration:** a new `apps/server/drizzle/0070_topic-members-backfill-again.sql`. It's the same statement as `0069` (copy it), with a header comment saying it closes the gap between the two deploys and is idempotent.
4. **Tests (2, the membership rule)** in a new `apps/server/src/topics/public-reads.test.ts`, with the setup copied from `apps/server/src/topics/public-members.test.ts`:
   - a group of 4 people; a public non-General topic with 2 `topic_members` rows and 1 `topic_ais` row. `countTopicMembers` gives 3, and `listTopicMembers` lists exactly the 2;
   - in the same topic, a group member with no row: `canSeeTopic` is true, but their JID isn't in `desiredMembers`, while a member's is.

### Allowed files
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/queries.ts`
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/topics/ai-access.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/agents/gateway/db.ts`
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/roles/access.ts` (lead, after the prereview: stale comment only)
- `apps/server/src/routines/preflight.ts` (lead: stale comment only)
- `apps/server/src/groups/members.ts` (lead: stale comment and variable name only)
- `apps/server/drizzle/0070_topic-members-backfill-again.sql`
- `apps/server/src/topics/public-reads.test.ts`
- `work/T-1757-topic-members-reads.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/public-reads.test.ts src/topics/public-members.test.ts src/topics/ais.test.ts src/topics/visible-batch.test.ts --reporter=dot
pnpm gate
```
If an existing test asserts the old "public topic is the whole group" rule, change that one assertion to the new rule and list it in the Report. Don't delete tests.

### Acceptance
- Only General counts, lists and syncs the whole group.
- Every other topic uses its `topic_members` plus role holders and its `topic_ais`, for counts, member lists, room affiliations, the AI turn gate and the AI allow rule.
- Visibility is unchanged. Migration 0070 re-runs the backfill. The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

Switched every membership read from `visibility !== 'private'` to `isGeneral`, so
only General is "the whole group"; every other topic (public or private) reads
its people from `topic_members` plus role holders and its AIs from `topic_ais`.
Visibility itself is untouched.

Files changed:
- `apps/server/src/topics/access.ts` — added exported `isTopicMember(db, topicId, userId)`
  (a `topic_members` row or a `holdsTopicRole` holder; reuses `isPrivateMember`).
  File is 261 lines.
- `apps/server/src/topics/views.ts` — `countTopicMembers` branches on `topic.isGeneral`;
  `loadTopicViewParts` loads direct `topic_members` rows for every non-General topic
  (`privateIds` → `directMemberTopicIds`, filtered on `!isGeneral`) and its list count
  branches on `topic.isGeneral`. Updated the T-1492 comments.
- `apps/server/src/topics/queries.ts` — `listTopicMembers` lists the whole group only
  for General; every other topic uses the direct-members-plus-holders branch.
- `apps/server/src/topics/room-members.ts` — `desiredMembers` follows the
  `topic_members` plus role-holders branch for every non-General topic. The General
  channel-feed voice handling and the creator-owner affiliation are unchanged (those
  live in the General branch / the non-General branch respectively).
- `apps/server/src/topics/ai-access.ts` — `aiMayBeInTopic` requires the owner to be a
  non-General topic member *and* still in the group (removed the public `return true`;
  `canSeeTopic` import dropped). `allowedTopicAiIds` dropped the public early-return,
  so its existing owner-membership filter applies to every non-General topic.
- `apps/server/src/agents/gateway/db.ts` — `loadRoomGateState` builds `memberIds` for
  every non-General topic; removed the local `interface TopicMemberRow` and now uses
  `Pick<TopicMemberRow, 'userId'>` from `../db/rows`. Updated the comment.
- `apps/server/src/groups/topic-rooms.ts` — `emitDroppedGroupTopicAis` no longer skips
  public topics (only General and archived are skipped).
- `apps/server/drizzle/0070_topic-members-backfill-again.sql` — new; same statement as
  0069 with a header comment saying it closes the gap between the two deploys and is
  idempotent.
- `apps/server/src/topics/public-reads.test.ts` — new; the two membership tests from
  the Spec.

Left unchanged on purpose (per Spec): `canSeeTopic`/`visibleTopics` and
`visible-batch.ts`, `archiveDrainedPrivateTopics`, `topics/roles.ts:74`,
`topics/members.ts:132,179`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-reads.test.ts src/topics/public-members.test.ts src/topics/ais.test.ts src/topics/visible-batch.test.ts`
  → `Test Files 4 passed (4)`, `Tests 7 passed (7)` (8.44s).
  (I added `--maxWorkers=2` to the Spec's vitest command per AGENTS.md; same four files.)
- `pnpm gate` (repo root) → ended `GATE PASS`:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (1.5s)
  PASS  typecheck  (5.0s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (50.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first gate run failed format on `agents/gateway/db.ts`; I ran
  `pnpm exec prettier --write apps/server/src/agents/gateway/db.ts` and re-ran the
  gate, which then passed.

No existing test asserted the old "public topic is the whole group" rule, so no
assertion had to be changed; `public-members.test.ts`, `ais.test.ts` and
`visible-batch.test.ts` all still pass unchanged.

### Pre-review tidy-ups (lead fix round)

- **Nit 1:** `aiMayBeInTopic` in `topics/ai-access.ts` now also requires the owner to
  still be in `group_members` (via `getGroupMembership`), so it agrees with
  `allowedTopicAiIds`. Added the assertion inside the second existing `it` of
  `public-reads.test.ts` (no third test): the real member's AI is allowed, while a
  user with a stale `topic_members` row but no `group_members` row gets
  `aiMayBeInTopic` false and is absent from `allowedTopicAiIds`.
- **Nits 2–4:** refreshed stale "private" comments to "non-General" in
  `agents/gateway/db.ts:140-142`, `topics/views.ts:32` and
  `topics/room-members.ts:36-37`.
- **F1–F3:** refreshed stale comments in `roles/access.ts:104-106` ("Public topics
  have no rows here" → "General topics have no rows here") and
  `routines/preflight.ts:24`; in `groups/members.ts:161-165` fixed the
  "private-topic rows" comment and renamed `privateIds` to `topicIds`. No logic change.

Re-ran the four check files →
`Test Files 4 passed (4)`, `Tests 7 passed (7)` (5.78s); and `pnpm gate` → `GATE PASS`
(13 changed file(s); install, format, lint, typecheck, effect, tests @zilar/server all
PASS; scope/migration/images/size clean).

### Notes for the lead

- **One small extension beyond the literal Spec bullet for the gateway.** The Spec's
  `loadRoomGateState` bullet said only "`memberIds` for every non-General topic", but
  the Acceptance says the AI turn gate must use "`topic_members` plus role holders".
  I therefore also union `topicRoleHolderIds` into `memberIds` for non-General topics.
  Previously private topics' gates ignored role holders; now they honour them, which
  matches `desiredMembers`/`allowedTopicAiIds` and the T-0116 room-sync behaviour.
  Flagging it in case you wanted the stricter, literal change.
- `isTopicMember` itself does not re-check group membership (it is a `topic_members`
  row or a role holder), so `aiMayBeInTopic` also calls `getGroupMembership` — the
  same guard `allowedTopicAiIds` has — so the two AI rules cannot disagree after a
  half-finished group leave (pre-review finding 1).
- Migration `0070` file only; the migrator reads the `drizzle/` folder on startup, so
  no `meta/_journal.json` change was needed (0069 didn't add one either).
- `loadTopicViewParts` still issues the `group_ais` count query for all groups even
  though only General consumes it. I left it as-is to keep the change minimal; say the
  word if you'd rather restrict it to General groups.

## Review (written by Claude)

- **Accepted at `b9b5991c1`.** It's clean after a lead tidy-up round (2 nits). The lead ran the 4 topic test files: 7 pass.
- **Only General is "the whole group" now.** Every other topic, public or private, reads `topic_members` plus role holders for:
  - the count and list;
  - room affiliations (`desiredMembers`);
  - the AI turn gate (`loadRoomGateState`);
  - the AI allow rule, which now also checks that the owner is still in the group.
- **Unchanged:** visibility.
- **New:**
  - the `isTopicMember` helper;
  - `emitDroppedGroupTopicAis` now covers every non-General topic;
  - re-backfill migration 0070;
  - stale comments refreshed in 7 files.
- **The nits are accepted:**
  - a comment wraps mid-sentence;
  - `countTopicMembers` doesn't filter on live `group_members`, which can't happen today: the group leave deletes the rows in the same transaction.
- **Deploy order:** merged to main **without a push**. Main isn't pushed again until the Join UI (W9, W10) merges, so new public topics never sit in prod without a way to join.
