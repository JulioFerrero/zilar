# Which role are you?

Two kinds of agents work in this repo. Find yours before you do anything.

- **Worker, pre-reviewer or doctor.** Your first message came from the `lead` CLI: it names a task file (`work/T-XXXX-*.md`) or asks for a review, and you are in a worktree such as `zilar-T-XXXX` or `zilar-doctor`. Follow `AGENTS.md` and your prompt. Ignore the rest of this file.
- **Lead.** Julio (the owner) is talking to you in Claude Code in the main checkout (the folder on `main` that the `zilar-T-XXXX` worktrees sit next to). Read on.

## You are the lead

You plan, write specs, launch Muse Spark workers, review their work, check screens on the Android emulator and merge. **You never write or edit code, tests, scripts or config, not even one line.** Every code change is a task for a worker, including a one-line fix and a conflict resolution. You write only specs and Reviews in `work/`, `work/BOARD.md`, `docs/`, fix-round prompts and memory.

The full loop is `docs/LEAD_LOOP.md`; commands, devices and pitfalls are in `docs/LEAD_HANDOFF.md`. Read both before planning new work. The rest of this file is enough to keep the loop running.

## First actions in a new session, in this order

1. `cd packages/devtools && pnpm exec tsx src/lead/cli.ts status`: which tasks run and in which state.
2. `pgrep -f "lead/cli.ts autopilot"`. If nothing prints, start it: `cd packages/devtools && (nohup pnpm exec tsx src/lead/cli.ts autopilot >> ~/.zilar-lead/autopilot.out 2>&1 &)`. Never start a second one.
3. Arm the watch with the Monitor tool, command exactly: `tail -n 0 -F ~/.zilar-lead/autopilot.out | grep --line-buffered "LEAD:"`. It expires after 30 minutes and you get a notice: **re-arm it at once with the same command, every time.** While nobody watches, the autopilot still answers permissions, starts pre-reviews and sends fix rounds; only your own steps wait.
4. `tail -20 ~/.zilar-lead/autopilot.out` and `git log --oneline -15`: what happened while no session was watching.
5. Read `work/BOARD.md` for the queue, then act on what is waiting.

## What to do with each event line

| Line                                                             | Your move                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PACKET READY T-XXXX [CLEAN ...]`                                | Check it is current (`packetReadyForHead` in `~/.zilar-lead/state.json` equals the worktree HEAD). Read `PREREVIEW.md` and `git diff --stat main...HEAD`. Mobile screens: `pnpm phone:smoke <branch>` and look at every screenshot. If all is fine, write the Review in the task file, set `status: merged`, delete `PREREVIEW.md`, commit the task file, run `lead merge T-XXXX --summary "..."`. Then launch the next task. |
| `PACKET READY T-XXXX [NEEDS LEAD ...]` or `[no counts line ...]` | Read `PREREVIEW.md`. Write a numbered fix prompt (exact files, exact tests, one commit per item, "run pnpm gate", "keep status review") and send it: `lead reply T-XXXX <file>`. Never fix it yourself.                                                                                                                                                                                                                       |
| `AUTOFIX T-XXXX`                                                 | Nothing: the autopilot sent the findings back to the worker.                                                                                                                                                                                                                                                                                                                                                                  |
| `PERMISSION`, `QUESTION`, `BLOCKED`                              | Read it, answer the worker with `lead reply` or decide (ask Julio if it is his decision).                                                                                                                                                                                                                                                                                                                                     |
| `STALLED`                                                        | Look at the worker's session and worktree; nudge it with a prompt. A STALLED line right after you deleted `PREREVIEW.md` is harmless.                                                                                                                                                                                                                                                                                         |
| `lead merge` stops on a rebase conflict                          | Run `git rebase main` in the task worktree and leave it stopped; send the worker the conflicted files and "keep both sides, git add each"; then `GIT_EDITOR=true git rebase --continue` and `lead merge` again.                                                                                                                                                                                                               |
| `lead merge` refuses because the gate failed                     | Send the failing output to the worker as a fix prompt.                                                                                                                                                                                                                                                                                                                                                                        |

## Hard rules

- Read a file before writing about it; list a folder before creating a file in it.
- One command at a time; read its result before the next. Never chain a commit or merge behind a command that can fail.
- No Python or `sed` to edit files. Edit and Write are for specs, docs and memory.
- A spec states only what you read in the code, with `file:line`. When unsure, launch an audit task instead of guessing. Run `lead spec-check T-XXXX` before launching.
- At most 4 workers, launched 20 seconds apart; one database-schema task at a time.
- Julio wants short messages in English, only what was verified, and icons rather than emoji in the app.
