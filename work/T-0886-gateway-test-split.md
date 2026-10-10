---
id: T-0886
title: "Split apps/server/src/agents/gateway.test.ts (7,242 lines, 100 s) into feature files around one extracted harness"
status: merged
milestone: M5
branch: task/T-0886-gateway-test-split
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0886: Split apps/server/src/agents/gateway.test.ts (7,242 lines, 100 s) into feature files around one extracted harness

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding F-F3 in `docs/audit/simplify-2026-10-09/F-tests.md`.
- **Size:** 168 tests in 21 describes, taking 100 s on one worker.
- **Independent parts:** groups (about 2939-4380), topics (5118-5724), persona tools (1631-1938), request_action (2295-2650), kill switch (4380-4668) and the listener (5724 to the end).
- **The harness:** lines 1-434 are a private harness (`FakeCore`, `FakeLitellm`, `seedAi`, `jsonResponse`, `waitFor`). `FakeLitellm` is redefined in `ais/service.test.ts`, `ais/routes.test.ts` and `ais/usage.test.ts`.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Move the harness into `apps/server/src/agents/gateway.test-harness.ts` (a non-test file name, so vitest does not run it).
2. Split the describes into 6-8 files under `apps/server/src/agents/gateway/*.test.ts` (or `agents/gateway.<feature>.test.ts`). Move only; the test bodies stay unchanged.
3. Make the three `ais/*` tests use the shared `FakeLitellm`.
4. **Prove nothing was lost:** the total test count is identical (168 in the gateway files), and list the per-file counts and durations.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/server/src/agents/gateway.test.ts`, `apps/server/src/agents/gateway.test-harness.ts`, `apps/server/src/agents/gateway.*.test.ts`, `apps/server/src/agents/gateway/*.test.ts`, `apps/server/src/ais/*.test.ts`, `work/T-0886-gateway-test-split.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 src/agents src/ais
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

Wave mode: `pnpm gate` not run (per lead instruction).

**What changed**
- `gateway.test.ts` (7,242 lines, 168 tests) deleted and replaced by `gateway.test-harness.ts` (harness, `FakeCore`, shared `FakeLitellm`, `createGatewayHelpers` with `harness`/`completionFetch`/`bodyOf`/`coreFor`) and 8 files `gateway.<feature>.test.ts`. Test bodies were moved by line range, unchanged (prettier only).
- Each file keeps the local `context`/`gateway` vars and hooks, so bodies still assign and read `gateway` as before.
- `ais/service|routes|usage.test.ts` drop their local `FakeLitellm` and import the shared one (a superset). Differences kept as options: `idSuffix` (`-do-not-leak`) and `keyInfoMaxBudget` (routes uses `null`, others 20) via a small `fakeLitellm()` helper in routes. In routes, `addedModels/deletedModels/failAddModel/failDeleteModel` were renamed to `added/deleted/failAdd/failDelete`. `failAdd` now rejects with `LitellmApiError` in service tests too (message still contains `gateway down`).
- Spec line ranges matched the file closely; the 21 describes are nested in one top-level `agent gateway` describe.

**Per-file tests (3 of 3 runs, 527 passed, 3 skipped elsewhere, 0 failed)**
Load average was 60-70 on the shared machine, so durations are inflated (run 2 / run 3, seconds): lifecycle 26 (174/200), spend 18 (148/166), tools 16 (143/158), actions 14 (87/150), groups 35 (217/262), safety 16 (139/156), topics 9 (62/129), listener 34 (218/278). Gateway total 168 = old 168. ais: routes 49, service 26, usage 13.

**Lines**: gateway.test.ts -7,242; new gateway files +7,716 (harness incl. merged FakeLitellm ~ 750). ais tests: +57 / -292 (net -235).

**Checks**: vitest src/agents src/ais x3 pass, `@zilar/server typecheck` clean, oxlint clean.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** `gateway.test.ts` (7,242 lines) is split into 8 feature files around one harness, still with exactly 168 tests, so vitest can run them in parallel. The `ais` tests share one `FakeLitellm` (−235 lines). The combined wave 4 check passes.
