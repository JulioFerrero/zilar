---
id: T-0656
title: "gate: at most 2 worker gates at once through a slot lock in ~/.zilar-lead/gate-slots (stale PIDs freed), plus a reserved merge slot; worker gate steps run under nice -n 10; scripts/phone/install.sh stops the Gradle daemons at the end"
status: todo
milestone: M5
branch: task/T-0656-gate-slots-and-nice
model: auto
effort: low
depends_on: [T-0655]
estimate: 0.5 day
---

# T-0656: gate slots, nice, Gradle stop

## Spec (written by Claude, do not edit)

### Why
Several gates running together overload the machine:
- a worker waiting on its model uses almost no CPU, but a gate uses a lot;
- capping gates at 2 at once makes them take turns, so more workers can run at the same load;
- merges keep their own slot, so they never wait behind worker gates;
- worker gates run at a lower priority, which keeps the lead and Julio's work responsive.

Separately, a phone build leaves the Gradle and Kotlin daemons holding memory.

T-0655 (merged first) made the gate's typecheck affected-only and added the `--merge` flag that `lead merge` passes.

### Verified facts (do not re-derive; re-read the files after T-0655's merge)
- **`packages/devtools/src/gate/cli.ts`:**
  - `main()` (about lines 118-176) reads its flags from `process.argv` (T-0655 adds `--merge`);
  - it runs each step through `run(root, step.command, step.args, timeoutMs)`;
  - it ends with `process.exit(failed ? 1 : 0)`;
  - `run` (line 35) uses `spawnSync` with `detached: true` when it has a timeout, and kills the process group on timeout.
- **`packages/devtools/src/gate/plan.ts`** holds the pure helpers tested in `packages/devtools/src/gate/gate.test.ts`.
- **`scripts/phone/install.sh`** (89 lines) changes into `apps/mobile/android` (lines 57 and 67) and runs `./gradlew assembleRelease`. It ends with the "installed … on $SERIAL" echo and the change list.

### What to build
1. **The slot lock** goes in a new `packages/devtools/src/gate/slots.ts` and is tested in a new `packages/devtools/src/gate/slots.test.ts`.
   - Use pure functions with injected `dir`, `pid`, `isAlive(pid)` and `now`, so tests use a temp dir.
   - Slots are directories under `dir`, created with `mkdirSync` (atomic). Each holds a `pid` file.
   - Worker gates use the slot names `w1` and `w2`. A `--merge` gate uses `merge`.
   - `tryAcquire(names)` takes the first free name. A slot whose PID is not alive (`process.kill(pid, 0)` throws) is stale: remove it and take it.
   - `release(name)` removes the slot directory.
2. **In `gate/cli.ts` `main()`:**
   - before the first step, acquire a slot in `~/.zilar-lead/gate-slots` (`w1`/`w2`, or `merge` with `--merge`);
   - while none is free, print `gate: waiting for a free gate slot` once, then poll every 5 s;
   - release the slot on every exit path: normal end, failure, timeout, SIGINT and SIGTERM.
3. **Priority:** when not `--merge`, run each step as `nice -n 10 <command> <args…>`. Merges keep normal priority.
4. **`scripts/phone/install.sh`:** after the build, before the final echo lines, run `./gradlew --stop` in `apps/mobile/android`. It must work from either build branch, and never fail the script (`|| true`).
5. **`turbo.json`:** add `"globalDependencies": ["tsconfig.base.json", "pnpm-lock.yaml"]`. T-0655's worker measured the problem: without it, a branch that changes only `tsconfig.base.json` marks no package as affected, so the gate typechecks nothing.
   - In the Report, paste the dry-run count before and after, with a scratch newline in `tsconfig.base.json` that you do not commit: `TURBO_SCM_BASE=main pnpm exec turbo run typecheck --affected --dry-run=json | grep -c '"taskId"'`.
6. **One cache path:** T-0655 builds the `~/.zilar-turbo-cache` path in both `packages/devtools/src/gate/cli.ts` and `packages/devtools/src/gate/plan.ts`. Keep a single exported constant or function in `plan.ts`.
7. **Tests in `slots.test.ts`:**
   - two takers get `w1` and `w2`, and a third gets nothing;
   - a stale PID is reclaimed;
   - `merge` is independent of `w1` and `w2`;
   - `release` frees the slot.

### Read first
`AGENTS.md`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/plan.ts` (lines 1-60), `scripts/phone/install.sh`.

### Allowed files
`packages/devtools/src/gate/slots.ts`, `packages/devtools/src/gate/slots.test.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/plan.ts`, `scripts/phone/install.sh`, `turbo.json`, `work/T-0656-gate-slots-and-nice.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/slots src/gate/gate
pnpm gate
```

### Acceptance
- Two `pnpm gate` runs in two terminals hold `w1` and `w2`, and a third waits. Show it in the Report with `ls ~/.zilar-lead/gate-slots` while they run.
- Slots are freed after each run.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
