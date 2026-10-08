---
id: T-0616
title: "Gate: run only the tests a branch adds or touches plus the tests next to its changed source files, not the package's whole --changed set; `--full` keeps today's behaviour for the lead's batched full run; same PASS/FAIL summary"
status: merged
milestone: M5
branch: task/T-0616-gate-light-tests
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0616: a light gate (only the nearest tests)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-08: "dont run full test on every worker, just test the added tests or the closes ones and after some task do a full test when no other test is running."

Today, every `pnpm gate` (in each worker and in every `lead merge`) runs `vitest --changed main` for each touched package. For an `apps/server` source file, that pulls in almost the whole server suite (152 test files), because most tests import the app. With four workers plus a merge, load reached 153 and tests timed out or were killed.

### Verified facts (do not re-derive)
- **`packages/devtools/src/gate/plan.ts:32-53`:** `gateSteps` adds, per touched package with a `test` script, `pnpm --filter <pkg> test --maxWorkers=2 --changed <base>`.
- **`packages/devtools/src/gate/cli.ts:78-119`:** `main` parses `--base`, builds the steps from `changedFiles(root, base)` (committed, uncommitted and untracked files) and prints `PASS|FAIL <label> (<s>)` lines, then `GATE PASS` or `GATE FAIL`.
- The root script is `"gate": "pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base main"` (`package.json:26`). `lead merge` runs `pnpm gate` (`packages/devtools/src/lead/merge.ts:45-47,148-152`).
- `apps/server`'s `test` script is `vitest run --testTimeout=30000 --hookTimeout=30000`, and extra arguments are passed through. Vitest takes file paths, relative to the package, as filters.
- Tests are `*.test.ts`, `*.test.tsx`, `*.effect.test.ts` and `*.e2e.test.ts`, next to their source.

### What to build
1. **Light test selection** (the new default). For each touched package with tests, select:
   - every changed file in it that is a test file;
   - for each changed non-test source file `dir/name.ts(x)`, the test files in the same `dir` whose name starts with `name.` (for example `service.ts` selects `service.test.ts` and `service.effect.test.ts`).
   
   Run `pnpm --filter <pkg> test --maxWorkers=2 <paths relative to the package>`. If a package was touched but nothing was selected, print `SKIP tests <pkg> (no nearby test files)` and treat it as passing.
2. **`--full`** (`pnpm gate --full`) keeps today's step exactly (`--changed <base>`).
3. Put the selection in `plan.ts` as a pure function with unit tests in `packages/devtools/src/gate/gate.test.ts`. Cover:
   - a changed test file;
   - a source file with two sibling tests;
   - a source file with none (SKIP);
   - a non-code file (no tests);
   - two packages.
   
   Keep every existing test green; change an existing assertion only where it pinned the `--changed` args for the default mode, and say which ones in the Report.
4. **Docs:**
   - in `docs/LEAD_HANDOFF.md` (the gate bullet), one sentence: the default runs the nearest tests, and the lead runs `pnpm gate --full` on main after several merges, when no other tests are running;
   - in the `AGENTS.md` gate section, the same sentence, if that section exists (check first).

### Read first
`AGENTS.md`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts` and `packages/devtools/src/gate/gate.test.ts`.

### Allowed files
`packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`, `docs/LEAD_HANDOFF.md`, `AGENTS.md`, `work/T-0616-gate-light-tests.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate
pnpm gate
```

### Acceptance
- `pnpm gate` runs only the nearest tests, prints SKIP when there are none, and keeps the same summary lines.
- `pnpm gate --full` behaves as before.
- The unit tests cover the selection rules.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `selectTestFiles` and `isTestFile` to `packages/devtools/src/gate/plan.ts`: the nearest tests are the changed test files plus, for every changed `dir/name.ts(x)`, the test files in `dir` whose name starts with `name.`.
- `gateSteps` now takes `GateOptions { full?, testFiles? }`. By default each touched package that has tests runs `pnpm --filter <pkg> test --maxWorkers=2 <nearest test paths relative to the package>`; if nothing was selected it emits a step with `skipReason: 'no nearby test files'`, which the CLI prints as `SKIP tests <pkg> (no nearby test files)` and counts as passing. With `full: true` it keeps the old `--changed <base>` step.
- `packages/devtools/src/gate/cli.ts` parses `--full`, lists tracked test files once with `git ls-files` (reusing that listing for the stray-file check), passes them to `gateSteps`, and prints SKIP steps. The header appends ` (full)` for a full run.
- Tests: added `selectTestFiles` coverage (changed test file; source with two siblings; source with none; non-code file) and rewrote the `gateSteps` block (nearest tests, SKIP, two packages, and `--full` keeping `--changed`).
- Docs: extended the gate bullet in `docs/LEAD_HANDOFF.md` with the default-nearest-tests / `pnpm gate --full` sentence.

### Files changed
- `packages/devtools/src/gate/plan.ts`
- `packages/devtools/src/gate/cli.ts`
- `packages/devtools/src/gate/gate.test.ts`
- `docs/LEAD_HANDOFF.md`
- `work/T-0616-gate-light-tests.md` (this report + status)

### Existing assertion changed
The old `gateSteps` test "always runs install, format, lint and typecheck, then only the touched packages" pinned the default args to `['--changed','main']`. The default now selects the nearest tests, so that assertion moved to a new test "keeps the --changed step for the full run" (passing `{ full: true }`), and a new default test checks the nearest-test args instead. No other existing assertion changed.

### Commands and results
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate` → 1 test file passed, 15 tests passed.
- `pnpm gate` (required) → GATE PASS:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (4.2s)
  PASS  format  (85.3s)
  PASS  lint  (2.5s)
  PASS  typecheck  (11.4s)
  PASS  tests @zilar/devtools  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Light mode ran only `src/gate/gate.test.ts` (2.0s), not the whole devtools suite.
- `pnpm gate --full` → GATE PASS: header `gate: 5 changed file(s) against main (full)`, `PASS tests @zilar/devtools (4.3s)`. The flag is forwarded through `pnpm` and the `--changed main` step still runs.

### AGENTS.md
Left untouched. The task lists `AGENTS.md` but conditions the change on "the `AGENTS.md` gate section ... if that section exists". No section is headed or dedicated to the gate (the mentions are inside "Your workflow" and "Running tests (the machine is shared)"), and `AGENTS.md`'s own safety rules say "Never change `AGENTS.md`". So I did not edit it; the same sentence went into `docs/LEAD_HANDOFF.md`.

### Deviations / open questions
- None. No dependencies added.

### Round 2 (fix round)
- **Finding 1 (must-fix) fixed.** `selectTestFiles` now takes an `exists` predicate and drops a changed test file that is no longer on disk; `gateSteps` forwards `options.exists`, and `cli.ts` passes `(file) => fs.existsSync(path.join(root, file))`. A branch that deletes `service.test.ts` no longer hands the missing path to Vitest (which exits 1 on "No test files found"); the package now prints `SKIP tests <pkg> (no nearby test files)`. The predicate defaults to `() => true`, so the existing pure-function callers are unchanged.
- **Finding 2 (nit) not touched.** It is not in a line this round changed; the instructions say to leave nits alone otherwise.
- **Tests added.** `selectTestFiles` "drops a changed test file the branch deleted"; `gateSteps` "skips a touched package whose only changed test file was deleted" (17 tests, was 15).
- **Commands.** `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate` → 1 file, 17 passed. `pnpm gate` → `GATE PASS`: install (frozen) 1.3s, format 19.1s, lint 0.8s, typecheck 3.0s, tests @zilar/devtools 1.0s (only `src/gate/gate.test.ts`), scope clean.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean after 1 automatic round. The packet (21:16) is newer than HEAD d1b9b7a2.
- **Lead check:**
  - `selectTestFiles` picks the changed test files plus same-folder `name.*` tests, and guards against deleted tests;
  - SKIP passes, and `--full` keeps `--changed`;
  - the unit tests cover the rules;
  - the gate passes.
- **Follow-up:** `AGENTS.md` (lines 30 and 69) still says the gate runs "the tests of every package you touched". It was not updated; fix it in the next docs pass.
