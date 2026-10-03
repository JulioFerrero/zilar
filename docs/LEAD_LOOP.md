# The loop

How work moves from an idea to `main`. Read this before anything else after a reset; `docs/LEAD_HANDOFF.md` has the commands, ids and state.

## Who does what

| Role | Who | Does | Never does |
| --- | --- | --- | --- |
| Owner | Julio | Decides what to build and what ships | |
| Lead | Claude (Opus) | Reads the code, plans, writes specs, launches, reviews, runs QA on the emulator, merges, reports | Write or edit code, tests, scripts or config, even one line |
| Workers | Muse Spark (up to 4 at once) | All code: features, fixes from reviews, conflict resolution, lead tooling | Edit specs, the board or other tasks |
| Pre-reviewer | Muse Spark, automatic | Reviews one task's diff before the lead sees it | Edit anything |
| Doctor | Muse Spark, automatic (T-0196) | Audits `main` after merges, including the lead's commits | Edit anything |
| UI designer | Claude Sonnet subagent | Screens and visual polish that need taste: layout, spacing, hierarchy, empty states | Logic, APIs, data |

The lead writes only these: task specs and the Review section in `work/`, `work/BOARD.md`, `docs/`, fix-round prompts, and memory.

## One task, step by step

1. **Spec.** The lead reads every file the task will touch. The spec states verified facts with `file:line`, exact files, numbered steps, checks and acceptance, using `work/TEMPLATE.md`. Anything about web behaviour cites the web file. If the facts are unclear, the lead launches an audit task (like T-0195) first instead of guessing. Then the lead runs `lead spec-check T-XXXX`, adds the board row and commits.
2. **Launch.** `lead launch T-XXXX` when a slot is free, at most 4 at once, 20 seconds apart. UI-heavy tasks go to the Sonnet designer instead (see below).
3. **Work.** The worker codes, runs `pnpm gate` until it says GATE PASS, sets `status: review` and commits. The autopilot answers its permission requests and nudges it if it stalls.
4. **Pre-review.** This is automatic. When it finds must-fix or should-fix items, the autopilot sends them back to the worker on its own, at most twice.
5. **Packet.** The autopilot prints `PACKET READY [CLEAN]` or `[NEEDS LEAD]`. The lead reads `PREREVIEW.md` and the diff. Anything that needs changing goes back to the worker as a numbered prompt (`lead reply`), however small. The lead does not fix it.
6. **QA.** For mobile screens: `pnpm phone:smoke <branch>`. The lead looks at every screenshot. A crash or a visual problem goes back to the worker as a prompt.
7. **Merge.** The lead writes the Review in the task file, sets `status: merged`, commits, then runs `lead merge T-XXXX --summary "..."`. That command rebases, runs the gate again and refuses to merge on red.
8. **After the merge.** Refresh the dashboard and launch the next task.

## When a rebase conflicts

Workers cannot rebase (the permission rules block it). The lead runs `git rebase main` in the task worktree and leaves it stopped at the conflict. The lead then sends the worker a prompt with the conflicted files, what `main` added and what the task added, and the rule to keep both sides and `git add` the files. When the worker is done, the lead runs `GIT_EDITOR=true git rebase --continue`, repeats for later commits, and then runs `lead merge`. The lead does not edit conflicted files.

## The UI designer (Sonnet)

For new screens or visual polish, the lead starts a Sonnet subagent with the Agent tool (`model: sonnet`, `isolation: worktree`). It gets the same spec format, plus `docs/design/ui-style.md` and emulator screenshots of the current screen. It works on its own branch and runs `pnpm gate`. The lead then reviews its diff, runs `pnpm phone:smoke` on the branch and merges through `lead merge`, the same way as any other task. A screen that needs both logic and design is split: Muse builds the logic and the API, then Sonnet does the look.

## The lead's own rules

- Read a file before writing about it. Never create a file without listing its folder first.
- Run one command, read its result, then run the next. Never chain a commit or a merge behind a command that can fail.
- No Python or `sed` scripts to edit files. Edit and Write are for docs, specs and memory only.
- When unsure, check the code or ask a worker to check (an audit task). Never guess in a spec.
- Short messages to Julio. Report only what was verified.
