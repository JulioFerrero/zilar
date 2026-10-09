---
id: T-0799
title: "lead batch: `lead batch check <T-...>` combines task branches on one wave worktree, runs install + typecheck + every package's tests without stopping at the first failure, maps each failure to its owning task and writes one fix file per task; `lead batch merge <T-...>` merges a checked wave without re-gating"
status: merged
milestone: M5
branch: task/T-0799-lead-batch
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0799: `lead batch`, one combined check for a wave of tasks

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-09: "have 20 agents doing code, wait for all to finish, check all at one, report every fix back to every agent... we need a way to speed things up". Workers now run only their own tests. This command gives the lead one combined check for a whole wave, plus one merge step.

### Verified facts (do not re-derive)
- **The CLI:** `packages/devtools/src/lead/cli.ts`, with the dispatch in `main()` at lines 352-389 and the help text `HELP` near line 35 (the `merge` line is line 35). `findRepoRoot()` is at line 48, `flag()` and `flagValue()` at lines 62-66.
- **`runMerge`** is at lines 250-280. It finds the task file with `findTaskFile(root, task)`, reads `branch` with `parseTaskFrontMatter`, sets the worktree to `../zilar-<task>`, and calls `mergeTask` from `merge.ts`. With `--skip-gate` it omits the `gate` option (line 273).
- **`mergeTask`** (`packages/devtools/src/lead/merge.ts:117-230`):
  1. it refuses on a dirty main and on a task status other than `merged`;
  2. it rebases the worktree on main, optionally runs the gate, squashes, moves the board row (`moveBoardRow`), commits, checks that the squash equals the branch, pushes, and removes the worktree and branch.
- **The git seam** is `GitRunner` and `RealGitRunner` in `lead/git.ts:8-24`; `porcelainLines` is at `git.ts:25`.
- **The scope check** is `scopeReport(taskText, changedFiles)` in `packages/devtools/src/gate/scope.ts:46`, used by the gate at `gate/cli.ts:219`.
- **Pass records:** `treeKey(root)`, `hasPassRecord` and `gatePassDir` in `packages/devtools/src/gate/pass-record.ts:14-50`.
- **Every package's `test` script is `vitest run`,** some with timeouts: `apps/{web,server,mobile,site,runner}` and `packages/{devtools,protocol,xmpp-core,chat-core,agent-drivers,ui-tokens,runner-tunnel}`.
- **The gate stops at the first failing step** (`gate/cli.ts`, the `break` after `FAIL`), which is why it cannot report all failures of a wave.

### What to build
A new module `packages/devtools/src/lead/batch.ts` with injectable seams (git runner, a command runner, the file system and a clock, as `merge.ts` does), wired into `cli.ts` as two subcommands.

1. **`lead batch check <T-A> <T-B> ...`**
   1. **The wave worktree.** Recreate the worktree `../zilar-wave` on branch `wave` from `main`, removing any old one first (`git worktree remove --force`, `git branch -D wave`).
   2. **Combine the branches.** For each task in the order given, read its branch from the task file in its worktree (`../zilar-<T>/work/<file>`, as `runMerge` does) and run `git merge --no-ff --no-edit <branch>` in the wave worktree. On a conflict, record the conflicted files, run `git merge --abort` and continue with the next task.
   3. **Ownership.** For each merged task, list `git diff --name-only main...<branch>`.
   4. **Scope.** For each merged task, run `scopeReport(taskText, files)` and record the files outside its Allowed list.
   5. **Checks in the wave worktree, all of them, never stopping at the first failure:**
      - `pnpm install --frozen-lockfile`;
      - the typecheck of every package (`pnpm turbo run typecheck --continue`, or per package; read `turbo.json` and the gate's typecheck step in `gate/plan.ts:146-156`);
      - every package's tests, as `pnpm --filter <pkg> exec vitest run --reporter=json --outputFile=<wave dir>/<pkg>.json` (keep the package's own timeouts from its `test` script), at most 2 packages at a time.
   6. **Map each failure to an owner.**
      - **Failures:** a typecheck error (parse `path(line,col): error TS…` and the `path:line:col - error` form) and a failed test (from the JSON: its file, the test's full name and the first 30 lines of its message).
      - **Owner rule:** a file in a task's diff belongs to that task. A test file whose folder holds a file in a task's diff, with the same base name (`foo.test.tsx` and `foo.tsx`), belongs to that task. Otherwise the failure is `unowned`.
   7. **Output.** Write to `~/.zilar-lead/wave/<UTC stamp>/`:
      - `report.md`: one row per task (merged / conflict, out-of-scope files, typecheck errors, failed tests), then an `unowned` section;
      - one `<T>.fix.md` per task with failures, as a numbered list with the file, the test name or TS error, and the message. It must be ready to paste as a fix prompt.
      - It also writes `~/.zilar-lead/wave/last.json` with the task list, the wave HEAD sha, `treeKey` of the wave worktree and an `ok` flag.
      - It prints the report path and one line per task.
      - It exits 0 only when every task merged cleanly, every check passed and nothing is out of scope.
2. **`lead batch merge <T-A> <T-B> ...`**
   1. **It refuses unless:** `last.json` exists and is `ok`, its task list equals the given list as a set, and each task's branch head is still the commit that was combined (store each task's head sha in `last.json`).
   2. **It merges the tasks one by one** in the given order, calling `mergeTask` with **no gate**. The board summary is the task's title from its row in `work/BOARD.md` (the second column); if a row is missing, it stops with a clear error. Each merge rebases on the new main.
   3. **It checks the result:** `git diff --quiet <wave sha> HEAD -- . ':(exclude)work'` in the main checkout. It prints `wave merged: main matches the checked tree`, or the differing paths as a warning; it never reverts.
3. **Help text:** add both subcommands to `HELP`.

### Tests
`packages/devtools/src/lead/batch.test.ts`, with fake runners, no real git and no real pnpm:
- two tasks merge, and one has a failing test in its own file → that task's fix file lists it, and the other task has none;
- a conflict on the second task → it is reported, `merge --abort` runs and the third task is still combined;
- a typecheck error in a file owned by task B → B's fix file;
- an unowned failure → the `unowned` section;
- an out-of-scope file → in the report, and the exit is non-zero;
- `batch merge` refuses with no or a stale `last.json` (a moved branch head, a different task set);
- `batch merge` calls `mergeTask` without a gate, using the board titles.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/cli.ts`, `merge.ts`, `merge.test.ts` (the fake runner pattern), `git.ts`, `board.ts`, `task-file.ts`, `packages/devtools/src/gate/scope.ts`, `gate/pass-record.ts`, `gate/plan.ts`, `gate/cli.ts`, `turbo.json`.

### Allowed files
`packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch.test.ts`, `packages/devtools/src/lead/cli.ts`, `work/T-0799-lead-batch.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/lead/batch src/lead/merge
pnpm gate
```

### Acceptance
- Both subcommands work as described; the tests pass 3 of 3 runs.
- No change to `lead merge` behaviour; `merge.test.ts` passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

- `lead batch check <T-A> <T-B> ...` (`packages/devtools/src/lead/batch.ts`, `runBatchCheck`):
  - recreates `../zilar-wave` on branch `wave` from `main` (remove --force, prune, `branch -D wave`, `worktree add -b wave`);
  - merges each task's branch (read from `../zilar-<T>/work/<file>`) with `merge --no-ff --no-edit`; on a conflict it records the conflicted files, runs `merge --abort` and goes on with the next task;
  - per merged task: `git diff --name-only main...<branch>` for ownership, and `scopeReport` for out-of-scope files;
  - runs `pnpm install --frozen-lockfile`, `pnpm exec turbo run typecheck --continue --concurrency=2` and, per package with a `test` script, `pnpm --filter <pkg> exec vitest run --reporter=json --outputFile=<wave dir>/<pkg>.json <flags from the package's test script>` (2 packages at a time). It never stops at the first failure; a failed install or a missing report is recorded as a `tool` failure;
  - maps failures to owners (file in a task's diff; a test file next to a diff file with the same base name; otherwise unowned);
  - writes `~/.zilar-lead/wave/<UTC stamp>/report.md` (one row per task, then `## unowned`), one `<T>.fix.md` per task with a conflict, out-of-scope file or failure (numbered list, ready to paste), and `~/.zilar-lead/wave/last.json` (tasks, per-task branch and head sha, wave sha, treeKey, ok);
  - prints the report path and one line per task; exit 1 unless all merged, all checks passed and nothing is out of scope.
- `lead batch merge <T-A> <T-B> ...` (`runBatchMerge`): refuses with no `last.json`, a not-ok wave, a different task set (order is free) or a moved branch head; reads all board titles first (a missing row stops it before any merge); calls `mergeTask` per task in the given order with no `gate`; then `git diff --quiet <wave sha> HEAD -- . ':(exclude)work'` and prints `wave merged: main matches the checked tree` or a warning with the differing paths (never reverts).
- HELP lists both subcommands; `cli.ts` dispatches `batch`.
- Tests: `batch.test.ts` has 22 tests on fake git, fake commands and an in-memory file system (no real git or pnpm). `pnpm --filter @zilar/devtools test --reporter=dot src/lead/batch src/lead/merge`: 3 runs, each 2 files, 39 passed (merge.test.ts unchanged). Devtools `pnpm typecheck`: clean.
- `pnpm gate`: install, format, lint, typecheck, effect PASS; tests @zilar/devtools PASS (34.1s); "scope: every changed file is inside the Allowed files"; GATE PASS.
- Unsure: the first four gate runs failed only on timeouts (5000ms) of different real-git tests in the unchanged `merge.test.ts` while the machine load average was 25 to 38; the fifth run passed. Those tests passed in my 3 isolated runs. Also: if two tasks touch the same file, a failure there goes to the first task in the given order. The real runners (spawn, package reading, `realBatchDeps`) are not covered by tests; I did not run `lead batch` against real worktrees.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. `lead batch check` and `lead batch merge`, 22 tests with fakes. Fix round 1: a legacy name in a test path, caught by the combined check. The first real run is wave 2.
