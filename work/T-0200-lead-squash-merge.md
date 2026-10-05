---
id: T-0200
title: Lead tooling: lead merge lands each task as ONE commit on main (squash, board included)
status: review
milestone: M5
branch: task/T-0200-lead-squash-merge
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0200: `lead merge` lands each task as one commit

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-04: main had 1,102 commits, 5 to 8 per task (the worker's commits, fix rounds, the review commit, then `board: T-XXXX merged`). He wants one commit per task from now on. The old history is compacted separately by the lead; this task changes how every future task lands.

### Verified facts (do not re-derive)
- `mergeTask` in `packages/devtools/src/lead/merge.ts` (line 117) does, in order: refuse a dirty main (line 118), require `status: merged` in the worktree's task file (line 124), refuse a dirty worktree (line 130), `git rebase main` in the worktree (line 136), run the gate (line 148), `git merge --ff-only <branch>` in main (line 156), rewrite `work/BOARD.md` with `moveBoardRow` (lines 160-170), `git commit -qam "board: <task> merged"` (line 171), `git push -q origin main` (line 179), stop worktree processes, `git worktree remove` (line 187), `git branch -d <branch>` (line 191), `dropFromState`.
- `merge.test.ts` builds real temporary repos (a bare `origin`, a `root` on `main`, a worktree on the task branch) through the `git()` helper (line 41) and calls `mergeTask` with `RealGitRunner`. Copy that style.
- The usage line for `merge` is `packages/devtools/src/lead/cli.ts` line 32.

### What to build
1. In `mergeTask`, replace the fast-forward and the board commit (lines 156-178) with a squash, keeping every step before and after unchanged:
   a. Before squashing, read the subjects of the branch's commits: `git log --reverse --format=%s main..<branch>` in `root`.
   b. `git merge --squash <branch>` in `root`. On failure throw `MergeError('squash of <branch> failed')` and leave main as it is (the rebase already made main an ancestor, so this should not happen).
   c. Rewrite `work/BOARD.md` with `moveBoardRow` exactly as today.
   d. `git add work/BOARD.md`, then `git commit -q -m <subject> -m <body>` (two `-m` arguments through the runner): subject `<task>: <summary>` (the `--summary` text); body `Squashed from <branch>:` followed by one line `- <subject>` per commit from step a.
   e. Safety check before pushing: `git diff --quiet HEAD <branch> -- . ':(exclude)work/BOARD.md'` in `root` must succeed (main now has exactly the branch's files apart from the board). If it fails, throw `MergeError('squash result differs from <branch>; nothing pushed')` and do not push.
2. Because the branch is no longer an ancestor of main, `git branch -d` (line 191) would refuse. Use `git branch -D <branch>`, and ONLY after step 1e passed and the push succeeded.
3. Update the usage line in `cli.ts` (line 32) to say `squash` instead of `fast-forward main`.
4. Tests in `merge.test.ts`, same harness:
   - the happy path (line 210) now asserts main gained exactly ONE commit over its old HEAD, whose subject is `T-0099: <summary>`, whose body lists the branch's commit subjects in order, and which contains both the feature change and the board change; `origin/main` equals local `main`; the branch is deleted;
   - a branch with three commits still yields one commit on main;
   - existing tests (dirty main, dirty worktree, status not merged, rebase conflict, gate failure, process stopping) keep passing; adjust only assertions that named the old `board: ... merged` commit or the fast-forward.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/merge.ts`, `packages/devtools/src/lead/merge.test.ts`, `packages/devtools/src/lead/board.ts`, `packages/devtools/src/lead/git.ts`.

### Allowed files
`packages/devtools/src/lead/merge.ts`, `packages/devtools/src/lead/merge.test.ts`, `packages/devtools/src/lead/cli.ts`, `work/T-0200-lead-squash-merge.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead/merge
pnpm gate
```

### Acceptance
- One `lead merge` adds exactly one commit to main, named `T-XXXX: <summary>`, holding the task's changes and the board row.
- Nothing is pushed when the squash result differs from the branch; `git reset`, `git push --force` and `--no-verify` appear nowhere.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Rewriting old history, the lead's own `work:`/`docs:` commits, any other lead command.

---

## Report (written by the worker when done)

Implemented squash merge in `mergeTask`: reads branch commit subjects, `git merge --squash`, stages the board row, commits once as `<task>: <summary>` with body `Squashed from <branch>:` + subject list, verifies with `git diff --quiet HEAD <branch> -- . ':(exclude)work/BOARD.md'` before push, and deletes the branch with `-D` after a successful push. Updated `cli.ts` usage line to say "squash onto main". Rewrote the happy-path test for the one-commit assertion and added a three-commits-to-one test.

Files changed:
- `packages/devtools/src/lead/merge.ts`
- `packages/devtools/src/lead/merge.test.ts`
- `packages/devtools/src/lead/cli.ts`

Commands and results:
- `pnpm install --frozen-lockfile`: exit 0
- `pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead/merge`: 15 passed
- `pnpm format:check`: pass
- `pnpm lint`: pass (11 tasks)
- `pnpm typecheck`: pass (11 tasks)
- `pnpm gate`: GATE PASS — "4 changed file(s) against main", PASS install/format/lint/typecheck/tests @zilar/devtools, "scope: every changed file is inside the Allowed files", GATE PASS

Security checklist: no secrets/tokens touched; squash commit only adds branch files + board row; `git diff --quiet` safety check blocks push on mismatch; `branch -D` runs only after push success; no `reset`/`push --force`/`--no-verify` in `merge.ts` (verified by grep).

### Round 2 (pre-review fixes)

Fixed both should-fix findings from PREREVIEW.md (must-fix=0):
- Finding 1 (board validated before squash): `moveBoardRow` text is now computed before `git merge --squash`, so a board throw leaves main's tree clean and the merge stays re-runnable. Test: "leaves main untouched when the board row is unparseable" (hand-edited `| T-0099 |` row, asserts `git status --porcelain` empty after refusal).
- Finding 2 (safety-check test): added stub-runner test "refuses to push when the squash result differs from the branch" (diff returns non-ok, asserts push never runs, `squash result differs…; nothing pushed` thrown).
- Follow-ups 3-4 (`collect-snapshot.ts` grep, `LEAD_PLAYBOOK.md` docs) are outside Allowed files; left for separate tasks as the verdict directs. No disagreements.

Round 2 commands: `pnpm --filter @zilar/devtools test --maxWorkers=2 src/lead/merge`: 17 passed; `pnpm gate`: GATE PASS — "4 changed file(s) against main", PASS install/format/lint/typecheck/tests @zilar/devtools, scope clean.

Deviation / open question: `packages/devtools/src/lead/collect-snapshot.ts` (lines 168, 176) greps main's log for the old `board: T-… merged` subject to build the dashboard "merged today" list. After this change no new commit will match, so that list will go empty. Fixing it means matching `^T-\d+: ` subjects, but that file is outside my Allowed files — left for the lead to task separately.

## Review (written by Claude)
