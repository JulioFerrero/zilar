---
id: T-0656
title: "gate: at most 2 worker gates at once through a slot lock in ~/.zilar-lead/gate-slots (stale PIDs freed), plus a reserved merge slot; worker gate steps run under nice -n 10; scripts/phone/install.sh stops the Gradle daemons at the end"
status: merged
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

### What I did

1. **Slot lock** — new `packages/devtools/src/gate/slots.ts`. Pure functions with injected
   `dir`, `pid`, `isAlive(pid)` and `now`. Slots are directories created with `mkdirSync`;
   each holds a `pid` file. `tryAcquire(dir, names, deps)` takes the first free name
   (`w1`/`w2` for a worker, `merge` for a merge gate). A slot whose pid is dead (or whose
   pid file is missing) is stale and is reclaimed; reclaim is atomic — the stale directory
   is renamed to a unique `${name}.stale.${pid}.${now}` tombstone first, so two waiters
   cannot both take it. `release(dir, name)` removes the slot directory.
2. **`gate/cli.ts`** — `main()` acquires `w1`/`w2` (or `merge` with `--merge`) from
   `~/.zilar-lead/gate-slots` before the first step. When both worker slots are busy it
   prints `gate: waiting for a free gate slot` once and polls every 5 s (synchronous
   `Atomics.wait`, no child process). The slot is released in a `finally` (normal end,
   failure, timeout) and by `SIGINT`/`SIGTERM` handlers.
3. **Priority** — every step of a non-merge gate runs through `nice -n 10 <command> <args…>`;
   a `--merge` gate keeps normal priority.
4. **`scripts/phone/install.sh`** — `./gradlew --stop || true` after the build and state
   writes, before the final echo lines. Both build branches leave the shell in
   `apps/mobile/android`, so it works from either; `|| true` keeps a stop failure from
   failing the install.
5. **`turbo.json`** — added `"globalDependencies": ["tsconfig.base.json", "pnpm-lock.yaml"]`.
6. **One cache path** — `plan.ts` now exports `turboCacheDir`; `cli.ts` and the `gateSteps`
   default both use it.
7. **Tests** — `slots.test.ts` covers two takers → `w1`/`w2`, a third → nothing, a stale pid
   reclaimed, `merge` independent of `w1`/`w2`, and `release` freeing a slot.

### Files changed (all inside Allowed files)

`packages/devtools/src/gate/slots.ts` (new), `packages/devtools/src/gate/slots.test.ts`
(new), `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/plan.ts`,
`scripts/phone/install.sh`, `turbo.json`, `work/T-0656-gate-slots-and-nice.md`.

### Commands and real results

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/slots src/gate/gate`
  → `Test Files 2 passed (2)`, `Tests 27 passed (27)`.
- `bash -n scripts/phone/install.sh` → SH_OK.
- `pnpm gate` (repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (19.9s)
  PASS  lint  (1.5s)
  PASS  typecheck  (39.9s)
  PASS  tests @zilar/devtools  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- **Turbo `globalDependencies` (spec 5):** with a scratch newline in `tsconfig.base.json`
  (not committed), `TURBO_SCM_BASE=main pnpm exec turbo run typecheck --affected --dry-run=json | grep -c '"taskId"'`:
  - before adding `globalDependencies`: **0**
  - after: **12**

  (Measured with my other edits reverted to `main` and the new `slots.*` files moved aside,
  so only the `tsconfig.base.json` scratch remained as the diff.)

### Slot lock demonstration

`lib`-level demo against the real `~/.zilar-lead/gate-slots` directory (`tsx -e`, one
foreground process), holding two slots with a live pid:

```
held: w1 w2
w1
w2
third: undefined
merge: merge
after release: (empty)
```

After `pnpm gate`, `ls -la ~/.zilar-lead/gate-slots` showed the directory empty (slots
freed). I did **not** run two `pnpm gate` processes at once: AGENTS.md forbids starting
background/parallel jobs, so the concurrency evidence comes from the library demo above
plus `slots.test.ts`, not from two terminals. Flag if you want the two-terminal run
despite that rule.

### Deviations / notes

- No deviations from the spec otherwise.
- `tryAcquire` treats a missing `pid` file as stale (a crashed creator), which keeps a
  crashed gate from blocking the slot forever; reclaim is atomic so a rare double-reclaim
  cannot hand the same name to two live processes.

### Round: fix round 1 (finding 1, should-fix)

**Finding fixed:** the mkdir-then-write slot claim was not atomic. Two gates could both
hold the same name: gate A's `mkdir` succeeded before its pid write landed; gate B read a
missing pid, treated the fresh slot as stale, renamed it away, re-created it and wrote its
own pid; A's plain write then overwrote B's (or B's reclaim deleted A's), and both
returned `true`.

**Fix (`packages/devtools/src/gate/slots.ts`):**
- New `claimPid(slot, pid)` writes the pid file with `flag: 'wx'` (exclusive create) and
  reads it back, confirming it still holds our pid before returning `true`. `acquire` now
  returns `claimPid(...)`, so only one of two racing writers wins and a directory reclaimed
  and re-created under us is detected.
- `reclaim` now re-reads the pid from the renamed tombstone: if a live owner appeared
  between the liveness read and the rename, the slot is not stale, so it renames it back
  and returns `false` instead of deleting a live slot.

**Tests added (`slots.test.ts`):**
- `claimPid` writes once and refuses to overwrite an existing pid file (the `wx` guard).
- `tryAcquire` does not reclaim a slot whose pid appears between the liveness check and the
  rename; the live owner's slot is restored.

**Commands:**
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/slots src/gate/gate`
  → `Test Files 2 passed (2)`, `Tests 29 passed (29)` (was 27; +2 new).
- `pnpm gate` (repo root), GATE PASS:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (13.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.6s)
  PASS  tests @zilar/devtools  (0.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- After the gate, `ls ~/.zilar-lead/gate-slots` was empty (the gate released its slot).

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean after 1 automatic round. The packet head is e5eb934c, the current HEAD.
- **Lead check:**
  - the slot claim is exclusive (`wx` plus read-back);
  - merges take the `merge` slot at normal priority;
  - worker steps run under `nice -n 10`;
  - `./gradlew --stop || true` runs after the phone build;
  - with `globalDependencies`, a root-only tsconfig change selects 12 packages instead of 0.
- **Nits (no round):** a microsecond reclaim race only lowers capacity until the next stale reclaim; tombstones may be left after a crash.
