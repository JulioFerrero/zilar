---
id: T-0925
title: "Server tests: one shared seed module (seedUser, seedAi, seedGroup with overrides) in apps/server/src/test-support, first used by approvals/ and tools/ (simplify plan 5.4, F-F4)"
status: merged
milestone: M5
branch: task/T-0925-server-test-seeds
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0925: Shared server test seeds, part 1

## Spec (written by Claude, do not edit)

### Why
This is simplify plan item 5.4, the server half (`docs/audit/simplify-plan.md` Phase 5; report `docs/audit/simplify-2026-10-09/F-tests.md` F4). Each server test file writes its own raw-SQL seed helpers. The lead counted on main on 2026-10-10: `seedAi` is defined in 27 test files, `seedGroup` in 15 and `seedUser` in 7, so a column change touches dozens of files. The copies also differ in defaults.

This first task builds the shared module and moves two directories to it. The seed helpers there:
- **`apps/server/src/approvals/`:**
  - `service.test.ts`: `seedUser` `:40`, `seedAi` `:58`, `seedGroup` `:100`;
  - `rules.test.ts`: `:44`, `:57`, `:94`;
  - `rules.routes.test.ts`: `seedAi` `:51`, `seedGroup` `:67`;
  - `routes.test.ts`: `seedAi` `:54`;
  - `sweeper.test.ts`: `seedUser` `:32`, `seedAi` `:43`;
  - `sweeper.effect.test.ts`: `:21`, `:32`.
- **`apps/server/src/tools/`:**
  - `service.test.ts`: `seedAi` `:74`, `seedGroup` `:89`;
  - `routes.test.ts`: `:27`, `:42`;
  - `adapters.test.ts`: `:77`, `:92`.

Shared test code already lives in `apps/server/src/test-support.ts` (`createTestContext` `:307`, `testSql` `:302`) and the `apps/server/src/test-support/` folder (`wait.ts`).

### What to build
1. **A new `apps/server/src/test-support/seed.ts`** with `seedUser`, `seedAi` and `seedGroup`:
   - each takes the `TestContext` and an `overrides` object for every column the copies above set differently;
   - each returns what the callers need (ids, and the AI's JID);
   - it writes through `testSql` and SqlClient, and reuses the row types from `apps/server/src/db/rows.ts` where they fit.
   - Add `apps/server/src/test-support/seed.test.ts`, a short test that each helper inserts a row and that the overrides apply.
2. **Move the 9 files above** onto it: delete each local copy and call the shared helper, passing overrides wherever a copy's defaults differ (for example a different `ai_limits`, name or status). The assertions and the test count of each file stay the same.
3. **Report:**
   - each default that differed between the copies, and which override keeps it;
   - the lines removed;
   - the test counts before and after per file.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `test-support/wait.ts` helpers), `apps/server/src/test-support.ts`, `apps/server/src/db/rows.ts`, and the 9 test files.

### Allowed files
`apps/server/src/test-support/seed.ts`, `apps/server/src/test-support/seed.test.ts`, `apps/server/src/approvals/service.test.ts`, `apps/server/src/approvals/rules.test.ts`, `apps/server/src/approvals/rules.routes.test.ts`, `apps/server/src/approvals/routes.test.ts`, `apps/server/src/approvals/sweeper.test.ts`, `apps/server/src/approvals/sweeper.effect.test.ts`, `apps/server/src/tools/service.test.ts`, `apps/server/src/tools/routes.test.ts`, `apps/server/src/tools/adapters.test.ts`, `work/T-0925-server-test-seeds.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/test-support src/approvals src/tools
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- Each moved file keeps its test count.
- No production file changes.
- The Report lists the differing defaults and the lines removed.

---

## Report (written by the worker when done)

### What I did
- New `apps/server/src/test-support/seed.ts`: `seedUser`, `seedAi` (returns `{ aiId, jid }`) and `seedGroup` (returns `{ groupId, generalTopicId }`). Each writes through `testSql`/`SqlClient` and takes an overrides object. `seedGroup`'s member role type reuses `GroupMemberRow['role']` and `seedAi`'s `status` reuses `AisRow['status']` from `db/rows.ts`.
- New `apps/server/src/test-support/seed.test.ts`: 3 tests (one per helper) that a row is inserted and the overrides apply.
- Moved the 9 listed files onto it: deleted each local `seedUser`/`seedAi`/`seedGroup` and imported `../test-support/seed`. No test declaration changed.

### Signatures
- `seedUser(context, { name?, email? })`
- `seedAi(context, ownerId, { name?, status?, perDayUsd?, perMonthUsd? })`
- `seedGroup(context, ownerId, members, aiIds, { title? })`

`members` keeps the `{ userId, role }` shape the approvals and tools/routes copies used, so none of those call sites changed. The two tools copies that passed plain member ids (`tools/service.test.ts`) or nothing (`tools/adapters.test.ts`) now pass `[{ userId: ownerId, role: 'owner' }]` at the call site (their extra-member lists were always empty).

### Differing defaults and the override that keeps each
- `seedAi` name: `'Helper AI'` in service/rules/rules.routes/routes/tools (7 copies) is the shared default; `'Helper'` in `sweeper.test.ts` and `sweeper.effect.test.ts` keeps it with `{ name: 'Helper' }` (7 calls). No assertion reads the name.
- `seedAi` return shape: `{ aiId, jid }` (service, rules, routes) vs `{ aiId }` (rules.routes, sweeper) vs bare `aiId` (tools, sweeper.effect). The shared helper returns `{ aiId, jid }` (spec: return the JID); the bare-value call sites now read `.aiId`.
- `seedUser`: `service.test.ts` also accepted an `email` override; the others only `name`. Defaults were identical everywhere (`'User'`, `${id}@example.com`), so nothing else changed.
- `seedGroup` members: approvals + tools/routes pass `Array<{ userId, role }>`; `tools/service.test.ts` passed `memberIds: string[]` (owner as `owner`, each id `member`); `tools/adapters.test.ts` passed none (owner as `owner`).
- `seedAi` `ai_limits` (`1.00`/`20.00`), `status` (`'active'`), `template`, `persona`, `model` did not differ across the 9 files; they stay as defaults and are reachable through overrides.
- `provider_connections` in the tools copies omitted `label` (NULL); the shared insert writes `label: null` — the same value.
- `seedGroup` title (`'Trip'`) and the general topic's name/glyph/visibility/kind/status/is_general did not differ; `title` is overridable.

### Lines removed
`git diff --numstat` deletions per file: service.test.ts −109, rules.test.ts −94, sweeper.test.ts −53, sweeper.effect.test.ts −48, rules.routes.test.ts −42, routes.test.ts −30, tools/service.test.ts −48, tools/adapters.test.ts −43, tools/routes.test.ts −42 = **509 lines removed**, with 63 added (one import each, the adjusted call sites; no test-body line changed). New: `seed.ts` 149 lines, `seed.test.ts` 147 lines.

### Test counts (before → after, per file)
Counts are from vitest's JSON report; unchanged in every moved file (the diff adds/removes no `it`/`test`/`describe`):
- approvals/service.test.ts 47 → 47
- approvals/rules.test.ts 30 → 30
- approvals/rules.routes.test.ts 23 → 23
- approvals/routes.test.ts 20 → 20
- approvals/sweeper.test.ts 6 → 6
- approvals/sweeper.effect.test.ts 1 → 1
- tools/service.test.ts 47 → 47
- tools/routes.test.ts 19 → 19
- tools/adapters.test.ts 27 → 27
- test-support/seed.test.ts 0 → 3 (new)

### Commands (real results)
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/test-support`: 2 files, 5 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals`: 8 files, 130 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools`: 4 files, 95 tests passed.
- `pnpm exec prettier --write <the changed ts files>`: rewrapped the new seed-group calls; the gate's format check then passed.
- `pnpm gate` from the worktree root: PASS on install/format/lint/typecheck/effect/tests @zilar/server, scope clean, `GATE PASS`.

### Gate summary lines
```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.0s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (25.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Single tests run
Only `src/test-support`, `src/approvals` and `src/tools` (the three lines above), plus one JSON-reporter run of the ten seed/moved files to read exact per-file counts. No whole suite, no other package.

### Deviations and open questions
- The spec says each helper "takes the TestContext and an overrides object". I kept the required positional arguments (`ownerId`, `members`, `aiIds`) and put only the differing columns in the overrides object, so the approvals and tools/routes call sites stayed unchanged (the T-0899 approach of keeping positional forms). If the next seed batch should pass `members`/`aiIds` inside the overrides object instead, say so and I will reshape it before more files move.
- No production files changed; no other test files touched.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The change:**
  - `apps/server/src/test-support/seed.ts` has `seedUser`, `seedAi` and `seedGroup` with overrides, plus its own test;
  - 9 files in `approvals/` and `tools/` use it;
  - net 85 lines removed, and the test counts are unchanged.
- **Defaults:** they did not differ across these 9 copies. Only `seedUser` gained an `email` override.
- **Nits for part 2:**
  - `seedGroup` should guard an empty `members` array;
  - the two-step inserts are not atomic. That is fine for tests.
- **Check:** the combined check passes.
