---
id: T-0756
title: "gate faster: format checks only the changed files (prettier --check --ignore-unknown <files>), and lead merge skips its gate re-run when the rebased tree (ignoring work/) is identical to a tree that already passed the gate — a pass record keyed by that tree hash in ~/.zilar-lead/gate-pass/"
status: todo
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

## Review (written by Claude)
