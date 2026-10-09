---
id: T-0768
title: "R6: Effect ratchet in the gate — a new `effect` step classifies every changed counted source file with the map rules and fails when one is needs-effect on the branch but was not needs-effect on the base (new file, or a file that regressed); prints the file and its first hit; files already needs-effect on the base pass (they are tracked by the map)"
status: todo
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

## Review (written by Claude)
