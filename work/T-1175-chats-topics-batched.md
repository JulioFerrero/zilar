---
id: T-1175
title: "PERF-4: GET /api/chats loads every group's visible topics and topic views in one batched pass (a fixed handful of queries) instead of ~10 queries per group, with the same visibility rules"
status: merged
milestone: M5
branch: task/T-1175-chats-topics-batched
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1175: One batched topics pass for the chat list

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md` PERF-4 (P1, confirmed). Every client polls `/api/chats` every 60 s and on focus, so this is the first scaling cliff on one Postgres.
- **The loop:** `apps/server/src/chats/api.ts:154-163` calls, for every group entry:
  - `visibleTopics` (`apps/server/src/topics/access.ts:171-218`): topics, membership, private topic members and role access, up to 4 queries;
  - then `toTopicViews` (`apps/server/src/topics/views.ts:301-325`, with `loadTopicViewParts` at `:164` running ~7 queries).
  A user in 10 groups costs about 100 queries per call.
- **`toTopicViews` already works on any list of rows,** so one call over all groups' rows works, then split by `groupId`. Its sort (`:316-323`) runs per group.
- **`access.ts` is 382 lines,** so the batched variant goes in a new file.

### What to build
1. **A new `apps/server/src/topics/visible-batch.ts`** exporting `visibleTopicsForGroups(db, groupIds: string[], userId): Promise<Map<string, TopicRow[]>>`, with **exactly** the rules of `visibleTopics`:
   - drop archived topics;
   - none at all for a group the user isn't a member of; use one membership query for all ids, matching what `getGroupMembership` checks (read it, and cite it);
   - private topics only through a direct `topic_members` row or `topic_role_access` and `group_member_roles`.
   Use one query each, with `sql.in(...)` over all ids.
2. **`chats/api.ts:152-163`:**
   - collect the group ids;
   - call `visibleTopicsForGroups` once;
   - call `toTopicViews` once over all visible rows;
   - group the views by their group id, keeping the order `toTopicViews` gives within each group.
   Keep the comment's guarantee: a group the user can't see never leaks in.
3. **`views.ts`:** only if needed to expose the group id on a view, or to sort per group. Keep `toTopicViews`'s signature for its other callers.
4. **Test** (permissions), 1, in a new `apps/server/src/topics/visible-batch.test.ts`, on the test database (`createTestContext` in `apps/server/src/test-support.ts`). For a user in two groups:
   - a public topic is seen;
   - a private topic with a direct member row is seen;
   - a private topic through a role is seen;
   - a private topic without access is hidden;
   - an archived topic is hidden;
   - a group the user isn't in gives nothing.
   Assert the batched result equals `visibleTopics` per group.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (PERF-4, PERF-11), `apps/server/src/chats/api.ts`, `apps/server/src/topics/access.ts:160-220`, `apps/server/src/topics/views.ts:150-325` and `apps/server/src/test-support.ts`.

### Allowed files
`apps/server/src/topics/visible-batch.ts`, `apps/server/src/topics/visible-batch.test.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/topics/views.ts`, `work/T-1175-chats-topics-batched.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/visible-batch.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- The Report states the query count per `/api/chats` call before and after, for a user in N groups.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/topics/visible-batch.ts`: `visibleTopicsForGroups(db, groupIds, userId)`
  returns `Map<string, TopicRow[]>` keyed by every requested group id (empty list for a group the
  caller is not in, and for a group with no visible topics). It reproduces `visibleTopics` exactly:
  - one `SELECT * FROM topics WHERE group_id IN (...)` for all groups, then drops archived rows;
  - one membership read `SELECT group_id FROM group_members WHERE group_id IN (...) AND user_id = ...`,
    the existence check that `getGroupMembership` (`access.ts:97-112`, `SELECT * ... LIMIT 1`) makes,
    so "member" means a row exists for (group, user);
  - one `topic_members` read and one `topic_role_access`⋈`group_member_roles` read over all private
    ids, matching `visibleTopics` (`access.ts:195-216`, including the T-0116 role path).
- `apps/server/src/chats/api.ts`: replaced the per-group loop with one `visibleTopicsForGroups` call
  over the group entries' ids, one `toTopicViews` call over all visible rows, then a split of the
  returned views by `view.groupId`. Splitting a single `toTopicViews` result keeps its per-group order
  (General first, then name/id), because filtering a sorted array preserves relative order. A
  non-member group stays absent from the map and gets `[]`.
- `apps/server/src/topics/views.ts`: **not changed.** `TopicView` already carries `groupId`
  (`access.ts:47`, set in `buildTopicView`, `views.ts:96`), so exposing the group id was not needed.
- Added `apps/server/src/topics/visible-batch.test.ts`: one DB test (`createTestContext`) with a user
  in two groups plus a third group they are not in. Asserts the batched map equals `visibleTopics`
  per group, and pins: public seen; private via direct `topic_members` row seen; private via role seen;
  private with no access hidden; archived hidden; non-member group yields nothing (even though it
  holds a public topic). Row lists are compared sorted by id so the assertion does not depend on
  unordered SQL results.

### Files changed

`apps/server/src/topics/visible-batch.ts` (new), `apps/server/src/topics/visible-batch.test.ts` (new),
`apps/server/src/chats/api.ts`, `work/T-1175-chats-topics-batched.md`. Nothing else.

### Query count per `/api/chats` call (user in N groups)

- **Before:** `visibleTopics` per group = up to 4 queries (topics, membership, private-member, private-role);
  `toTopicViews`/`loadTopicViewParts` per group = up to 9 (5 fixed + up to 3 conditional + role-holders).
  So up to **~10·N (audit's framing: ~5 + 10N ≈ 105 for N=10)**. Minimum per group with no topics is 1.
- **After:** one `visibleTopicsForGroups` = **up to 4 queries total**, one `toTopicViews` = **up to 9
  total** (min 5 when there are no private topics/owners). So up to **13 queries regardless of N**
  (independent of group count), including the ≥1 already-fixed list queries. For N=10 that is ~105 → ≤13.

### Commands run

```bash
pnpm install                                                               # ok
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/visible-batch.test.ts
#   Test Files 1 passed (1); Tests 1 passed (1)
pnpm gate                                                                  # GATE PASS (below)
```

`pnpm gate` summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (4.7s)
PASS  format  (1.5s)
PASS  lint  (1.6s)
PASS  typecheck  (5.8s)
PASS  effect  (1.0s)
PASS  tests @zilar/server  (6.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- `views.ts` was left untouched (allowed but not needed); see above.
- All touched files are ≤ 400 lines (visible-batch.ts 96, visible-batch.test.ts 140, api.ts 201).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **`visibleTopicsForGroups`:** the same rules as `visibleTopics` (archived dropped, members only, private by direct row or role), with one query each over all groups.
- **`/api/chats`:** one `toTopicViews` over all rows, split by `view.groupId`, which keeps the per-group order.
- **Queries:** a user in 10 groups goes from about 105 to at most 13.
- **Test:** batched equals per-group across the 6 visibility cases, 1 of 1 in the branch, run by the lead.
