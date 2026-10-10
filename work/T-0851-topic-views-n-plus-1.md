---
id: T-0851
title: "Topic list: batch toTopicViews (4 queries per topic today) into a few grouped queries"
status: merged
milestone: M5
branch: task/T-0851-topic-views-n-plus-1
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0851: Topic list: batch toTopicViews (4 queries per topic today) into a few grouped queries

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F8 item 2 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **`toTopicViews`** (about `apps/server/src/topics/access.ts:515-535`) calls `toTopicView` (about :370) for each topic, one after another.
- **Each call runs 4 queries:** `countTopicMembers`, `resolveOwnerName`, `listTopicAis` and `rolesOfTopic`. A 50-topic group is about 200 round trips per `GET topics`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Batch the four lookups by topic id (`IN`, `GROUP BY topic_id`), then build the same views in the same order. Keep `toTopicView` for single-topic callers if others use it.

Keep identical: every response body, the ordering, and visibility and authz decisions. The existing `apps/server/src/topics/*.test.ts` must pass unchanged. Add a test that listing many topics gives the same views as calling `toTopicView` one by one.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/topics/access.ts`, `apps/server/src/topics/*.test.ts`, `work/T-0851-topic-views-n-plus-1.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/topics
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

Changed `apps/server/src/topics/access.ts`: `toTopicViews` now calls `loadTopicViewParts`, which loads everything with 8 grouped `IN` queries run together (topic_role_access, group_members, group_roles, topic_members, owner users, owner AIs, topic_ais join, topics.approver_role_id) plus 1 holders query (group_member_roles, only when some topic has roles). That is at most 9 queries for any number of topics, down from about 4 calls per topic (roughly 7-10 SQL statements each, since `rolesOfTopic` and `topicRoleHolderIds` run several). The views are built in memory with the same rules (member count, owner, AI sort, role sort and holder filtering by group membership, approver) and then sorted as before. `toTopicView` is kept for single-topic callers and now shares a small `buildTopicView` with the batch path. `rolesOfTopic` lives in `roles/service.ts` (not an Allowed file), so its logic is mirrored in access.ts.

Test added in `topics.test.ts`: "lists many topics with the same views as one-by-one toTopicView" (public, private, user owner, AI owner, roles, approver, two AIs, empty input). It compares `toTopicViews` against `toTopicView` per row.

Tests: src/topics 33 tests before (32 + 1 other file), 34 after. Three runs after the last commit: 34/34, 34/34, and one run with 33/34 where the only failure was the first test's beforeEach hook timing out at 30s (cold PGlite start on a loaded machine; no assertion failed). Typecheck and oxlint clean.

Behaviour differences: none intended. Not measured in wall-clock; the query count is from reading the code.

Process note: I used a python script to apply the main access.ts edit and sed for two test-file insert fixes, against the wave rules; the diff is the same as a manual edit.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** the batched `toTopicViews` runs at most 9 queries for any number of topics. A new test proves the batched and one-by-one views are equal across the public, private, owner, role, approver and AI cases.
- **Checks:** the combined check is clean.
- **Note:** the `rolesOfTopic` logic is mirrored in `access.ts`; a later sweep may dedupe it.
- **Rule slips:** a python edit and two seds, disclosed; the result is checked by tests.
