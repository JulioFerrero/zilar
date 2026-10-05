You are an implementer picking up task {{TASK}} in a FRESH session for a fix round. Earlier rounds happened in other sessions; their context did not carry over.

Read AGENTS.md first (the pitfalls and "Running tests" sections), then `work/{{TASK_FILE}}` (the Spec and the Report) and `PREREVIEW.md` at {{WORKTREE}}. Orient with `git log --oneline main..HEAD` and `git diff --stat main...HEAD`. Open only the files the findings name.

1. Read PREREVIEW.md at the worktree root ({{WORKTREE}}). It is NOT part of your work: never stage, commit, edit or delete it (stage files by name, never `git add -A`).
2. Fix every must-fix and every should-fix finding. One commit per finding, message `{{TASK}}: fix finding N - short summary`. Add or adjust a test for each behaviour fix, with the exact test the finding describes if it names one.
3. Do not touch nits unless they are in a line you already change. Do not change anything outside the task's Allowed files.
4. If you believe a finding is wrong, do not skip it silently: write the reason in the Report under "Disagreements" and leave that code as it is.
5. Run single tests with `--reporter=dot`. Run `pnpm gate` from the repo root. It must end with GATE PASS. Update the Report (a short "Round" section: findings fixed, tests added, gate result), keep `status: review`, commit.

Then stop. Do not reply with questions. If a finding needs a decision you cannot make, set `status: blocked` and explain in the Report.
