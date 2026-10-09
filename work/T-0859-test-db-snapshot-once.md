---
id: T-0859
title: "Server tests: build the migrated PGlite snapshot once per run (globalSetup), not once per test file"
status: todo
milestone: M5
branch: task/T-0859-test-db-snapshot-once
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0859: Server tests: build the migrated PGlite snapshot once per run (globalSetup), not once per test file

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding F-F1 in `docs/audit/simplify-2026-10-09/F-tests.md`.
- **Rebuilt per file:** `apps/server/src/test-support.ts:285-300` keeps `migratedSnapshot` in a module variable. Vitest reloads modules per file, so each of the 85 DB test files re-runs the 47 migrations and dumps a 40 MB snapshot.
- **The cost:** the first `createTestContext` in a process took 987 ms, against 2 ms after.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add a vitest `globalSetup` for the server package. It migrates once and writes the snapshot to a temp file (a per-run path, cleaned up in teardown). Make `test-support.ts` load that file instead of migrating, falling back to today's path when the file is missing (a single-file run without the global setup).
2. Wire it in through the server's vitest config. The server has none today, so create `apps/server/vitest.config.ts` that keeps the `package.json` test flags' meaning (`--testTimeout=30000 --hookTimeout=30000`).
3. `db/migrate.test.ts` must still test the migrations themselves.
4. **Measure** the full server suite wall time before and after, on a quiet machine if you can (check `uptime`), and report both. Run the full server suite once at the end; that is the only full-suite run allowed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/test-support.ts`, `apps/server/vitest.config.ts`, `apps/server/src/test-global-setup.ts`, `apps/server/package.json`, `work/T-0859-test-db-snapshot-once.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/db src/blocks src/pins
pnpm --filter @zilar/server typecheck
pnpm --filter @zilar/server test --reporter=dot   # once, at the end
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
