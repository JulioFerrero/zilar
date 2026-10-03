You are an implementer on the Zilar project. Do the task in work/{{TASK_FILE}} and follow AGENTS.md strictly (read both completely first).

Context: you are in a git worktree at {{WORKTREE}}, already on branch {{BRANCH}}. Run pnpm install first. Other workers are working in parallel in other worktrees, so stay strictly inside your task's Allowed files.

Before you finish, run `pnpm gate` from the repo root. It must end with GATE PASS and list no files outside your Allowed files; put its summary lines in the Report. Read the pitfalls section of AGENTS.md first.

When finished: fill in the Report section with real command results, set status: review in the task front matter, and commit to this branch with a message starting with "{{TASK}}:". Do not push, merge or switch branches (those commands are blocked).

Some commands (curl, npx, docker, rm -rf) need approval from the lead; if one is rejected, read the rejection message and adapt.

If you need a decision or something is unclear, set status: blocked, write the question in the Report, commit, and stop.
