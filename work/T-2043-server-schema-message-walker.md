---
id: T-2043
title: "Reduce (server): the four extra copies of the Effect schema-issue message walker (routines/schedule, tools/schemas, audit/schema, setup/schema) use the shared firstIssueMessage in effect/schema-issues.ts with small options that keep each caller's exact messages — with tests"
status: merged
milestone: M5
branch: task/T-2043-server-schema-message-walker
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2043: One schema-issue message walker (reduce-scan cluster #21)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. `docs/audit/reduce-scan.md` (cluster #21) found the walker that turns an Effect `SchemaIssue` into its first user-facing message copied across the server. A shared one already exists (T-1057), but four modules keep their own variant. Validation messages are user-facing (auth names, routines, tools, setup), so every caller must keep its exact text.

### Facts (read by the lead on 2026-10-18 at `25c19132d`)
- **The shared walker.** `apps/server/src/effect/schema-issues.ts` (36 lines) exports `firstIssueMessage(issue)`:
  - `Composite` and `AnyOf` take the first child with a message;
  - `Pointer`, `Filter` and `Encoding` recurse into the inner issue;
  - `InvalidValue` takes its `annotations.message`;
  - anything else gives `undefined`.

  It is used by `auth/api.ts:93` and `routines/schemas.ts:146`.
- **The variants:**

  | Copy | Lines | How it differs from the shared walker |
  | --- | --- | --- |
  | `routines/schedule.ts` `firstValidationMessage` | `:84-110` | `Filter` first returns `issue.filter.annotations?.message` when it's a non-empty string, else recurses |
  | `tools/schemas.ts` `firstValidationMessage` | `:149-176` | the same as `routines/schedule.ts` |
  | `audit/schema.ts` `firstIssueMessage` | `:75-100` | also has `InvalidType` → `SchemaIssue.defaultLeafHook(issue)` and `MissingKey` → `'Missing key'`; `Filter` recurses |
  | `setup/schema.ts` `firstMessage` (exported) | `:81-99` | `Composite` looks only at the **first** child, with no `AnyOf` case, so `AnyOf` gives `undefined`; `Filter` recurses |

### Steps
1. **The shared walker.** Extend `firstIssueMessage(issue, options?)` in `apps/server/src/effect/schema-issues.ts` with:
   - `filterAnnotations?: boolean`, the routines/tools behaviour;
   - `leafTypes?: boolean`, audit's `InvalidType` and `MissingKey` cases;
   - `firstChildOnly?: boolean`, setup's behaviour.

   The defaults are today's shared behaviour. Keep it under about 60 lines.
2. **Callers.** Replace the four local copies with calls to the shared walker and the matching option. `setup/schema.ts` keeps exporting `firstMessage` as a one-line wrapper if anything imports it; check with `git grep`.
3. **Tests.**
   - The existing tests of `routines`, `tools`, `audit` and `setup` must pass **unchanged**: they assert exact texts.
   - Add `apps/server/src/effect/schema-issues.test.ts` with one case per option, built from small Effect schemas, the way those modules build them.
4. **Size.** Report the line counts. Product lines must go down by at least 60.

### Allowed files
- `apps/server/src/effect/schema-issues.ts`
- `apps/server/src/effect/schema-issues.test.ts`
- `apps/server/src/routines/schedule.ts`
- `apps/server/src/tools/schemas.ts`
- `apps/server/src/audit/schema.ts`
- `apps/server/src/setup/schema.ts`
- `work/T-2043-server-schema-message-walker.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/effect src/routines src/tools src/audit src/setup --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass with existing assertions unchanged, and the gate passes.
- Product lines are at least 60 lower.

---

## Report (written by the worker when done)

### What I did
- Extended `firstIssueMessage(issue, options?)` in `apps/server/src/effect/schema-issues.ts` with the three options from the spec, defaults unchanged: `filterAnnotations` (read a `Filter`'s own annotation before recursing), `leafTypes` (`InvalidType` → `SchemaIssue.defaultLeafHook`, `MissingKey` → `'Missing key'`), and `firstChildOnly` (only the first `Composite` child, no `AnyOf` case).
- Replaced the four local walkers with calls to the shared one:
  - `routines/schedule.ts` → `{ filterAnnotations: true }`
  - `tools/schemas.ts` → `{ filterAnnotations: true }`
  - `audit/schema.ts` → `{ leafTypes: true }`
  - `setup/schema.ts` → `{ firstChildOnly: true }`; it still exports `firstMessage` as a one-line wrapper because `setup/api.ts` imports it.
- Added `apps/server/src/effect/schema-issues.test.ts`: five cases built from small Effect schemas (default message, filter annotation, `InvalidType` + `MissingKey`, first-`Composite`-child and silent-`AnyOf`).
- Existing tests were not edited.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/schema-issues.test.ts`: 1 file passed, 5 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/effect src/routines src/tools src/audit src/setup --maxWorkers=2 --reporter=dot`: 16 files passed, 64 tests passed.
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/server  (11.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead
- Product line counts (the five product files, test excluded): 776 → 697, down 79 (`schema-issues.ts` 36 → 67, `routines/schedule.ts` 311 → 281, `tools/schemas.ts` 201 → 169, `audit/schema.ts` 130 → 97, `setup/schema.ts` 98 → 83).
- `schema-issues.ts` is 67 lines including the options interface and comments; the walker plus its small child-loop helper is 50 lines.
- The gate initially failed on formatting and two test-only type errors; I fixed those (Prettier on the two new files, generic schema parameter and a narrowed `InvalidType` check) and reran the whole gate, which passed as shown.
- No deviations from the spec.

## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.** One `firstIssueMessage(issue, options)` in `effect/schema-issues.ts`, with options `filterAnnotations`, `leafTypes` and `firstChildOnly`. It replaces the copies in routines, tools, audit and setup.
- **Tests.** The existing exact-text tests pass unchanged, and there's a new options test.
- **Size.** About −79 product lines.
