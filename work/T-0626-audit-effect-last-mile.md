---
id: T-0626
title: "Audit: the Effect last mile; every file still on drizzle, hono or zod grouped by what blocks it, an ordered list of small tasks, and a check for bigint columns read as numbers through effect/sql; writes docs/audit/effect-last-mile.md only"
status: merged
milestone: M5
branch: task/T-0626-audit-effect-last-mile
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0626: plan the Effect last mile

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. About 52 non-test files still import a legacy library. Many of the rest are blocked by something else: a caller's drizzle transaction, tests that mount an old Hono router, or the server shell. The lead needs one plan to cut small tasks from.

### Verified facts (do not re-derive)
- **The list of files** comes from this command, run from the repo root:
  ```bash
  git grep -lE "from '(drizzle-orm|hono|@hono/|zod|zustand)" -- 'apps' 'packages' ':!*.test.ts' ':!*.test.tsx'
  ```
  Then drop the lines that are `import type` only.
- **Item-11 Hono wrappers.** Many `apps/server/src/*/routes.ts` files are thin Hono wrappers that tests still mount. One example is `apps/server/src/files/routes.ts`; `docs/EFFECT_GUIDE.md` item 11 explains them.
- **Functions that must stay on drizzle until their caller's transaction moves:**
  - `approvals/rules.ts` `createRule`, `findActiveRuleForUpdate` and `revokeActiveRulesForAiInGroup`;
  - `tools/service.ts` `deleteToolsForAiInGroup` and `deleteToolsForAiInTopic`;
  - `connections/service.ts` `decryptForGatewayUse`;
  - the setup settings cluster: `setup/settings.ts`, `integrations/settings.ts` and `setup/api.ts`, which share `SetupTransaction`.
- **effect/sql returns a Postgres `bigint` as a string.** drizzle's `bigint(..., { mode: 'number' })` (for example `media_items.at_micros`, `apps/server/src/db/schema.ts:1400`) types it as `number`. A converted query that reads such a column with `SELECT *` and the drizzle row type then hands a string to code that expects a number.

### What to build (one file: `docs/audit/effect-last-mile.md`)
1. **Inventory:** a table with one row per file: path, lines, legacy libraries, group (below), and what blocks it, with `file:line`.
   - **A, test-only Hono wrappers:** which tests mount each one (path list), and what those tests need, such as an injected `fetchImpl` or `now`.
   - **B, the server shell:** `app.ts`, `index.ts`, `effect/http.ts`, `push/api.ts`, `audit/api.ts`, and any other file where Hono still serves traffic.
   - **C, drizzle waiting for a caller's transaction:** draw each chain, caller to callee.
   - **D, drizzle core:** `db/client.ts`, `db/migrate.ts`, `db/schema.ts`, `auth/auth-schema.ts` (better-auth), `auth/cli-config.ts`, `test-support.ts`, `effect/sql.ts`. For each, say what has to happen first.
   - **E, zod leftovers:** each, with the reason it is still there.
   - **F, plain drizzle modules:** files with no blocker that can be converted now.
2. **Ordered task list:** small tasks of at most one module or one chain each, in dependency order. For each, give the files, the tests to run, and a size (S under 0.5 day, M up to 1 day).
3. **The bigint check:**
   - list every bigint column in `apps/server/src/db/schema.ts`;
   - then list every effect/sql query in `apps/server/src` (grep for `SqlClient.SqlClient`) that returns one of those columns, with `file:line`;
   - for each, say whether the code treats the value as a number (arithmetic, comparisons, `JSON` output, `Date` math) and could now get a string;
   - mark each **safe** or **bug**, with the evidence. A query that casts in SQL (`::int`, `::float8`) or converts with `Number(...)` is safe.
4. **No code changes.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-sql-migration.md`, `docs/audit/effect-everywhere-plan.md`, `apps/server/src/effect/sql.ts`.

### Allowed files
`docs/audit/effect-last-mile.md`, `work/T-0626-audit-effect-last-mile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/effect-last-mile.md` exists with the inventory, the ordered task list and the bigint check.
- Every claim cites a `file:line`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/effect-last-mile.md` only (no code changes). It contains:

1. **Inventory.** The 50 non-test files still importing a legacy library (the
   spec's grep returns 52; `apps/server/src/errors.ts:1` and
   `apps/server/src/git/proxy.ts:1` are dropped as `import type`-only), one row
   each with path, line count, legacy libraries, group (A–F) and the `file:line`
   blocker. Group A lists each wrapper and the tests that mount it plus the
   injected seams; group B the server shell (including `git/proxy.ts`, which is
   type-only in imports but a real Hono handler); group C the four
   caller→callee transaction chains; group D the drizzle core in removal order;
   group E the four zod leftovers with reasons; group F the 12 plain drizzle
   modules.
2. **Ordered task list.** Phases C1–C4 (chains), F1–F10 (no-blocker modules),
   A1–A12 (retire Hono wrappers), E1–E4 (zod), then D1/D2/D3 and the B1 edge
   flip, each with files, tests and an S/M size.
3. **The bigint check.** The three `bigint` columns
   (`db/schema.ts:1400,1443,1529`), the single `effect/sql` query that returns
   one (`media/api.ts:359`, marked **safe** because of `Number(...)` at
   `:367`), and a watch-list for the drizzle reads that will become strings on
   conversion (`media/indexer.ts:320`, `agents/memory/indexer.ts:217`,
   `files/api.ts:95`) — all naturally safe because they pass through `BigInt()`.

### Files changed

- `docs/audit/effect-last-mile.md` (new).
- `work/T-0626-audit-effect-last-mile.md` (status + this Report).

### Commands and real results

- `pnpm install` — `Done in 17s using pnpm v10.32.1` (peer-dependency warnings for the mobile `@types/react-dom`; pre-existing).
- `git grep -lE "from '(drizzle-orm|hono|@hono/|zod|zustand)" -- 'apps' 'packages' ':!*.test.ts' ':!*.test.tsx'` — 52 files; minus two type-only files = 50 inventory rows.
- `pnpm gate` (from the repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (24.3s)
  PASS  lint  (1.9s)
  PASS  typecheck  (1.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No files outside the Allowed files. `git status --short` shows only the two
  allowed files.

I did not run any single test file: the task touches no code, so per
`AGENTS.md` I ran only `pnpm gate` once at the end.

### Problems / deviations

- **`deleteToolsForAiInTopic` is not blocked by a caller transaction.** The
  spec lists it with `deleteToolsForAiInGroup` as "waiting for a caller's
  transaction", but `topics/service.ts:920` passes `deps.db`, a real handle. The
  actual blocker is `tools/service.test.ts:820,858`, which drives both functions
  inside a raw drizzle transaction. I documented that in chain C2; the plan is
  otherwise unchanged.
- **`db/schema.ts` is in two groups** (D for the drizzle schema, E for the two
  zod enums). It has one inventory row, marked D, with the zod note.
- **`git/proxy.ts` and `errors.ts`** are dropped as type-only per the spec's
  rule, but both still matter (a live Hono handler and Hono's
  `ContentfulStatusCode` in the error mapping); they are called out in group B.
- **`invite-links/routes.ts`** is not a wrapper tests mount; it is a Hono-typed
  socket helper kept only for the invite-links test, and its `clientIpFor`
  helper looks unused (its comment at `:47-49` still says the setup limiter runs
  on Hono). I put it in group A with that note.

### Open questions

- None blocking. The plan depends on two decisions already open to the lead in
  `docs/audit/effect-sql-migration.md`: the better-auth adapter (§c) and the
  migration-runner timing (§b); task D2 is marked as needing the adapter
  decision first.

### Round (fix round 1)

- **Findings fixed:** 1 should-fix. E4 now lists `avatars/api.ts` alongside
  `db/schema.ts` and `avatars/service.ts`; that file imports
  `avatarOwnerKindSchema` from `./service` (`avatars/api.ts:38`) and decodes
  with it (`avatars/api.ts:100`), so it moves with the enum. No must-fix
  findings.
- **Nits not touched:** 2–4, per instructions (nits are only changed if they
  fall on a line already edited; none does).
- **Tests added:** none. The change is documentation only and the finding
  names no test.
- **Gate:** `pnpm gate` ends with `GATE PASS`, no files changed outside the
  Allowed files.

### Round (fix round 2)

- **Findings fixed:** 1 should-fix (the new pre-review finding 1, "Chain C
  misses two tx-riding callees; two group-F rows are wrong"). All edits are in
  `docs/audit/effect-last-mile.md`:
  - the inventory rows for `agents/memory/store.ts` (`:53`) and
    `routines/service.ts` (`:83`) moved from group F to group C, citing the
    `groups/service.ts:1114` / `:1106` edges;
  - a new chain **C5 · routines and room memory** documents both callees
    (`routines/service.ts:468`, `agents/memory/store.ts:522`) and the shared
    `groups/service.ts:1067` transaction, plus the non-blocked siblings
    (`topics/service.ts:921,924`, `agents/memory/cleanup.test.ts:250,263`);
  - §F no longer lists the two files and says so explicitly;
  - a C5 row joined the Phase 2 table, the Phase 3 heading and the F3/F7 rows
    now say they wait for C5, and "After C1–C4" became "After C1–C5".
- **Placement note:** the finding said "add both callees to chain C1/C2"; I
  added them as a separate chain **C5** because routines and room memory are a
  third set of callees on the same `groups/service.ts:1067` transaction (C1 is
  approvals, C2 is tools). The facts the finding requires (both callees, the
  `:1106`/`:1114` edges, the F3/F7 dependency) are all present.
- **Nits:** nit 3 ("other four transactions" followed by five) sat on the
  `After C1–C4 …` line I had to edit for C5, so I corrected it to "other five"
  there. Nit 2 (the "74 import lines" count) was not on a line I changed, so I
  left it untouched per the fix-round instructions.
- **Tests added:** none. The finding names no test and the change is
  documentation only.
- **Gate:** `pnpm gate` (from the repo root) ends with `GATE PASS`:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (15.3s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No file outside the Allowed files. I ran no single test: the change is
  documentation only, so per `AGENTS.md` I ran only `pnpm gate` once.

### Lead fix round (2026-10-08)

Three commits, `docs/audit/effect-last-mile.md` only:

1. **Machines tests/A5.** The group-A row for `machines/routes.ts` and task A5
   now list both mounted tests, `machines/routes.test.ts` and
   `machines/hub.test.ts:27,684`, and name the `isMachineOnline` seam
   (`routes.ts:41`, passed at `:688`, used in `api.ts:231,310`) that A5 must keep
   reachable once the wrapper is gone.
2. **`ais/service.ts` transactions.** Its inventory row now lists the six
   further transactions that take no caller-supplied transaction (`:402`,
   `:465`, `:490`, `:533`, `:561`, `:1011`), and a new **C3b** task (size M)
   follows C3. The "After C1–C5 the remaining group C files are done" sentence
   was reworded: group C is not finished (C3b remains, and `groups/service.ts`
   may still need a second pass).
3. **Nits.** The import-line count is now 75 (re-ran the spec's grep on current
   `main`: 52 files / 75 import lines), and the `SetupTransaction` re-export
   citation is `integrations/routes.ts:233` (verified).

**Gate:** `pnpm gate` (from the repo root) ends with `GATE PASS`:
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (25.7s)
PASS  lint  (1.3s)
PASS  typecheck  (1.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```
No file outside the Allowed files. No single test was run: documentation only.

## Review (written by Claude)

**2026-10-08, lead:** approved after 2 automatic rounds and 1 lead round.
- **Pre-review:** clean. The packet head is 74f00514, the current HEAD.
- **Lead check:**
  - groups A-F are well sorted, and the task list is in dependency order;
  - the bigint check found no bug and leaves a watch-list;
  - added in the review rounds: the transaction chains for `deleteRoomMemory` and `deleteRoutinesForAiInGroup`, `machines/hub.test.ts`, and the six other `ais/service.ts` transactions.
- **In use:** T-0627 to T-0640 were cut from this plan.
