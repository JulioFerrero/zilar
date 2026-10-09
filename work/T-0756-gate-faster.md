---
id: T-0756
title: "gate faster: format checks only the changed files (prettier --check --ignore-unknown <files>), and lead merge skips its gate re-run when the rebased tree (ignoring work/) is identical to a tree that already passed the gate — a pass record keyed by that tree hash in ~/.zilar-lead/gate-pass/"
status: merged
milestone: M5
branch: task/T-0756-gate-faster
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0756: a faster gate, and no repeat gate at merge

## Spec (written by Claude, do not edit)

### Why
Measured on 2026-10-09:
- **The format step:** every gate's `format` step takes 12 to 17 s because it checks the whole repository.
- **The repeat gate:** every task runs the gate two or three times, once or twice in the worker and again in `lead merge` after the rebase. When `main` has not moved, the merge re-runs the gate on exactly the code that already passed. CI on `main` still runs the full format check and every test, so it stays the safety net.

### Verified facts (do not re-derive)
- **The steps** are in `packages/devtools/src/gate/plan.ts`: `gateSteps` (line 128) builds `install (frozen)`, then `format` (`pnpm format:check`, line 142, which is `prettier --check .` per `package.json:16`), then `lint` (line 143), then `typecheck` (turbo `--affected`, with `--force` in merge mode, lines 144-156), then the tests nearest to the changed files.
- **The CLI:** `packages/devtools/src/gate/cli.ts` reads `--merge` (line 152), takes a slot (line 163) and prints `gate: N changed file(s) against <base>` (line 180).
- **`lead merge`** calls `runGate(worktree)` (`packages/devtools/src/lead/cli.ts:227-235`), which spawns `pnpm gate --merge` and is wired at line 259 (`--skip-gate` disables it). `mergeTask` runs the gate after the rebase (`packages/devtools/src/lead/merge.ts:148-155`).
- **The tests** are `packages/devtools/src/gate/gate.test.ts` (for example "runs install, format, lint and typecheck, then only the nearest tests", line 124) and `packages/devtools/src/lead/merge.test.ts` (the `mergeTask gate` describe, line 543).

### What to build
1. **Format only the changed files.** The `format` step runs `pnpm exec prettier --check --ignore-unknown <changed files that still exist>`. When no files changed, skip the step and print `SKIP format (no changed files)`. With `--full`, keep `pnpm format:check`. Update the tests in `gate.test.ts`.
2. **The pass record:** when the gate passes, write an empty file `~/.zilar-lead/gate-pass/<key>`, where `<key>` is the hash of the working tree with `work/` left out. Build the key from a temporary index:
   - `GIT_INDEX_FILE=<tmp> git add -A`;
   - `git rm -r --cached --quiet --ignore-unmatch work`;
   - `git write-tree`.

   The key must include uncommitted changes, because workers often run the gate before they commit. Put the helper in `packages/devtools/src/gate/pass-record.ts` and test it in a temporary git repo, with no real home directory.
3. **The skip at merge:** in `lead/cli.ts` `runGate`, compute the key in the rebased worktree first. If `~/.zilar-lead/gate-pass/<key>` exists, return `{ ok: true, output: 'gate: skipped, this tree already passed (<key-prefix>)' }` without running the gate. Otherwise run the gate as now. `--skip-gate` keeps its meaning. Add a unit test for the skip decision, with the key function and the existence check injected, so no real gate runs.
4. **Cleanup:** keep at most 500 records; delete the oldest when writing a new one.

### Read first
`AGENTS.md`, `packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts` (lines 100-240), `packages/devtools/src/lead/cli.ts` (lines 220-270), `packages/devtools/src/lead/merge.ts` (lines 130-160).

### Allowed files
`packages/devtools/src/gate/plan.ts`, `packages/devtools/src/gate/cli.ts`, `packages/devtools/src/gate/gate.test.ts`, `packages/devtools/src/gate/pass-record.ts`, `packages/devtools/src/gate/pass-record.test.ts`, `packages/devtools/src/lead/cli.ts`, `work/T-0756-gate-faster.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/gate src/lead/merge
pnpm gate
```

### Acceptance
- The gate's format step checks only the changed files.
- A passing gate writes the record, and a merge of an identical tree skips the re-run.
- The tests cover both.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Done.** All four build items are in place: the format step checks only the changed files that still exist, a passing gate writes a pass record, `lead merge` skips its gate re-run when the rebased tree has a record, and the record folder is pruned to 500.

**Files changed (all inside Allowed files):**
- `packages/devtools/src/gate/plan.ts`: `formatStep` (new) builds `pnpm exec prettier --check --ignore-unknown <changed files that exist>`; `full` keeps `pnpm format:check`; no present files gives `skipReason: 'no changed files'`.
- `packages/devtools/src/gate/cli.ts`: computes `treeKey(root)` before the steps; on `GATE PASS` writes the record with `writePassRecord(gatePassDir, key)`.
- `packages/devtools/src/gate/pass-record.ts` (new): `gatePassDir` (`~/.zilar-lead/gate-pass`), `MAX_PASS_RECORDS = 500`, `treeKey`, `hasPassRecord`, `writePassRecord`, `pruneOldestRecords`, `alreadyPassedKey` (the skip decision, with injected `treeKey` and `hasRecord`).
- `packages/devtools/src/gate/pass-record.test.ts` (new): 10 tests, each in its own temp folder; a temp git repo for `treeKey`.
- `packages/devtools/src/gate/gate.test.ts`: 3 new format-step tests (changed files only, skipped when none left, `--full` keeps `format:check`).
- `packages/devtools/src/lead/cli.ts`: `runGate` calls `alreadyPassedKey` first; on a hit it returns `{ ok: true, output: 'gate: skipped, this tree already passed (<12-char key>)' }` without spawning the gate.
- `work/T-0756-gate-faster.md`: status and this Report.

**Commands and results:**
- `pnpm install --frozen-lockfile`: done (vitest 5.0.2 linked).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/gate/gate.test.ts src/gate/pass-record.test.ts`: 2 files, 36 passed, 0 failed.
- `pnpm exec prettier --write` on the six changed source files: `pass-record.ts` and `pass-record.test.ts` were reformatted, the other four were already clean. Prettier `--check` on the ignored `work/` file passes silently.
- `pnpm gate` (from the worktree root, 7 changed files):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (1.0s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.5s)
  PASS  tests @zilar/devtools  (17.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- A pass record was written by that gate run: `~/.zilar-lead/gate-pass/e9259cdc9a0006c57302c47b01c96c0a63d8ded9` (the only file there).

**Format step time:** before, `pnpm format:check` (the whole repo, 2765 tracked files) took 19.3 s wall, measured once with `time` before the change. After, the gate's format step on the 7 changed files took 1.0 s.

**Not done / not verified:**
- I did not run `lead merge` or any `lead` command, as instructed. The merge skip is verified only by its unit test (`alreadyPassedKey` with injected deps), not end to end.
- The `SKIP format (no changed files)` line goes through the existing `SKIP ${label} (${skipReason})` print in `gate/cli.ts`. The skip itself is unit-tested, but I did not see the printed line.
- `treeKey` runs `git add -A` on a fresh temp index at every gate start; its own cost is not timed separately (the whole gate run is above).

**Deviations:** none from the spec. The skip decision lives in `pass-record.ts` (not in `runGate` itself) so it can be tested with injected dependencies; `runGate` only wires the real functions in.

**Open questions:**
- A key failure (git cannot hash the tree) means no record is written and the merge runs the full gate. This is the safe default, but I did not check it against a real broken worktree.
- The key is computed at gate start, so the record names the tree the steps checked even if files change during the run.

## Review (written by Claude)

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **The format step:** checks only the changed files that still exist (`exists` is wired at `gate/cli.ts:166`) and skips when there are none. It took 1.0 s, against 19.3 s for the whole repo; `--full` keeps the whole-repo check.
- **The pass record:** keyed by a temporary-index `write-tree` with `work/` left out (about 5 s on this repo). It is written only when the gate passes, and the key is taken before the steps run.
- **At merge:** `runGate` skips the gate when the rebased tree already has a record, and runs it as before when main has moved.
- **Unchanged:** a scope violation is still printed, not counted as a failure.
- **First real check:** the next `lead merge` of an unchanged branch should print "gate: skipped".
