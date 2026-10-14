---
id: T-1420
title: "Lead CLI: one commit per task on main: specs launch from an uncommitted file and are committed on the task branch; merge adds the board row itself and carries work/NOW.md along; merge subjects at most 72 characters"
status: merged
milestone: M5
branch: task/T-1420-one-commit-per-task
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1420: One commit per task on main

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: fewer commits, and clear commit titles. The git audit (`docs/audit/git-history-audit.md`) found that 55% of main's commits are lead bookkeeping (specs, `work/NOW.md`, `work/BOARD.md`), about 1.4 extra commits per task. It also found that 57% of merge subjects are longer than 72 characters (max 217).

**The goal:** a task lands on main as **one** commit holding its spec, code, Report, Review and board row, plus the lead's NOW.md notes, with a subject of at most 72 characters.

### Facts (the lead checked them on main, 2026-10-14)
- **`lead launch`** is `packages/devtools/src/lead/launch.ts` (273 lines).
  - It reads the task's front matter from **main's** `work/` (`readTaskFrontMatter(deps.repoRoot, task)`).
  - It runs `git worktree add -q <worktree> -b <branch> <ref>` (`:231-242`).
  - Only for a non-main base does it copy the spec into the worktree and commit it (`commitEvalSpec`, `:180-202`, message "`T-XXXX: eval spec`").
- **`lead merge`** is `packages/devtools/src/lead/merge.ts` (230 lines).
  - It refuses when the main checkout is dirty (`:116-122`, `porcelainLines`).
  - It reads the task status from the worktree's copy (`:51-53`).
  - It squashes, writes the board with `moveBoardRow` and stages `work/BOARD.md` (`:170-188`).
  - It commits `${task}: ${summary}` with the body "Squashed from <branch>:" plus the subjects (`:189-199`).
  - It checks that the squash equals the branch except `work/BOARD.md` (`:200-210`), then pushes, removes the worktree and deletes the branch (`:211-229`).
- **`moveBoardRow`** is `packages/devtools/src/lead/board.ts` (48 lines). It **throws "board has no Active row"** when the Active table lacks the task (`:33-34`).
- **The CLI** is `packages/devtools/src/lead/cli.ts` (411 lines, already over 400: keep its growth to a few dispatch lines). There are tests in `merge.test.ts`. Find the other readers of `work/T-*.md` on main (autopilot, status, start-prereview, task-file.ts) with `grep -rn "work/" packages/devtools/src/lead`.

### What to build
1. **Launch from an uncommitted spec.**
   - When `work/T-XXXX-*.md` exists in the main checkout but is **not committed** on main (untracked, or added but uncommitted), `lead launch` creates the worktree from `main`, **copies the spec in and commits it on the task branch** as `T-XXXX: spec` (reuse `commitEvalSpec`, generalised), then **removes the uncommitted copy from main**, so main stays clean.
   - A spec already committed on main keeps working as today.
2. **Readers use the worktree copy.** Every command that reads a running task's file (status, autopilot, pre-review start, reply, spec-check after launch) reads it from the task's worktree when the task is in `state.json`, and from main otherwise. Keep the change small: one helper in `task-file.ts`.
3. **The board without an Active row.** `moveBoardRow` no longer throws when the Active table has no row for the task; it just appends the done row. This lets a launch skip the board commit. Keep the current behaviour when the row exists.
4. **NOW.md rides along.**
   - The dirty check ignores `work/NOW.md` and untracked `work/T-*.md` specs that aren't this task's.
   - If `work/NOW.md` is modified, the merge stages it into the squash commit (next to `work/BOARD.md`), and the "squash equals branch" check excludes it too.
5. **Subjects at most 72 characters.** `lead merge` refuses when `${task}: ${summary}` is longer than 72 characters, with a clear message giving the length. The `--summary` help says so.
6. **Docs:** update `docs/LEAD_LOOP.md` and `docs/LEAD_HANDOFF.md` with the new flow, in a few lines each:
   - write the spec in `work/`, don't commit it, `spec-check`, `launch`;
   - no BOARD Active row needed;
   - NOW.md is committed by the next merge.

### Tests (pipeline: few)
In `merge.test.ts`, or a new `launch.test.ts` / `board.test.ts`:
- launch with an untracked spec → the branch has the spec commit and main is clean;
- merge with no Active row → the done row is appended;
- merge with a modified NOW.md → it's in the squash commit;
- a 73-character subject is refused.

### Allowed files
`packages/devtools/src/lead/**`, `docs/LEAD_LOOP.md`, `docs/LEAD_HANDOFF.md`, `work/T-1420-one-commit-per-task.md`.

### Checks
```bash
pnpm --filter @zilar/devtools exec vitest run src/lead --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; new files are at most 400 lines and `cli.ts` grows by at most 5.
- An existing task launched the old way (spec committed on main, Active row on the board) still merges unchanged.

---

## Report (written by the worker when done)

### What I did

- **Launch from an uncommitted spec** (`launch.ts`). `commitEvalSpec` is generalised to `commitSpec(deps, worktree, file, message)`. A launch from `main` now checks `git cat-file -e HEAD:work/<file>`: when the spec is not on main (untracked or staged) it is copied into the worktree and committed on the task branch as `T-XXXX: spec`, then removed from main (`git rm -f` when staged, unlink when untracked), so main stays clean. A spec already committed on main is left alone. The `--base` eval path still commits `T-XXXX: eval spec`.
- **Readers use the worktree copy** (`task-file.ts` + call sites). New helper `taskFileDir(repoRoot, task, statePath)` returns the tracked task's worktree when it exists (the spec may live only on the branch), else the repo root. Used by `lead merge` and `lead spec-check` in `cli.ts`. `autopilot` (fallback-model), `switch-model` (both paths) and `fresh-session` now read front matter from the task's worktree instead of main. `status`, `prereview` and `reply` already read the worktree.
- **Board without an Active row** (`board.ts`). `moveBoardRow` no longer throws when the Active table has no row for the task; it appends the Done row. When the Active row exists it is still removed first.
- **NOW.md rides along** (`merge.ts`). The main dirty check ignores `work/NOW.md` and untracked `work/T-*.md` specs of other tasks. A modified `work/NOW.md` is staged next to `work/BOARD.md` and excluded from the "squash equals branch" diff.
- **Subject at most 72 characters** (`merge.ts`). Refuses when `T-XXXX: summary` is longer than 72, with a message giving the length. The `--summary` help and usage text say so.
- **Docs**: `docs/LEAD_LOOP.md` and `docs/LEAD_HANDOFF.md` updated for the uncommitted-spec flow, no Active row, NOW.md in the next merge, and the 72-character subject.

### Files changed

`packages/devtools/src/lead/launch.ts`, `merge.ts`, `board.ts`, `task-file.ts`, `cli.ts`, `autopilot.ts`, `switch-model.ts`, `fresh-session.ts`, `merge.test.ts`, new `launch.test.ts`; `docs/LEAD_LOOP.md`, `docs/LEAD_HANDOFF.md`, `work/T-1420-one-commit-per-task.md`.

### Commands run

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/launch.test.ts` → 2 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts` → 21 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts` → 1 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead` → 5 files, 39 passed.
- `pnpm gate` (repo root) → GATE PASS:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (2.7s)
PASS  effect  (0.8s)
PASS  tests @zilar/devtools  (12.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

### Deviations / notes

- `moveBoardRow` still returns `removedActive`, now unused by callers; kept so the interface is unchanged.
- The old merge test that asserted a broken Active row aborts the merge was replaced with a "no Done section" test, because a missing Active row is now valid by design; that test still proves the board is validated before the squash.
- `taskFileDir` consults `state.json`; a tracked task whose worktree is already gone falls back to main.

### Open questions

None.

### Round (fix round 1, 2026-10-14)

**Findings fixed**

- Finding 1 (must-fix): the main dirty-check misparsed an unstaged edit of a
  tracked `work/NOW.md`. `porcelainLines` trims each line, so ` M work/NOW.md`
  arrived as `M work/NOW.md` and `porcelainPath`'s `slice(3)` returned
  `ork/NOW.md`, making both `nowModified` and `isIgnorableMainChange` false and
  the merge throw "main checkout has uncommitted changes". `porcelainPath`
  (`packages/devtools/src/lead/merge.ts`) now finds the first space that ends
  the status columns: one column when the trim ate the leading space
  (`M work/NOW.md`), two otherwise (`?? work/...`, `M  work/...`). Staged,
  untracked and two-column shapes are unchanged.

**Tests added**

- `merge.test.ts`: a tracked `work/NOW.md` is committed, then edited unstaged
  (porcelain ` M work/NOW.md`); the test asserts the merge succeeds, the edited
  `work/NOW.md` is in the squash commit's file list, its content is the edit,
  and main is left clean. This fails before the fix (the merge throws) and
  passes after.

**Nits not addressed**

- Findings 2 (`lead batch merge` on a new-flow task) and 3 (staged-spec launch
  path untested) are nits and the lines involved are not otherwise touched, so
  per the fix-round instructions they are left as they are. Neither is a
  correctness regression introduced by this task.

**Commands run**

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/merge.test.ts` → 1 file, 22 passed (21 before + 1 new).
- `pnpm gate` (repo root) → GATE PASS:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.6s)
PASS  lint  (0.8s)
PASS  typecheck  (2.0s)
PASS  effect  (0.6s)
PASS  tests @zilar/devtools  (13.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
GATE PASS
```

**Disagreements**

None.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 1 auto round, nit 2. The lead CLI tests pass locally (5 files, 40 tests); cli.ts +3 net. From now on: specs stay uncommitted on main until launch, there's no Active board row, NOW.md rides the merge, and subjects are at most 72 characters.
