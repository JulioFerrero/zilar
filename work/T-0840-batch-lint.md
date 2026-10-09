---
id: T-0840
title: "lead batch check runs lint: oxlint (unix format) on the wave tree, each error owned by the task that changed the file, counted in the summary line"
status: merged
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

### What was done
- `packages/devtools/src/lead/batch.ts`: `Failure.kind` gains `'lint'`. New exported `parseLintErrors(output, worktree)` reads `oxlint --format=unix` lines, keeps `[Error/...]` lines only, and returns repo-relative files (absolute paths under the worktree and `./` prefixes are normalized). `runChecks` runs `pnpm exec oxlint --format=unix .` after the typecheck and before the tests, with `STEP_TIMEOUT_MS`. A non-zero exit with no readable error adds a `tool` failure `lint (no error could be read)`. Lint failures are owned with `ownerOf` like the others, and a task with only lint errors is not `ok`.
- `failureItem` writes lint items as `Lint error <rule> in <file>`, with the message `<line>:<col> <text>` in the block.
- `packages/devtools/src/lead/batch.test.ts`: fake `runCommand` returns `script.lint` for oxlint calls (new `lint?` field in `Script`). Three new tests: `parseLintErrors` (one error, one warning, a `./` path), a lint error owned by T-0001 (its summary is not ok, T-0002 stays ok), and a non-zero lint with no readable error (unowned tool failure).
- `work/T-0840-batch-lint.md`: this Report and `status: review`.

### Real oxlint output (oxlint 1.85.0, `--format=unix`)
Ran on a scratch file outside the worktree (`/private/tmp/.../scratchpad/lintsample/sample.ts`). The repo itself is lint-clean, so no error line exists in the repo to show. Real lines:
```
/private/tmp/.../sample.ts:2:9: Variable 'unused' is declared but never used. Unused variables should start with a '_'. [Error/eslint(no-unused-vars)]
/private/tmp/.../sample.ts:5:14: Do not use `new Array(singleArgument)`. [Error/unicorn(no-new-array)]

2 problems
```
The spec's example `error eslint(no-unused-vars): ...` is not this format; the parser follows the real one. Exit status is 1 with errors, 0 without.

### Test counts
- `batch.test.ts` before: 22 passed. After: 25 passed (3 new). The new 3 failed before the implementation (`parseLintErrors is not a function`, and the two wave tests got `ok: true`).
- Three runs after the change: 25 passed each time (one run plus two repeats).
- Existing 22 tests unchanged in their assertions.

### Commands and results
- `pnpm install --frozen-lockfile`: done, in the worktree.
- `pnpm exec prettier --write` on the two `.ts` files: unchanged.
- `pnpm exec oxlint packages/devtools/src/lead/batch.ts packages/devtools/src/lead/batch.test.ts`: exit 0, no output.
- `pnpm --filter @zilar/devtools typecheck`: exit 0, 0 `error TS` lines.
- The spec's `vitest run --reporter=dot src/lead/batch.test.ts`: 25 passed (see above).
- No `pnpm gate` (wave mode).

### Deviations from the spec (kept existing output)
- Summary line: `, lint N` is added only when N > 0, between tests and out of scope, so the existing summary lines (`T-0001 FAIL typecheck 0, tests 1, out of scope 0`, `T-0002 ok`) are exactly as before. With lint errors: `T-0001 FAIL typecheck 0, tests 0, lint 1, out of scope 0`, as the spec example shows. Always adding `lint 0` would have broken the two existing exact-line assertions.
- Report table: a trailing `Lint errors` column was added. Existing rows are still substrings of the new rows, so the existing row assertions pass.

### Unsure
- The rule name is the bracket text as oxlint prints it, `eslint(no-unused-vars)`, not the bare `no-unused-vars`. Say if the bare name is wanted.
- The lint step covers the whole wave tree (`.`), like the root `lint` script. A lint error in a file no task touched goes to unowned and fails the wave, as the other unowned checks do.
- The unix line path for files under a relative argument (`.`) was not seen in the repo (no errors there). The parser handles absolute paths and relative ones; the relative case is covered only by the unit test on a `./` path.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead read the diff.
- **The change:** after the typecheck, `oxlint --format=unix .` runs; `parseLintErrors` keeps errors only, and each is owned by the task that changed the file. The summary adds `, lint N` only when N > 0, so the existing lines are unchanged, and the report table gains a Lint errors column.
- **Results:** batch tests went from 22 to 25, 3 of 3 runs; typecheck and oxlint are clean.
