---
id: T-0855
title: "Remove the unused drizzle migration snapshots (apps/server/drizzle/meta, 3.7 MB) and reword stale drizzle comments"
status: todo
milestone: M5
branch: task/T-0855-drizzle-leftovers
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0855: Remove the unused drizzle migration snapshots (apps/server/drizzle/meta, 3.7 MB) and reword stale drizzle comments

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding G-F7 in `docs/audit/simplify-2026-10-09/G-deadcode.md`.
- **The snapshots:** `apps/server/drizzle/meta/` holds 47 tracked files (3.7 MB) that no code reads now that drizzle is gone (T-0751).
- **The comments:** 66 comment lines in 19 files still describe drizzle.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. **Prove** that nothing reads `drizzle/meta` before deleting it: read `apps/server/src/db/migrate.ts` (it must read only the `*.sql` files, and maybe the journal), the Dockerfile COPY lines, and `grep -rn "meta" apps/server/src/db`. If the journal (`meta/_journal.json`) is still read, keep ONLY that file and say so.
2. Delete the rest.
3. Reword the 66 stale comments: find them with `grep -rni drizzle apps/server/src packages --include=*.ts`, excluding the migration adoption code that must keep naming the old journal table. Describe today's code, not history.
4. Change only comments, no code.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/drizzle/meta/**`, `apps/server/src/**/*.ts`, `packages/**/*.ts`, `work/T-0855-drizzle-leftovers.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/db
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
