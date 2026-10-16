---
id: T-1762
title: "Topic people: re-apply T-1757 (only General is the whole group) behind a compat switch, so every deploy is safe before the Join UI: while PUBLIC_TOPICS_START_EMPTY is false, new public topics and new group members still get everyone"
status: merged
milestone: M5
branch: task/T-1762-topic-reads-compat
model: auto
effort: default
depends_on: [T-1754, T-1760]
estimate: 45 min
---

# T-1762: Re-apply the new topic reads, safely

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-16, `docs/design/mockups/topic-people/README.md` "Round 2"): **a new public topic includes nobody until people join**; General stays everyone.
- **T-1754 and T-1760 (merged and live)** gave public topics real `topic_members` rows, plus join and leave on the server.
- **T-1757** switched every membership read to "only General is the whole group". It was merged as `ab2ad0cd0`, then reverted on main as `dfec87794`: deployed before the Join UI exists, new public topics would hold only their creator, and new group members would be in no public topic, with no way to join.

This task re-applies T-1757 behind a **compat switch**. While the switch is off, new public topics and new group members still get everyone, so users see no change and main can be deployed at any time. The Join UI batch turns it on later.

### Facts (read by the lead on 2026-10-16)
- **What to re-apply:** `git revert --no-edit dfec87794` on your branch restores T-1757 exactly:
  - the reads in `apps/server/src/topics/{views,queries,room-members,ai-access,access}.ts`, `apps/server/src/agents/gateway/db.ts` and `apps/server/src/groups/topic-rooms.ts`;
  - comments in `apps/server/src/roles/access.ts`, `apps/server/src/routines/preflight.ts` and `apps/server/src/groups/members.ts`;
  - migration `apps/server/drizzle/0070_topic-members-backfill-again.sql`;
  - the test `apps/server/src/topics/public-reads.test.ts`;
  - the task file `work/T-1757-topic-members-reads.md` and its `work/BOARD.md` line.
  - `dfec87794` reverts only that, so its revert is clean on top of main.
- **New public topic members today** (T-1754): `createTopic` in `apps/server/src/topics/service.ts` (183 lines) inserts `initialMemberIds = visibility === 'private' ? memberIds : [input.actorId]` (around `:106`).
- **The three paths that add a person to a group,** each followed by a topic room sync:
  - `apps/server/src/groups/join.ts:125-139` (a public group join; `syncPublicTopicsByLink(linkDeps, groupId)` at `:139`);
  - `apps/server/src/invite-links/join.ts:148-164` (an invite link; the sync at `:164`; `syncPublicTopicsByLink` is defined at `:251`);
  - `apps/server/src/groups/members.ts:84-100` (an owner adds people; the "T-0108: public topics gain the new members" sync follows).
  - Group creation (`apps/server/src/groups/service.ts:149`) has only General then, so nothing is needed there.
- **`topic_members`** is `(topic_id, user_id, added_by NOT NULL, added_at)` with primary key `(topic_id, user_id)` (`apps/server/drizzle/0018_lethal_warhawk.sql:1-7`).

### Steps
1. **Re-apply:** run `git revert --no-edit dfec87794` as your first commit. If it doesn't apply cleanly, stop and report.
2. **The switch:** a new `apps/server/src/topics/public-compat.ts` with:
   - `export const PUBLIC_TOPICS_START_EMPTY = false;`, with a comment: Julio's rule; it's `false` until the Join UI ships (web W9 and phone W10 in `docs/plan/topic-people.md`), and that batch sets it to `true`.
   - `initialPublicMemberIds(db, groupId, creatorId, startEmpty = PUBLIC_TOPICS_START_EMPTY)`: `[creatorId]` when `startEmpty`, and otherwise every current `group_members.user_id` of the group (the creator included).
   - `addToPublicTopics(db, groupId, userIds, startEmpty = PUBLIC_TOPICS_START_EMPTY)`: a no-op when `startEmpty`. Otherwise one `INSERT INTO topic_members (topic_id, user_id, added_by) SELECT t.id, u.id, u.id FROM topics t CROSS JOIN unnest(${userIds}) … WHERE t.group_id = … AND t.visibility = 'public' AND t.is_general IS FALSE AND t.archived_at IS NULL ON CONFLICT DO NOTHING`. Or an equivalent safe parameterised insert.
3. **Use it:**
   - `createTopic` uses `initialPublicMemberIds` for a public topic;
   - each of the three join paths calls `addToPublicTopics` for the newly added user ids **after** their `group_members` insert has committed and **before** its topic room sync, so the sync sees the rows.
   - Keep every file at most 400 lines.
4. **Tests (the membership rule, 2):** put them in the existing `apps/server/src/topics/public-members.test.ts` (from T-1754), and update its "only the creator" assertion to the compat default.
   - `initialPublicMemberIds` returns only the creator with `startEmpty = true`, and every group member with `false`;
   - with the compat default, a person added to the group through the `groups/members.ts` path gets a `topic_members` row in an existing public topic, but not in a private one.

### Allowed files
- `apps/server/drizzle/0070_topic-members-backfill-again.sql`
- `apps/server/src/agents/gateway/db.ts`
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/topic-rooms.ts`
- `apps/server/src/roles/access.ts`
- `apps/server/src/routines/preflight.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/ai-access.ts`
- `apps/server/src/topics/public-reads.test.ts`
- `apps/server/src/topics/queries.ts`
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/topics/views.ts`
- `work/BOARD.md`
- `work/T-1757-topic-members-reads.md`
- `apps/server/src/topics/public-compat.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/invite-links/join.ts`
- `apps/server/src/topics/public-members.test.ts`
- `apps/server/src/topics/join-leave.test.ts` (lead, after the BLOCKED report)
- `work/T-1762-topic-reads-compat.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/public-members.test.ts src/topics/public-reads.test.ts src/topics/join-leave.test.ts src/topics/ais.test.ts src/topics/visible-batch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- T-1757's reads are back.
- With `PUBLIC_TOPICS_START_EMPTY = false`, a new public topic starts with every group member, and a new group member is added to every existing public topic: users see no change.
- Setting the switch to `true` gives Julio's rule.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

1. **Re-applied T-1757 as the first commit** `1f35b8b6c` (`git revert --no-edit dfec87794`),
   which applied cleanly: 14 files, +458/−55, exact restore of the reads, migration 0070,
   `public-reads.test.ts`, the T-1757 task file and its BOARD line.

2. **The compat switch** in `apps/server/src/topics/public-compat.ts` (new):
   - `PUBLIC_TOPICS_START_EMPTY = false`, with Julio's rule in a comment.
   - `initialPublicMemberIds(db, groupId, creatorId, startEmpty = PUBLIC_TOPICS_START_EMPTY)`:
     `[creatorId]` when `startEmpty`, otherwise every `group_members.user_id`.
   - `addToPublicTopics(db, groupId, userIds, startEmpty = PUBLIC_TOPICS_START_EMPTY)`: no-op
     when `startEmpty`; otherwise one `INSERT … SELECT … CROSS JOIN unnest(${userIds}::text[])`
     with a `topics` filter on `visibility = 'public'`, `is_general IS FALSE`,
     `archived_at IS NULL` and `ON CONFLICT DO NOTHING`.

3. **Used it:**
   - `topics/service.ts`: a public topic uses `initialPublicMemberIds` (private unchanged).
   - `groups/members.ts`: `addToPublicTopics(db, groupId, toAdd)` after the membership
     transaction commits, before `syncGroupTopicRooms`.
   - `groups/join.ts` and `invite-links/join.ts`: `addToPublicTopics(db, groupId, [userId])`
     after the join returns `joined`, before `syncPublicTopicsByLink`.

4. **Tests:** in `public-members.test.ts` I updated the old "only the creator" test to the
   compat default and added the two required tests (the `initialPublicMemberIds` `true`/`false`
   pair; a member added through `groups/members.ts` gets a `topic_members` row in an existing
   public topic but not in a private one). In `public-reads.test.ts` the T-1757 fixture now
   drops the two outsiders after `createTopic`, because the compat default seeds every group
   member and the reads test needs the T-1757 "only some members" shape.

5. **Bug fixed during the work:** my first `addToPublicTopics` cast the ids to `uuid[]`, but
   every id column here is `text` (and invite-link tests create non-uuid user ids), which made
   link joins 500 with `invalid input syntax for type uuid`. Changed to `::text[]`; the
   invite-links suite passes again.

6. **`join-leave.test.ts`** (added to Allowed files after the BLOCKED report): kept both tests
   meaningful under the compat default, which now seeds every group member, instead of just
   flipping the expectations:
   - "lets a plain group member join a public topic" deletes the member's `topic_members` row
     after `createTopic`, asserts they are out, then asserts `joinTopic` puts the row back (a
     real join, not an already-in no-op);
   - "refuses a manager removing someone else from a public topic" asserts the member list is
     unchanged (`[owner, member].sort()`, what `createTopic` left) after the refused removal,
     with a comment saying why.

Files changed (all inside Allowed files): `topics/public-compat.ts` (new),
`topics/service.ts`, `groups/members.ts`, `groups/join.ts`, `invite-links/join.ts`,
`topics/public-members.test.ts`, `topics/public-reads.test.ts`, `topics/join-leave.test.ts`,
`work/T-1762-topic-reads-compat.md`.

### Checks run

- Spec Checks (`cd apps/server && pnpm exec vitest run … --reporter=dot`):
  `Test Files 5 passed (5)`, `Tests 14 passed (14)`.
- Targeted while working: `public-members.test.ts` + `public-reads.test.ts` → 6 passed;
  `invite-links.test.ts` → 22 passed (after the `::text[]` fix); `ais.test.ts` +
  `visible-batch.test.ts` → passed.
- `pnpm gate` from the repo root:
  ```
  gate: 21 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (33.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The revert of `dfec87794` applied cleanly, as the Spec said.
- The Spec wrote `unnest(${userIds})` for the insert; I had to name the cast `::text[]` because
  the ids are not uuids. Worth folding into the Spec wording if you re-use it.
- After you added `apps/server/src/topics/join-leave.test.ts` to Allowed files I made the two
  tests meaningful as you asked (delete-then-join; unchanged-list-after-refused-remove), not
  just flipping the expected arrays, so both still prove something under the compat default.
- The task file's own text (`work/T-1757-topic-members-reads.md`, `work/BOARD.md`) came back with
  the revert; I did not otherwise touch them.

### Round 2 (PREREVIEW fix round)

PREREVIEW.md counts: must-fix=0, should-fix=1 (finding 1), nit=2 (findings 2 and 3).

- **Finding 1 (should-fix) — fixed** in commit `1040a4f8c`
  (`T-1762: fix finding 1 - …`). `addToPublicTopics` is now best effort at all
  three call sites (`groups/members.ts`, `groups/join.ts`,
  `invite-links/join.ts`): each call is wrapped in a `try/catch` that logs a
  warning with ids only (`groupId`, `userIds`; never a topic name) and falls
  through to the room sync. A failure after the `group_members` commit no longer
  fails the join, and the committed membership is untouched. This is the
  reviewer's first suggestion and matches the neighbouring room sync, which is
  already best-effort. I did not take the "repair on the already-joined path"
  alternative: under the compat default every group member is seeded into every
  public topic, so re-adding a member who calls join again would silently undo a
  `leaveTopic`. Test added in `public-members.test.ts`: *"keeps the membership
  when the public-topic write fails (best effort)"* — it stubs
  `addToPublicTopics` to reject once, then asserts `addGroupMembers` resolves,
  the member is in `group_members`, the warning was logged and the topic is
  unchanged.
- **Finding 3 (nit) — fixed in the same commit** (its lines are the call-site
  lines finding 1 rewrites): the three comments no longer say the call is "a
  no-op while the Join UI is missing", which was backwards — while the switch is
  `false` the call actively inserts.
- **Finding 2 (nit) — accepted, code unchanged.** `initialPublicMemberIds`
  reads `group_members` before the `topic_members` insert, so a member joining
  between the two reads misses the new topic. The window is one uncovered by any
  line finding 1 touches, the reviewer marked it a nit and offered to close it
  later with an advisory lock, and the API `joinTopic` still lets a person in.
  Left as-is per the fix-round rule (do not touch nits outside lines already
  changed).

Checks run this round:

- Spec Checks with the worker cap:
  `pnpm exec vitest run src/topics/public-members.test.ts src/topics/public-reads.test.ts src/topics/join-leave.test.ts src/topics/ais.test.ts src/topics/visible-batch.test.ts --maxWorkers=2 --reporter=dot` →
  `Test Files 5 passed (5)`, `Tests 15 passed (15)` (14 before, +1 new test).
- `pnpm gate` from the repo root:
  ```
  gate: 21 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (40.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `6f2df0418`.
- The revert of `dfec87794` is the exact T-1757 diff.
- `topics/public-compat.ts` has `PUBLIC_TOPICS_START_EMPTY = false`. `initialPublicMemberIds` returns the whole group, and `addToPublicTopics` does a parameterised `unnest(${userIds}::text[])` insert on public, non-General, unarchived topics with `ON CONFLICT DO NOTHING`.
- All three join paths call it after the commit and before the room sync. It is best effort, and its log carries ids only, which fixes the pre-review's should-fix: a failure no longer leaves a member who can't be repaired.
- The join-leave tests are still meaningful: the member's row is deleted, then re-joined, and the list is unchanged after the refused removal.
- I ran public-members, public-reads, join-leave, ais, visible-batch and invite-links: 39 passed.
- Nit 2, the narrow race between reading the group and creating a topic, is accepted. `joinTopic` repairs it, and it goes away when the switch flips to `true`.
- The Join UI batch (W9/W10) flips the switch.
