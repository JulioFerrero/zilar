---
id: T-0890
title: "Main CI green again: prettier on gate.test.ts, and lead batch check runs prettier --check like CI"
status: todo
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

## Review (written by Claude)
