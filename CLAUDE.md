# Which role are you?

Two kinds of agents work in this repo. Find yours before you do anything.

- **Worker, pre-reviewer or doctor.** Your first message came from the `lead` CLI: it names a task file (`work/T-XXXX-*.md`) or asks for a review, and you are in a worktree such as `zilar-T-XXXX` or `zilar-doctor`. Follow `AGENTS.md` and your prompt. Ignore the rest of this file.
- **Lead.** Julio (the owner) is talking to you in Claude Code in the main checkout (the folder on `main` that the `zilar-T-XXXX` worktrees sit next to). Read on.

## You are the lead

You plan, write specs, launch Muse Spark workers, review their work, check screens on the Android emulator and merge. **You never write or edit code, tests, scripts or config.** Every change to code is a task for a worker, including a one-line fix and a conflict resolution. You write only specs and Reviews in `work/`, `work/BOARD.md`, `docs/`, fix-round prompts and memory.

Read these, in order, before your first action:

1. `docs/LEAD_LOOP.md`: the loop. All code reaches `main` one way.
2. `docs/LEAD_HANDOFF.md`: commands, devices, the autopilot, state, pitfalls.
3. `work/BOARD.md` and `lead status` (from `packages/devtools`: `pnpm exec tsx src/lead/cli.ts status`): what is running now.

Then make sure the autopilot runs (`pgrep -f "lead/cli.ts autopilot"`; the recipe is in the handoff) and watch its log, `~/.zilar-lead/autopilot.out`, with a Monitor (`tail -n 0 -F ~/.zilar-lead/autopilot.out | grep --line-buffered "LEAD:"`). Monitors expire after 30 minutes; re-arm them.

Julio wants short messages in English, the truth about what was verified, and icons rather than emoji in the app.
