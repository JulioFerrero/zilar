---
id: T-0768
title: "R6: Effect ratchet in the gate — a new `effect` step classifies every changed counted source file with the map rules and fails when one is needs-effect on the branch but was not needs-effect on the base (new file, or a file that regressed); prints the file and its first hit; files already needs-effect on the base pass (they are tracked by the map)"
status: merged
milestone: M5
branch: task/T-0768-effect-ratchet
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0768 (R6): the gate stops new non-Effect code

## Spec (written by Claude, do not edit)

### Why
This is Phase 0 of `docs/audit/effect-100-plan.md` (task R6), accepted by Julio on 2026-10-09. With the conversion under way, no task may add a new file that does async, timers, I/O or try/catch without Effect, and no task may make an existing file worse. The lead chose a per-file ratchet against the branch base instead of a committed baseline count: it needs no baseline file to maintain, and it only looks at the files a task changed.

### Verified facts (do not re-derive)
- **Gate steps:** `packages/devtools/src/gate/plan.ts` `gateSteps(changedFiles, workspace, base, options)` (line 128) returns `install (frozen)`, `format` (`formatStep`), `lint`, `typecheck` and then tests per package. Steps are `{ label, command, args, env?, skipReason? }`, run by `gate/cli.ts`, and tested in `gate/gate.test.ts` (around line 124, "runs install, format, lint and typecheck, then only the nearest tests").
- **The map rules** are in `packages/devtools/src/effect-map/generate.ts` (T-0758): `isCountedSource(path)` (line 171), `isExemptPath(path)` (line 177), `classifySource(source)` (line 210) and `sourceFile(path, source, tasks)` (line 318), which gives `kind`, `signals` and `firstHit`. Reuse them; do not copy the regexes.
- **The base** is the gate's `base` argument (normally `main`), so `git show <base>:<path>` gives the base version. It fails for a new file.

### What to build
1. **`packages/devtools/src/effect-map/ratchet.ts`**, pure and tested: `ratchetViolations(files: Array<{ path: string; branchSource: string | null; baseSource: string | null }>)` returns the violations. A violation is a counted, non-exempt file that is `needs-effect` on the branch while it was absent on the base or not `needs-effect` there. Give its path, signals and first hit. Files deleted on the branch (`branchSource` null) and files that are needs-effect on both sides are not violations.
2. **`packages/devtools/src/effect-map/ratchet-cli.ts`:** `tsx src/effect-map/ratchet-cli.ts --base <ref> <files...>` reads the branch versions from disk and the base versions with `git show`. It prints `effect: ok (N files checked)`, or one line per violation, `effect: <path> needs Effect (<signals>): <first hit>`, and exits 1 if there are any.
3. **`gate/plan.ts`:** add a step `effect`, after `typecheck`, that runs the CLI on the changed files that exist (reuse `exists`). It is skipped with `skipReason: 'no source files changed'` when no changed file is a counted source.
4. **Tests:** `ratchet.test.ts` covers a new plain file (ok), a new needs-effect file (violation), a regressed file (violation), a file that is needs-effect on both sides (ok), an exempt marker file (ok), a deleted file (ok) and a converted file (ok). Update `gate.test.ts` for the new step.
5. **Docs:** one line in `docs/audit/effect-100-plan.md` §4 Phase 0, under R6, stating the per-file design.

### Read first
`AGENTS.md`, `docs/audit/effect-100-plan.md` §1.4 and §4 (Phase 0), `packages/devtools/src/effect-map/generate.ts`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`.

### Allowed files
`packages/devtools/src/effect-map/ratchet.ts`, `packages/devtools/src/effect-map/ratchet.test.ts`, `packages/devtools/src/effect-map/ratchet-cli.ts`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/gate.test.ts`, `docs/audit/effect-100-plan.md`, `work/T-0768-effect-ratchet.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/effect-map src/gate
pnpm gate
```
The gate on this branch must show the new `effect` step, which passes because the changed files are devtools files and devtools is exempt.

### Acceptance
- The gate fails on a new or regressed needs-effect file and passes otherwise.
- The tests cover the seven cases.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** The gate has an `effect` step after `typecheck` that checks the changed counted sources against the base with the map's rules.

Files changed (all inside Allowed files):
- `packages/devtools/src/effect-map/ratchet.ts` (new): `ratchetViolations(files)`, pure. Uses `isCountedSource` and `sourceFile` from `generate.ts`, no copied regexes.
- `packages/devtools/src/effect-map/ratchet-cli.ts` (new): `--base <ref> <files...>`. Reads branch files from disk, base files with `git show`, prints `effect: <path> needs Effect (<signals>): <first hit>` per violation or `effect: ok (N files checked)`. Exit 1 on violation, 2 on bad arguments or a ref that is not a commit. Writes nothing.
- `packages/devtools/src/gate/plan.ts`: `effectStep` added after `typecheck`. Passes the changed counted sources that exist. Skipped with `no source files changed` otherwise.
- `packages/devtools/src/effect-map/ratchet.test.ts` (new): 8 tests, in-memory sources only. Covers the seven cases plus "non-counted files are ignored".
- `packages/devtools/src/gate/gate.test.ts`: the labels test now expects `effect`, the two-package test slices from 5, and 3 new `effect ratchet step` tests.
- `docs/audit/effect-100-plan.md`: one paragraph under Phase 0, after the table, stating the per-file design.
- `work/T-0768-effect-ratchet.md`: this report and the status.

Safety: git calls in the CLI have a 30 s timeout and a 64 MB buffer. A git call that is killed throws, so it is never read as "new file". Nothing is written, no network, and the tests do not touch `~/.zilar-lead`.

Commands and real results:
- `pnpm install --frozen-lockfile`: done.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/effect-map/ratchet.test.ts src/gate/gate.test.ts`: 2 files, 37 passed (run before the counts below).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/effect-map src/gate` (the Checks command): 5 files, 107 passed, 0 failed.
- Manual CLI runs (`pnpm --filter @zilar/devtools exec tsx src/effect-map/ratchet-cli.ts --base <ref> apps/server/src/agents/gateway/budget.ts`):
  - base = parent of the commit that added the file (file absent on base), file is needs-effect: printed `effect: apps/server/src/agents/gateway/budget.ts needs Effect (H1, W4): async function checkDailyLimit(input: {`, exit 1.
  - base = `main` (file needs-effect on both): `effect: ok (1 files checked)`, exit 0.
  - base = `nosuchref`: `effect: nosuchref is not a commit`, exit 2 from the CLI (pnpm reports 1 for the wrapper).
- `pnpm exec prettier --write` on the 6 changed code and doc files: all unchanged.
- `pnpm gate`: GATE PASS, output summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.2s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/devtools  (2.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The `effect` step took 1.3 s. The changed devtools files are exempt, so the step passes.

Deviations from the spec:
- The step also skips when every counted source it was given was deleted on the branch (same skip message). The spec's skip condition is "no changed file is a counted source"; this is the same outcome in practice.
- The R6 row in the plan table still describes the baseline design. I only added the paragraph under the table, as the spec asked.

Open questions: none blocking. Note: the R6 row in the plan table still says "baseline"; say if you want that row rewritten too.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff and ran the CLI.
- **The ratchet:** pure `ratchetViolations` over the map's `sourceFile`. The CLI reads files from the repo root and the base with a bounded `git show`.
- **The gate step:** `effect`, after typecheck; it is skipped when no counted source changed and took 1.3 s.
- **The lead's probe:** a new file with `async` and `fetch` exits 1 with the violation line (`H1, H2`), while an existing Effect file passes. The stray `undefined` line is pnpm noise on a failed exec.
- **Results:** 107 tests pass, and the gate passed.
