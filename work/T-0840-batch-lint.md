---
id: T-0840
title: "lead batch check runs lint: oxlint (unix format) on the wave tree, each error owned by the task that changed the file, counted in the summary line"
status: todo
milestone: M5
branch: task/T-0840-batch-lint
model: auto
effort: default
depends_on: [T-0799]
estimate: 0.25 day
---

# T-0840: `lead batch check` runs lint

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 the wave 2 combined check (`lead batch check`, T-0799) passed 25 tasks. Then 4 of them failed the merge gate on lint: `no-unused-vars`, `react(refs)` and `unicorn(no-new-array)`. The check runs install, typecheck and tests, but not lint, while the merge gate does (`packages/devtools/src/gate/plan.ts:144`, `{ label: 'lint', command: 'pnpm', args: ['lint'] }`; the root `package.json:14` has `"lint": "oxlint ."`). Lint errors should come back with the other failures, owned by their task.

### Verified facts (re-read before editing)
- **`packages/devtools/src/lead/batch.ts`** (833 lines):
  - `Failure` at 64-71 has `kind: 'typecheck' | 'test' | 'tool'`, an optional `file`, a `name` and a `message`.
  - `runChecks` at 381-454 runs `pnpm install --frozen-lockfile` (388), then `pnpm exec turbo run typecheck --continue …` (398-416) with `parseTypecheckErrors`, then each package's vitest with a JSON report (418-452).
  - `ownerOf` at 186 maps a failing file to the task whose diff holds it.
  - `summaryLine` at 460-470 counts `typecheck` and `tests` per task. The report also groups by kind around lines 474-476 and 518-519.
- **oxlint 1.85.0** supports `--format=unix` (`pnpm exec oxlint --help`). On wave 2 its errors looked like `apps/mobile/src/auth/AuthFlow.tsx:60:47: error eslint(no-unused-vars): Parameter '_' is declared but never used`. Check the real unix output on a tiny sample first, and parse that.
- **Tests:** `packages/devtools/src/lead/batch.test.ts` (614 lines) drives all of this through fake `deps.runCommand`.

### What to build
1. **Add `'lint'` to `Failure.kind`.** After the typecheck, run `pnpm exec oxlint --format=unix .` in the wave worktree with `STEP_TIMEOUT_MS`.
2. **Parse it** with a new exported `parseLintErrors(output, worktree)`. Each error line becomes `{ kind: 'lint', file: <repo-relative>, name: '<rule>', message: '<line:col message>' }`, and warnings are ignored.
3. **Fallback:** if the exit status is non-zero but no line parses, add one `tool` failure, `lint (no error could be read)`, as the typecheck does.
4. **Ownership:** lint failures are owned with `ownerOf` like the others.
5. **Reporting:** `summaryLine` and the report show lint counts next to typecheck and tests, for example `T-0810 FAIL typecheck 0, tests 0, lint 1, out of scope 0`. A task with only lint errors is not `ok`.
6. **Tests** in `batch.test.ts`:
   - `parseLintErrors` reads two unix lines (one error, one warning) and returns only the error, relative to the worktree;
   - a wave run whose fake oxlint prints one error in a file of task A reports it under A, and A's summary line is not `ok`;
   - a non-zero oxlint with unreadable output gives the `tool` failure.

Keep everything else the same: existing output lines, the order of steps, and the exit codes.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch.test.ts`.

### Allowed files
`packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch.test.ts`, `work/T-0840-batch-lint.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/lead/batch.test.ts
pnpm --filter @zilar/devtools typecheck
pnpm exec oxlint packages/devtools/src/lead/batch.ts packages/devtools/src/lead/batch.test.ts
```

### Acceptance
- The three new tests pass, and the existing batch tests pass unchanged, 3 of 3 runs.
- Typecheck and oxlint are clean, and only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
