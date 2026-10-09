---
id: T-0757
title: "lead watch shows Claude-subagent tasks: board rows in todo/in-progress/review/blocked with no autopilot record get a card (model from the board's model column, phase from the board status, changed files from ../zilar-T-XXXX), with a 'Claude' badge"
status: todo
milestone: M5
branch: task/T-0757-watch-claude-tasks
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-0757: lead watch shows the Claude-subagent tasks

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-09: "in the lead watch i dont see tasks?". The lead now runs most workers as Claude Code subagents (Haiku 5.5, Sonnet 5.5) instead of through `lead launch`. Those tasks have a row on `work/BOARD.md` and a worktree `../zilar-T-XXXX`, but no record in `~/.zilar-lead/state.json`, so `lead watch` skips them.

### Verified facts (do not re-derive)
- **How watch builds its cards:** `packages/devtools/src/lead/watch.ts:571-608` loops over `snapshot.active` and skips any task without a state record (`state.tasks[task.id]`, lines 573-576). For each card it calls `collectFiles(runner, record.worktree, ...)` (line 579; the helper is at around line 486, and it returns nothing when the worktree is missing), then `readEffort(record.worktree, task.id)` (line 593). The result is `{ clock, refreshFailed, mergedToday, entries }` (line 609).
- **`WatchEntry`** is at `watch.ts:367-382`. `isRunningPhase` is at `watch.ts:453`.
- **Phases:** ids are mapped to tracker steps and colours in `packages/devtools/src/lead/watch-format.ts:19-50` (`coding`, `fixing`, `prereview`, `starting-prereview`, `waiting-lead`, else red).
- **The model badge:** `modelBadge` (`watch-format.ts:61-72`) gives `Muse`, `MiniMax` or the bare id.
- **The board parser:** `packages/devtools/src/effect-map/generate.ts` already exports `parseBoard(text): BoardRow[]` (line 113), which reads open rows from `work/BOARD.md` (`| [T-0752](T-0752-....md) | title | in-progress | haiku-5.5 | deps | notes |`). The open statuses are `todo`, `in-progress`, `review` and `blocked` (`OPEN_STATUSES`, line 70). Reuse it; do not write a second parser.

### What to build
1. **In `watch.ts`, after the existing loop:** read `<root>/work/BOARD.md` with `parseBoard`. For every open row whose id has no card yet and no state record, and whose worktree `path.join(path.dirname(root), 'zilar-' + id)` exists, add a card:
   - `phaseId`: `coding` for `in-progress`, `waiting-lead` for `review`, `blocked` for `blocked`; skip `todo` rows;
   - `phaseLabel`: the board status;
   - `running`: true only for `in-progress`;
   - `model`: the board's model column (for example `haiku-5.5`);
   - `effort`: from `readEffort`;
   - `files`: from `collectFiles`;
   - `totalAge`: the age of the worktree's first commit after `main` (`git log --reverse --format=%ct main..HEAD`, first line), falling back to the worktree directory's mtime, formatted with the existing `formatDuration`;
   - `autoFixRounds`: 0; `step`: the worktree's latest commit subject when it is not on main, else `null`; `speed`: `null`.

   Put the pure part (board row plus facts in, `WatchEntry` out) in an exported function, and test it.
2. **`modelBadge`:** add a `Claude` badge for ids that contain `haiku`, `sonnet`, `opus` or `claude`, as name `Claude ` plus the family and version (for example `Claude Haiku 5.5`). Pick a colour that is distinct from Muse and MiniMax and works on a dark terminal. Update `watch-format.test.ts`.
3. **Tests:** in `packages/devtools/src/lead/watch.test.ts`, cover the board-only entries: an in-progress row with a worktree gives a running card; a review row gives `waiting-lead`; a row whose worktree is missing gives no card; a row whose id already has a state record gives no duplicate. Use a temporary directory and injected git output; never touch the real `~/.zilar-lead` or real worktrees.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch-format.ts`, `packages/devtools/src/lead/watch.test.ts`, `packages/devtools/src/effect-map/generate.ts` (lines 60-150).

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`, `packages/devtools/src/lead/watch-format.ts`, `packages/devtools/src/lead/watch-format.test.ts`, `work/T-0757-watch-claude-tasks.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --reporter=dot src/lead/watch
pnpm gate
```
Also run `cd packages/devtools && pnpm exec tsx src/lead/cli.ts watch --data` once from the worktree and paste the number of entries and their ids into the Report. It prints one JSON line and exits.

### Acceptance
- Board-only tasks with a worktree show as cards, with a Claude badge, the right phase and their changed files.
- The tests cover the four cases.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
