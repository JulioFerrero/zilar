---
id: T-0616
title: "Gate: run only the tests a branch adds or touches plus the tests next to its changed source files, not the package's whole --changed set; `--full` keeps today's behaviour for the lead's batched full run; same PASS/FAIL summary"
status: todo
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

## Review (written by Claude)
