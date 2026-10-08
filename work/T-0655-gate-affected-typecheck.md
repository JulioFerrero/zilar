---
id: T-0655
title: "gate: typecheck only the affected packages (turbo --affected, concurrency 2) with one Turbo cache shared by all worktrees; lead merge passes --merge so its typecheck runs with --force"
status: merged
milestone: M5
branch: task/T-0655-gate-affected-typecheck
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0655: lighter gate typecheck

## Spec (written by Claude, do not edit)

### Why
With 4 workers, the machine's load reaches 20-24 on 11 cores. Every gate typechecks the whole repo:
- `turbo typecheck` runs every package, at Turbo's default concurrency of 10;
- each worktree has its own cold `.turbo/cache`.

So several gates at once start dozens of `tsc` processes. This task makes each gate typecheck only the changed packages and their dependents, two at a time, with one cache shared by every worktree. Merges stay authoritative because they skip the cache.

### Verified facts (do not re-derive)
- **`packages/devtools/src/gate/plan.ts`:**
  - line 128 is the typecheck step `{ label: 'typecheck', command: 'pnpm', args: ['typecheck'] }`;
  - `GateStep` (lines 14-20) has `label`, `command`, `args` and `skipReason?`;
  - `GateOptions` (lines 22-29) has `full?`, `testFiles?` and `exists?`;
  - `gateSteps(changedFiles, workspace, base, options)` starts at line 115.
- **Scripts and config:**
  - the root `package.json:13` has `"typecheck": "turbo typecheck"`, and `package.json:26` has `"gate": "pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base main"`;
  - `turbo.json` has `"typecheck": {}`, with no cache settings;
  - Turbo is 2.11.4.
- **`packages/devtools/src/gate/cli.ts`:**
  - `main()` (about lines 119-140) reads `--base` and `--full` from `process.argv`;
  - `run(cwd, command, args, timeoutMs)` at line 35 calls `spawnSync` without an `env`.
- **`packages/devtools/src/lead/cli.ts`:** `runGate(worktree)` (lines 227-235) runs `spawnSync('pnpm', ['gate'], { cwd: worktree, … })`. Extra args after `pnpm gate` reach `gate/cli.ts`.
- **`packages/devtools/src/gate/gate.test.ts`:** the test at lines 124-140 asserts the step labels. Other `gateSteps` tests follow at lines 148-200.

### What to build
1. **`GateOptions` gets `merge?: boolean`.**
2. **The typecheck step** becomes `command: 'pnpm'` with `args: ['exec', 'turbo', 'run', 'typecheck', '--affected', '--concurrency=2', `--cache-dir=${cacheDir}`]`.
   - `cacheDir` is `path.join(os.homedir(), '.zilar-turbo-cache')`. Pass it in through `GateOptions` as `cacheDir?: string` so tests can fix it.
   - When `merge` is true, append `'--force'`.
   - Set Turbo's base to the gate's `base` for this step: give `GateStep` an optional `env?: Record<string, string>` and set `{ TURBO_SCM_BASE: base }`.
   - `run` in `gate/cli.ts` merges `step.env` over `process.env`.
   - The step label stays `'typecheck'`.
3. **`gate/cli.ts` `main()`:** read `--merge` and pass `merge` and the `cacheDir` to `gateSteps`. When `--merge` is set, the first line printed says `(merge)`.
4. **`lead/cli.ts` `runGate`:** run `['gate', '--merge']`.
5. **Tests in `gate.test.ts`:**
   - the typecheck step has the affected args, `--concurrency=2`, the cache dir and `env.TURBO_SCM_BASE === base`;
   - with `merge: true`, the args end with `'--force'`;
   - the existing label assertions stay.
6. **Report, measured:**
   - in this worktree, run `pnpm gate` twice and paste the typecheck line from each run (the second run should hit the cache);
   - paste the output of `TURBO_SCM_BASE=main pnpm exec turbo run typecheck --affected --dry-run=json | grep -c '"taskId"'`, the number of typecheck tasks selected;
   - say whether a change to a root file (for example `tsconfig.base.json`, if it exists) marks every package as affected, from Turbo's docs or a dry run. Do not commit that experiment.

### Read first
`AGENTS.md`, `packages/devtools/src/gate/plan.ts` (lines 1-60 and 110-175), `packages/devtools/src/gate/cli.ts` (lines 30-60 and 110-160), `packages/devtools/src/lead/cli.ts` (lines 220-240), `packages/devtools/src/gate/gate.test.ts` (lines 1-30 and 120-215), `turbo.json`.

### Allowed files
`packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`, `packages/devtools/src/lead/cli.ts`, `work/T-0655-gate-affected-typecheck.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate
pnpm gate
```

### Acceptance
- The gate's typecheck step runs `turbo run typecheck --affected --concurrency=2 --cache-dir=~/.zilar-turbo-cache`, with `TURBO_SCM_BASE` set to the base.
- `lead merge` gates with `--merge`, which adds `--force`.
- The new tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- `packages/devtools/src/gate/plan.ts`: `GateStep` gained an optional `env?: Record<string, string>`; `GateOptions` gained `merge?: boolean` and `cacheDir?: string`. The `typecheck` step is now `pnpm exec turbo run typecheck --affected --concurrency=2 --cache-dir=<cacheDir>`, appends `--force` when `merge` is true, and sets `env: { TURBO_SCM_BASE: base }`. The label stays `typecheck`. `cacheDir` defaults to `path.join(os.homedir(), '.zilar-turbo-cache')` (via `node:os` / `node:path`).
- `packages/devtools/src/gate/cli.ts`: `run()` takes an optional `env` and passes `env: { ...process.env, ...env }` to `spawnSync`; `main()` reads `--merge`, passes `merge` and the cache dir to `gateSteps`, and appends ` (merge)` to the first printed line when set. Step env is forwarded at the call site.
- `packages/devtools/src/lead/cli.ts`: `runGate` now runs `['gate', '--merge']`.
- `packages/devtools/src/gate/gate.test.ts`: added two tests — the typecheck step's affected args, `--concurrency=2`, cache dir and `env.TURBO_SCM_BASE`; and that `merge: true` makes the args end with `--force`. Existing label assertions unchanged.

### Files changed

Only the Allowed files: `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`, `packages/devtools/src/lead/cli.ts`, `work/T-0655-gate-affected-typecheck.md`.

### Commands run (real results)

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate` → 1 file, **23 tests passed**.
- `pnpm gate` (run 1, cold cache): summary lines
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (15.6s)
  PASS  lint  (1.7s)
  PASS  typecheck  (3.0s)
  PASS  tests @zilar/devtools  (16.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `pnpm gate` (run 2, warm cache): typecheck line is **`PASS  typecheck  (0.9s)`** (run 1 was `PASS  typecheck  (3.0s)`), and it also ended `GATE PASS` with `scope: every changed file is inside the Allowed files`. The drop from 3.0s to 0.9s is the second run hitting the shared `~/.zilar-turbo-cache`.
- `TURBO_SCM_BASE=main pnpm exec turbo run typecheck --affected --dry-run=json | grep -c '"taskId"'` → **1** (only the changed package, `@zilar/devtools`).
- Root-file experiment (not committed): `pnpm exec turbo run typecheck --dry-run=json | grep -c '"taskId"'` → **12** (all packages when unaffected); after appending a newline to `tsconfig.base.json` and re-running the affected dry run, the count stayed **1**. Reverted with `git checkout -- tsconfig.base.json`; `git status --short tsconfig.base.json` is empty.

### Root files and `--affected`

A change to a root file such as `tsconfig.base.json` does **not** mark every package as affected here. Turbo attributes changed files to packages by directory, and `turbo.json` declares no `globalDependencies`; the root file sits outside every package, so `--affected` still selected only the changed package (count stayed 1, not 12). Implication worth noting for the lead: a branch that changed only a root tsconfig would typecheck no package under `--affected`, even on merge (`--merge` adds `--force`, which only skips the cache). If that is undesirable, `globalDependencies` in `turbo.json` would fix it — but that file is outside this task's Allowed files, so I did not change it.

### Deviations / open questions

- None. I did not run `pnpm gate --merge` end-to-end (the spec's Checks only list `pnpm gate`); the merge path is covered by the unit test asserting `--force` and by `lead/cli.ts` passing `--merge`.
- `cacheDir` is both computed in `cli.ts` and defaulted in `plan.ts` (the tests need the default), so the default expression appears twice.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is a7f769bc, the current HEAD.
- **Measured:**
  - typecheck took 3.0s cold and 0.9s warm from the shared cache;
  - the affected dry run selects 1 package instead of 12.
- **Follow-up (taken into T-0656):** a root-only change such as `tsconfig.base.json` marks nothing as affected. `turbo.json` gets `globalDependencies`.
- **Nit:** the cache path is defined twice; T-0656 may dedupe it.
