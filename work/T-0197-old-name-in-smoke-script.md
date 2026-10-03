---
id: T-0197
title: Remove the old product name from the emulator smoke script (main's legacy-name test is red)
status: review
milestone: M5
branch: task/T-0197-old-name-in-smoke-script
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0197: Remove the old product name from the emulator smoke script

## Spec (written by Claude, do not edit)

### Why
`packages/devtools/src/no-legacy-name.test.ts` fails on `main`: it forbids the product's old name in tracked files, and `scripts/phone/smoke.sh` line 23 has it in an error message (the emulator's AVD happens to carry the old name). Any task that touches `packages/devtools` fails its gate until this is fixed.

### What to build
1. In `scripts/phone/smoke.sh`, change the error message on line 23 so it does not name the AVD. Use: `emulator $SERIAL is not running (start it from Android Studio or with emulator -avd <name>; list the names with emulator -list-avds)`. Change nothing else in the file.
2. Do not add an exception to the test.
3. Review files written by the lead's reviewers at a worktree root (`PREREVIEW.md`, `DOCTOR.md`, `SCOUT.md`, `QA.md`) are never committed, but today they make `pnpm format:check` fail (prettier checks untracked files) and make `lead merge` refuse the worktree (`git status --porcelain` lists them). Add them to the root `.gitignore` as root-only patterns (`/PREREVIEW.md`, `/DOCTOR.md`, `/SCOUT.md`, `/QA.md`) under a short comment. Prettier 3 skips git-ignored files, so this fixes both. Prove it: create an empty `PREREVIEW.md` with the text `#  bad   heading` at the worktree root, run `pnpm format:check` and `git status --porcelain` (both must ignore it), then delete it.

### Read first
`AGENTS.md`, `packages/devtools/src/no-legacy-name.test.ts`, `scripts/phone/smoke.sh`.

### Allowed files
`scripts/phone/smoke.sh`, `.gitignore`, `work/T-0197-old-name-in-smoke-script.md`.

### Checks
```bash
pnpm install --frozen-lockfile
bash -n scripts/phone/smoke.sh
pnpm format:check
pnpm --filter @zilar/devtools test --maxWorkers=2 src/no-legacy-name
pnpm gate
```

### Acceptance
- `src/no-legacy-name` passes; `bash -n` passes; `pnpm gate` ends with GATE PASS.

### Out of scope
Any other change.

---

## Report (written by the worker when done)

### What I did
- `scripts/phone/smoke.sh` line 23: replaced the error message naming the AVD with the spec's generic text (`... with emulator -avd <name>; list the names with emulator -list-avds`). No other change to the file.
- `.gitignore`: appended a `T-0197` comment plus root-only patterns `/PREREVIEW.md`, `/DOCTOR.md`, `/SCOUT.md`, `/QA.md`.
- Proof of the gitignore fix: created `PREREVIEW.md` containing `#  bad   heading` at the worktree root; `git status --porcelain` did not list it (shown as `!! PREREVIEW.md` with `--ignored`), and `pnpm prettier --check PREREVIEW.md` reported "All matched files use Prettier code style!" (ignored). Deleted the file afterwards; final `git status --porcelain` shows only the 3 allowed files.

### Files changed (all inside Allowed files)
- `scripts/phone/smoke.sh`
- `.gitignore`
- `work/T-0197-old-name-in-smoke-script.md`

### Commands and real results
- `pnpm install --frozen-lockfile`: exit 0 (Done in 7.2s).
- `bash -n scripts/phone/smoke.sh`: pass (BASH_OK).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 src/no-legacy-name`: 1 passed, 0 failed.
- `pnpm prettier --check work/T-0197-old-name-in-smoke-script.md`: pass. (`smoke.sh`/`.gitignore` have no prettier parser; prettier reported that, which is normal.)
- `pnpm gate`: GATE FAIL — `format` step fails on `CLAUDE.md` ("[warn] CLAUDE.md / Code style issues found"). Scope check printed `scope: every changed file is inside the Allowed files`. Tail summary: `PASS install (frozen)`, `FAIL format`, `GATE FAIL`.
- Verified pre-existing: stashed my changes (`git stash`) and ran `pnpm prettier --check .` on clean main worktree — same `CLAUDE.md` warning. So the failure is on main, not caused by me. `pnpm prettier --write CLAUDE.md` would fix it (9 insertions/9 deletions) but `CLAUDE.md` is outside my Allowed files, so I reverted it and did not keep the change.

### Blocked / needs a decision
Unblocked: the lead fixed `CLAUDE.md` on main and rebased this branch. Gate summary: `gate: 3 changed file(s) against main / PASS install (frozen) (0.9s) / PASS format (10.0s) / PASS lint (0.8s) / PASS typecheck (1.0s) / scope: every changed file is inside the Allowed files / GATE PASS`.

### Security checklist
No secrets, no routes, no deletes/updates, no caps, no auth changes. N/A.

## Review (written by Claude)
