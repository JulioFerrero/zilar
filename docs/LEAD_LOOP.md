# The loop

How work moves from an idea to `main`. Read this before anything else after a reset; `docs/LEAD_HANDOFF.md` has the commands, ids and state.

There is one rule the rest follows from: **all code reaches `main` the same way.** A Muse worker writes it in a task worktree, the gate checks it, a Muse pre-reviewer reviews it, the lead reviews it and checks it on the emulator, and `lead merge` merges it. Nothing else writes code.

## Who does what

| Role | Who | Does | Writes |
| --- | --- | --- | --- |
| Owner | Julio | Decides what to build and what ships | |
| Lead | Claude (Opus) | Reads the code, plans, writes specs, launches workers, reviews packets, checks screens on the emulator, merges, reports | Specs and Reviews in `work/`, `work/BOARD.md`, `docs/`, fix-round prompts, memory. Never code, tests, scripts or config |
| Workers | Muse Spark, up to 4 at once | All code: features, fixes from reviews, conflict resolution, lead tooling | Only the Allowed files of their task |
| Pre-reviewer | Muse Spark, started by the autopilot | Reviews one task's diff before the lead sees it | `PREREVIEW.md` only |
| Doctor | Muse Spark, started by the autopilot (once T-0196 is merged) | Checks `main` as a whole after merges | `DOCTOR.md` only |
| Designer | Claude Sonnet subagent | Gives screens the visual care Muse lacks: a design brief before a UI task, a screenshot review after it | Design briefs and review notes, never code |

## One task, step by step

1. **Facts.** The lead reads every file the task will touch. When the facts are spread over many files or unclear (for example "what does web do here?"), the lead launches an audit task (like T-0195) that writes the facts down with `file:line`, and waits for it.
2. **Design (screens only).** For a new screen or visible change, the lead asks the designer for a brief. The designer gets the relevant code, `docs/design/ui-style.md` and emulator screenshots of the screens next to it. The brief names exact components, spacing, text sizes, colours (by token), states (loading, empty, error) and copy. The lead pastes the brief into the spec.
3. **Spec.** The lead writes the spec with `work/TEMPLATE.md`: verified facts with `file:line`, Allowed files, numbered steps, checks and acceptance. Then `lead spec-check T-XXXX`, the board row and a commit.
4. **Launch.** `lead launch T-XXXX` when a slot is free: at most 4 workers, 20 seconds apart.
5. **Work.** The worker codes, runs `pnpm gate` until it prints GATE PASS, sets `status: review` and commits. The autopilot answers its permission requests and nudges it when it stalls.
6. **Pre-review.** The autopilot starts it. When it finds must-fix or should-fix items, the autopilot sends them back to the worker, at most twice, then hands the packet to the lead.
7. **Packet.** The autopilot prints `PACKET READY [CLEAN]` or `[NEEDS LEAD]`. The lead reads `PREREVIEW.md` and the diff. Anything that must change goes back to the worker as a numbered prompt (`lead reply`), however small.
8. **Emulator check.** For mobile screens: `pnpm phone:smoke <branch>`. The lead looks at every screenshot; for a designed screen the designer compares the screenshots with its brief. A crash or a visual problem goes back to the worker as a prompt.
9. **Merge.** The lead writes the Review in the task file, sets `status: merged`, commits, then runs `lead merge T-XXXX --summary "..."`. That command rebases, runs the gate again and refuses to merge on red.
10. **After the merge.** Refresh the dashboard, launch the next task.

A problem found after a merge (by the doctor, Julio or the lead) becomes a new small task. It never becomes a direct edit on `main`.

## When a rebase conflicts

`lead merge` stops on a conflict. Workers cannot rebase (the permission rules block it), so the lead runs `git rebase main` in the task worktree and leaves it stopped. The lead sends the worker a prompt: the conflicted files, what `main` added, what the task added, and the rule to keep both sides and `git add` each file. When the worker is done, the lead runs `GIT_EDITOR=true git rebase --continue`, repeats for later commits, and then runs `lead merge` again. The lead runs the git commands and never edits the files.

## What the doctor is for

Each pre-review sees one task alone. The doctor sees `main` after several merges: the full test suites of the touched packages (no one else runs them), two tasks that each pass but break each other, leftovers from conflict resolution, files outside a task's Allowed list, and features with no line in `docs/FEATURES.md`. It also checks that commits that are not task commits (board, specs, docs) touch only `work/` and `docs/`, which is how a break of this loop would show. Its findings become tasks.

## The lead's own rules

- Read a file before writing about it. List a folder before creating a file in it.
- Run one command, read its result, then run the next. Never chain a commit or a merge behind a command that can fail.
- No Python or `sed` to edit files. Edit and Write are for specs, docs and memory.
- Never state a fact in a spec or to Julio that was not read in the code or seen on the emulator. When unsure, check, or launch an audit task.
- Short messages to Julio.
