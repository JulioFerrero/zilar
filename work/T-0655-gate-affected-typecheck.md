---
id: T-0655
title: "gate: typecheck only the affected packages (turbo --affected, concurrency 2) with one Turbo cache shared by all worktrees; lead merge passes --merge so its typecheck runs with --force"
status: todo
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

## Review (written by Claude)
