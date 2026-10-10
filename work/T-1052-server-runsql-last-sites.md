---
id: T-1052
title: "Dedup F1 (S1): the last service-level sqlRuntimeFor(db).runPromise calls use runSql"
status: merged
milestone: M5
branch: task/T-1052-server-runsql-last-sites
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1052: The last `runSql` sites

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §1 (slice S1): `apps/server/src/effect/sql.ts:111` `runSql(db, effect)` is exactly `sqlRuntimeFor(db).runPromise(effect)`. Four service files still call the runtime directly (lead read, main 2026-10-10):
- `apps/server/src/blocks/service.ts:138`
- `apps/server/src/pins/service.ts:129`
- `apps/server/src/roles/service.ts:84`
- `apps/server/src/voice-transcription/pipeline.ts:157`

### What to build
1. **The swap:** in each of the four files, replace `sqlRuntimeFor(X).runPromise(Y)` with `runSql(X, Y)`. Keep the argument expression exactly as it is (for example `insert.pipe(Effect.mapError(mapPinError))` in pins).
2. **Imports:** drop `sqlRuntimeFor` from each file's `../effect/sql` import once it has no other use there (`grep` first). `blocks`, `pins` and `roles` already import `runSql`.
3. **Out of scope, do not touch:**
   - `apps/server/src/pins/access.ts:48` and `apps/server/src/auth/sql-adapter.ts:155` (permissions and auth files);
   - `apps/server/src/app.ts:597` and `apps/server/src/db/migrate.ts:9`;
   - `apps/server/src/test-support.ts`.

### Read first
`AGENTS.md`, `apps/server/src/effect/sql.ts:95-120`, and the four files.

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/voice-transcription/pipeline.ts`, `work/T-1052-server-runsql-last-sites.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "sqlRuntimeFor(" apps/server/src --include=*.ts | grep -v test` lists only `effect/sql.ts`, `app.ts`, `db/migrate.ts`, `pins/access.ts`, `auth/sql-adapter.ts` and `test-support.ts`.

---

## Report (written by the worker when done)

### What I did
Replaced the four remaining service-level `sqlRuntimeFor(db).runPromise(effect)` call sites with `runSql(db, effect)` and dropped the now-unused `sqlRuntimeFor` import from each file:

- `apps/server/src/blocks/service.ts`: `sqlRuntimeFor(deps.db).runPromise(insert)` → `runSql(deps.db, insert)`; import narrowed to `import { runSql } from '../effect/sql';`.
- `apps/server/src/pins/service.ts`: `sqlRuntimeFor(deps.db).runPromise(insert.pipe(Effect.mapError(mapPinError)))` → `runSql(deps.db, insert.pipe(Effect.mapError(mapPinError)))` (argument expression kept verbatim); import narrowed to `runSql`.
- `apps/server/src/roles/service.ts`: `sqlRuntimeFor(deps.db).runPromise(` → `runSql(deps.db, ` (kept the existing multi-line body); import narrowed to `runSql`.
- `apps/server/src/voice-transcription/pipeline.ts`: `Effect.promise(() => sqlRuntimeFor(db).runPromise(effect))` → `Effect.promise(() => runSql(db, effect))`; import changed from `sqlRuntimeFor` to `runSql`.

No other files touched; no behaviour change (per `effect/sql.ts:111` `runSql` is exactly `sqlRuntimeFor(db).runPromise(effect)`).

### Commands and real results
- `pnpm install`: done, 1262 resolved, reused packages, no errors.
- `grep -rn "sqlRuntimeFor(" apps/server/src --include='*.ts' | grep -v test`: lists only `pins/access.ts`, `auth/sql-adapter.ts`, `app.ts`, `effect/sql.ts`, `db/migrate.ts` (and `test-support.ts` is filtered by `grep -v test`). The four target files no longer appear.
- `pnpm gate`: `gate: 5 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `GATE PASS`. (The 5 changed files are the 4 source files plus this task file.)

No single test file was run before the gate; the change is a drop-in refactor and the gate's nearest server tests cover it.

### Problems / deviations
None. No tests written (refactor of crucial pipeline code with no behaviour change).

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** four call sites go from `sqlRuntimeFor(db).runPromise(x)` to `runSql(db, x)`:
  - `blocks/service.ts`
  - `pins/service.ts`
  - `roles/service.ts`
  - `voice-transcription/pipeline.ts`

  Each argument expression is unchanged, and each file drops the `sqlRuntimeFor` import it no longer uses.
- **Same behaviour:** `runSql` (`effect/sql.ts:111`) is exactly `sqlRuntimeFor(db).runPromise(effect)`. The lead read every changed line.
- **Not touched:** `pins/access.ts`, `auth/sql-adapter.ts`, `app.ts`, `db/migrate.ts` and `test-support.ts` keep their direct calls, as the spec says.
- **Check:** the gate passed, including the `@zilar/server` tests.
