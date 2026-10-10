---
id: T-0890
title: "Main CI green again: prettier on gate.test.ts, and lead batch check runs prettier --check like CI"
status: merged
milestone: M5
branch: task/T-0890-prettier-gate-test-batch-check
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-0890: prettier on gate.test.ts; the batch check runs prettier

## Spec (written by Claude, do not edit)

### Why
The CI run on main at `e42dd220` (run 38009673135) failed only in "Format and lint". The log says `prettier --check .` reported `packages/devtools/src/gate/gate.test.ts` (merged with T-0889). All the other jobs passed: build, typecheck, and the server 1/3, 2/3, 3/3 and rest test jobs.

The wave 3 combined check (`lead batch check`) passed because it runs install, typecheck, oxlint and tests, but not `prettier --check`. T-0840 added lint to it; prettier is the remaining gap against CI.

### What to build
1. Run `pnpm exec prettier --write packages/devtools/src/gate/gate.test.ts`. Commit it alone.
2. In `packages/devtools/src/lead/batch.ts`, make the combined check also run `pnpm exec prettier --check .` (the same command CI's root `format:check` runs; read the root `package.json` and `.github/workflows/ci.yml`). Report each unformatted file as a failure owned by the task whose diff touches it, the way lint errors are owned.
   - Parse prettier's `[warn] <path>` lines.
   - Unowned files count as unowned failures.
3. Add tests in `packages/devtools/src/lead/batch.test.ts` for the parser and the ownership, following how the lint parsing (`parseLintErrors`) is tested.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `packages/devtools/src/lead/batch.ts` and its test file, the root `package.json` and `.github/workflows/ci.yml`.

### Allowed files
`packages/devtools/src/gate/gate.test.ts`, `packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch.test.ts`, `work/T-0890-prettier-gate-test-batch-check.md`.

### Checks (wave mode)
```bash
pnpm exec prettier --check .
pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/lead src/gate
pnpm --filter @zilar/devtools typecheck
pnpm exec oxlint <your changed files>
```

### Acceptance
- `prettier --check .` is clean on the whole repo.
- The Checks pass.
- Only Allowed files change.

---

## Report (written by the worker when done)

- Item 1: `pnpm exec prettier --write packages/devtools/src/gate/gate.test.ts` (6 insertions, 2 deletions), its own commit `fe4c125d`.
- Item 2 (`batch.ts`):
  - New `parsePrettierFiles(output, worktree)` reads `[warn] <path>` lines and skips the `Code style issues found ...` summary; each file becomes a `format` failure with the message "Run `pnpm exec prettier --write <file>`, then commit the result."
  - `runChecks` runs `pnpm exec prettier --check .` after lint. A non-zero exit with no readable file is a `tool` failure "format (no file could be read)".
  - Ownership uses the existing `ownerOf`: the task whose diff holds the file owns it; otherwise it is unowned and fails the wave.
  - Summary line gains `, format N` only when N > 0. The report table columns are unchanged (format failures show in the per-task fix file and the unowned section).
  - Header comment updated to list prettier.
- Item 3 (`batch.test.ts`): 1 parser test (`reads unformatted files from prettier --check, ...`) and 3 `runBatchCheck` tests (owned file, unowned file, prettier with no readable file). The fake `runCommand` got a prettier branch and a `format` script.
- Tests, before and after: `src/lead src/gate` 735 tests in total now; 4 are new, so 731 before (derived from the new test count, not measured on the old tree).
  - Runs after the change: 735 passed (31 files) on a rerun; `batch.test.ts` alone 29 passed.
  - One earlier run of `src/lead src/gate` showed 1 failed | 734 passed. It ran alongside a background prettier process, I did not identify the failing test, and it did not reproduce on the next two runs. Treat as an unexplained flake under load.
- Checks:
  - `pnpm exec prettier --check .`: "All matched files use Prettier code style!" (exit 0).
  - `pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/lead src/gate`: as above.
  - `pnpm --filter @zilar/devtools typecheck`: `tsc --noEmit`, no errors.
  - `pnpm exec oxlint` on batch.ts, batch.test.ts, gate.test.ts: no output (clean).
- `pnpm gate` not run (per wave rules).
- Unsure: the Checks say `--reporter=dot`, and the first run printed the flake, so I could not see which test failed.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** This fixes main's only red CI job: prettier on `gate.test.ts`, in its own commit. `lead batch check` now runs `prettier --check .` and assigns each unformatted file to the task whose diff holds it, so the gap that let this through is closed. The devtools `src/lead` and `src/gate` tests pass (735), and `prettier --check .` is clean. The change touches devtools only.
