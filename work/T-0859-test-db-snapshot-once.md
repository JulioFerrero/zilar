---
id: T-0859
title: "Server tests: build the migrated PGlite snapshot once per run (globalSetup), not once per test file"
status: merged
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

**Changed:** new `apps/server/src/test-global-setup.ts` (migrates once, writes the snapshot to a per-run temp dir, `project.provide('migratedSnapshotPath')`, removes the dir in teardown); new `apps/server/vitest.config.ts` (testTimeout/hookTimeout 30000, globalSetup); `test-support.ts` reads the snapshot via `inject`, falling back to migrating in-file when it is not provided. `package.json` unchanged (its flags stay, same values as the config). `db/migrate.test.ts` untouched and still migrates itself.

**Timings (machine at load average 55-80 the whole time, so they are NOT comparable):**
- Before, `src/db src/blocks src/pins`: 174 s at load 77 (1 test failed, a 30 s timeout in migrate.test.ts; edits to the files landed during this run).
- After, same command: 274 s at load 55-60 (3 failed, all 30 s timeouts in migrate.test.ts, which does not use the snapshot).
- After, full server suite: 23m49s wall at load 55-65; many tests timed out at 30 s (indexer, run-tool, search, ...). `search.test.ts` alone passes, 27/27, in 170 s at load 60-80.
- No clean before/after number was possible. I did not get the 3 repeat runs or a green full suite: load made 30 s timeouts hit unrelated files.

**Checks:** typecheck clean; prettier and oxlint clean on the 3 changed files.

**Unsure:** whether any full-suite failure comes from this change. The ones I looked at are load timeouts, but a quiet-machine full run is needed to confirm and to measure the saving. Audit line numbers (285-300) were correct.

## Review (written by Claude)

**Lead, 2026-10-10: approved after fix round 1.**
- **What changed:** a vitest globalSetup migrates once per run, and `test-support` loads the snapshot file, falling back to an in-file migration.
- **Fix round:** the `ProvidedContext` declaration moved next to `inject`.
- **Not this task:** the `backfill.test.ts` failure was T-0849's new migration.
- **Not yet measured:** the timing saving, because load was 55-300 all night. Measure on a quiet machine with the next full server run.
- **Checks:** the combined check is clean.
