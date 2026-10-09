---
id: T-0851
title: "Topic list: batch toTopicViews (4 queries per topic today) into a few grouped queries"
status: todo
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

## Review (written by Claude)
