---
id: T-1137
title: "Size: client-core store/lifecycle.ts (405) and server auth/sql-adapter.ts (404) under 400 — readLastRead moves to store/last-read.ts, the table/where SQL builders move to auth/sql-where.ts, byte-for-byte; their tests unedited"
status: merged
milestone: M5
branch: task/T-1137-trim-lifecycle-sql-adapter
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1137: Two files just over 400 lines

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10). Two crucial files are just over it:
- `packages/client-core/src/store/lifecycle.ts` (405 lines), the message pipeline boot;
- `apps/server/src/auth/sql-adapter.ts` (404 lines), the Better Auth SQL adapter.

Each has a self-contained piece that can move **unchanged**.

**What the lead read:**
- **`lifecycle.ts`:**
  - `parseJson` (`:34`) is used only by `readLastRead` (`:62-95`, exported, with its doc comment at `:62`);
  - `readLastRead` is called at `:254`;
  - the other importer is `packages/client-core/src/store/lifecycle.test.ts`.
- **`sql-adapter.ts`:** the table and field mapping and the where-clause builders run from `TABLES` (`:24`) through `whereFragment` (`:133-150`): `tableFor`, `columnFor`, `toColumns`, `likePattern`, `clauseFragment` and `whereFragment`. `makeAdapter` (`:224`) uses them. The tests are `apps/server/src/auth/sql-adapter.test.ts` and `apps/server/src/auth/auth.test.ts`.

### What to build
1. **Commit 1, client-core:**
   - Move `parseJson` and `readLastRead`, with its doc comment, into a new `packages/client-core/src/store/last-read.ts`, **byte-for-byte**, with the imports they need.
   - `lifecycle.ts` imports `readLastRead` from there and re-exports it (`export { readLastRead } from './last-read'`), so every importer keeps working.
   - Remove imports that `lifecycle.ts` no longer uses.
2. **Commit 2, server:**
   - Move `TABLES`, `AuthTable`, `FIELD_NAMES`, `tableFor`, `columnFor`, `toColumns`, `likePattern`, `clauseFragment` and `whereFragment` into a new `apps/server/src/auth/sql-where.ts`, **byte-for-byte**, exporting what `sql-adapter.ts` uses.
   - `sql-adapter.ts` imports them. Its own exports are unchanged.
3. **No behaviour change.** No body edits, apart from adding `export`.
4. **Tests:** run `packages/client-core/src/store/lifecycle.test.ts`, `apps/server/src/auth/sql-adapter.test.ts` and `apps/server/src/auth/auth.test.ts`. **Do not edit them.**
5. **Line counts:** paste `wc -l` for the four files in the Report; each is at most 400 lines.

### Read first
`AGENTS.md`, `packages/client-core/src/store/lifecycle.ts` and `apps/server/src/auth/sql-adapter.ts`.

### Allowed files
`packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/last-read.ts`, `apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-where.ts`, `work/T-1137-trim-lifecycle-sql-adapter.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts --reporter=dot
pnpm --filter @zilar/server exec vitest run src/auth/sql-adapter.test.ts src/auth/auth.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with no test edited.
- Each of the four files is at most 400 lines.

---

## Report (written by the worker when done)

### What I did
Mechanical file split, no behaviour change.

1. **client-core:** moved `parseJson` and `readLastRead` (with its doc comment) into the new `packages/client-core/src/store/last-read.ts`, byte-for-byte, with the imports they need (`Effect`, `Exit`, `Schema`, `KeyValue`, `LAST_READ_PREFIX`). `lifecycle.ts` now imports `readLastRead` from `./last-read` for its use at the boot, re-exports it with `export { readLastRead } from './last-read'`, and dropped its now-unused `Schema`, `KeyValue` and `LAST_READ_PREFIX` imports.
2. **server:** moved `TABLES`, `AuthTable`, `FIELD_NAMES`, `tableFor`, `columnFor`, `toColumns`, `likePattern`, `clauseFragment` and `whereFragment` into the new `apps/server/src/auth/sql-where.ts`, byte-for-byte, exporting `tableFor`, `columnFor`, `toColumns` and `whereFragment` (the four `sql-adapter.ts` uses). `sql-adapter.ts` imports those four; its own exports are unchanged and it dropped the now-unused `Statement` import.
3. **Tests:** unedited. Neither `lifecycle.test.ts` nor `sql-adapter.test.ts` / `auth.test.ts` was touched.
4. Added the one-line header note in `sql-adapter.ts` that referenced "the field map below" → now "the field map in `sql-where.ts`" (the map physically moved). No code change.

### Files changed (Allowed files only)
- `packages/client-core/src/store/lifecycle.ts` (edited)
- `packages/client-core/src/store/last-read.ts` (new)
- `apps/server/src/auth/sql-adapter.ts` (edited)
- `apps/server/src/auth/sql-where.ts` (new)
- `work/T-1137-trim-lifecycle-sql-adapter.md` (this report + status)

### Deviations / notes
- The moved set uses one helper that the spec left in `sql-adapter.ts`: `clauseFragment` calls `bindValue`, which stays (it is defined after `whereFragment`). I therefore added `export` to `bindValue` and `sql-where.ts` imports it from `./sql-adapter`, which makes `sql-where.ts` ↔ `sql-adapter.ts` a module cycle. It is harmless here: `bindValue` is a hoisted function declaration, neither module calls the other at evaluation time, and the server tests plus the gate pass. The alternative (moving `bindValue` too) would have deviated from the spec's explicit moved list, so I kept the spec's list and note the cycle here.
- Diff of the moved server block against the original shows only the four added `export` keywords; the client block diff is empty (byte-for-byte).

### Commands run (real results)
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` → **Test Files 1 passed (1), Tests 8 passed (8)**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test.ts src/auth/auth.test.ts` → **Test Files 2 passed (2), Tests 44 passed (44)**.
- `pnpm gate` (repo root) → summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.7s)
  PASS  lint  (1.7s)
  PASS  typecheck  (4.5s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/client-core  (3.2s)
  PASS  tests @zilar/server  (20.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Line counts (`wc -l`, limit 400)
```
371 packages/client-core/src/store/lifecycle.ts
 41 packages/client-core/src/store/last-read.ts
278 apps/server/src/auth/sql-adapter.ts
133 apps/server/src/auth/sql-where.ts
```

### Security checklist
No auth, permission, secret or SQL semantics changed: this is a pure code move with the same bodies and the same generated SQL.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **Line counts:** client-core `store/lifecycle.ts` 405→371 (`readLastRead` moves to `last-read.ts`, 41 lines, and is re-exported); server `auth/sql-adapter.ts` 404→279 (the table and where builders move to `sql-where.ts`, 133 lines).
- **The lead's line check:** the only lines from main missing from the new files are the functions that gained `export` and changed imports. The header comment is kept, now pointing at `sql-where.ts`.
- **Accepted nit:** `sql-where.ts` imports `bindValue` back from `sql-adapter.ts`, a harmless function-level cycle.
- **Tests:** the lead ran them on the branch: `lifecycle.test.ts` 8 green, `sql-adapter` and `auth` 44 green. No test was edited.
