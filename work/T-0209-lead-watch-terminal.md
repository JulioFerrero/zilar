---
id: T-0209
title: Lead tooling: `lead watch`, a live terminal view of every running task (step, model, files) with small animations
status: planned
milestone: M5
branch: task/T-0209-lead-watch-terminal
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0209: `lead watch`, a live terminal view of the workers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "a mini tool, terminal tool, so, with a small resized terminal i can see the working of the task? like, the name of the task, the model of ai working, in what step if its thinking, coding, a little list of edited, created and deleted files, etc all this live and updated live with little terminal animations". Julio asked for MiniMax to build it.

### What Julio sees
`pnpm lead:watch` (from the repo root) fills the terminal (alternate screen, cursor hidden) and redraws in place. It must look good in a small window (about 60 columns by 25 rows) and use more room when the window is bigger. One block per running task, for example:

```
 zilar lead watch                         10:42:07
 3 running · 1 waiting for you

 ⠹ T-0191  Mobile sticker pack editor
   muse-spark-1.3-contributor (low) · 42 min
   Coding · editing pack-editor.ts
   + sticker-native.ts   + pack-editor.ts
   ~ stickers-api.ts     - old-sheet.tsx
   +2 more

 ● T-0202  Fix rounds in a fresh worker session
   muse-spark-1.3-contributor (low) · 1 h 5 min
   Packet ready, waiting for the lead
```

- Line 1 of a block: an animated spinner (braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) while the session works; a steady `●` when it waits (idle, waiting for the lead, blocked); the task id in bold; the title cut with `…` to the width.
- Line 2: the model id without the provider, the effort variant in brackets, and how long the task has run.
- Line 3: the phase label, then ` · ` and the live step (below). The live step is shown only while the session runs.
- Then the changed files on the branch: `+` created (green), `~` modified (yellow), `-` deleted (red), basenames only, laid out in two columns when the width is 70 or more and one column below that, at most 6 files then `+N more`. `work/` files are not listed.
- Colours by phase: coding and fixing cyan, pre-review magenta, waiting for the lead or blocked or idle yellow, quota red. A short animated dot trail (`.`, `..`, `...`) after the step text while it runs.
- Header: title, the clock, the count of running tasks and of tasks waiting for Julio's lead (`phase.needsLead`).
- Nothing running: one dim line `No tasks in flight.`
- `q` or Ctrl-C quits and restores the screen and cursor. The view also restores the terminal on any crash (`process.on('exit')`).

### The live step (from the newest messages of the session)
While a task is in review and its pre-review runs, read the pre-review session instead of the worker session.
Look at the newest assistant message (sessions come back newest first, see facts) and its last content part:
- `reasoning` → `thinking`
- `tool` named `edit` or `write` → `editing <basename of input.path>`
- `tool` named `read` → `reading <basename of input.path>`
- `tool` named `shell`: when `input.command` contains `pnpm gate` → `running the gate`; when it contains `test` → `running tests`; when it starts with `git commit` → `committing`; otherwise `running <first 30 characters of the command>`
- any other `tool` → `using <name>`
- `text` → `writing a reply`
- newest message of type `idle` → no step.

### Verified facts (do not re-derive)
- Commands are dispatched in `main()` in `packages/devtools/src/lead/cli.ts` (lines 310-342); the help text is the `HELP` constant (lines 21-41). `runSnapshot` (lines 275-283) shows how to build the deps: `collectSnapshot({ client: new OpencodeCliClient(), runner: new RealGitRunner(), statePath: stateFilePath(), root, now: Date.now() })` with `root = findRepoRoot()`.
- `collectSnapshot` (`packages/devtools/src/lead/collect-snapshot.ts` line 219) returns `Snapshot` (`packages/devtools/src/lead/snapshot.ts` lines 84-118): `active: SnapshotTask[]` with `id`, `title`, `model` (`provider/model`), `phase: { id, label, needsLead }`, `totalAge`. Reuse it for everything except the live step and the files.
- `~/.zilar-lead/state.json` is read with `loadState(stateFilePath())` (`packages/devtools/src/lead/state.ts` lines 8 and 24). Each task record has `sessionId`, `worktree` (absolute path) and `prereview` (with `sessionId` when one ran).
- `client.listMessages(sessionId, limit)` (`packages/devtools/src/lead/client.ts` line 262) returns messages newest first. A message looks like `{ id, time: { created }, type: 'assistant', model: { id: 'muse-spark-1.3-contributor', providerID: 'meta', variant: 'low' }, content: [...] }` or `{ type: 'idle', outcome }`. Content parts: `{ type: 'reasoning', text }`, `{ type: 'text', text }`, `{ type: 'tool', name, state: { status, input } }`. Tool names seen in real sessions: `shell` (input `command`, `workdir`), `edit` (input `path`, `oldString`, `newString`), `write` (input `path`, `content`), `read` (input `path`, `offset`, `limit`). `path` is absolute. The lead read these shapes from a real worker session.
- `GitRunner.run(cwd, args)` in `packages/devtools/src/lead/git.ts` (lines 8-23) runs git synchronously and returns `{ ok, stdout }`.
- Changed files of a branch, uncommitted work included: `git merge-base main HEAD` in the worktree, then `git diff --name-status <base>` (A, M, D, and R as delete plus create) plus `git status --porcelain` lines starting with `??` (created).
- The devtools package has no UI dependency (`packages/devtools/package.json`: only `zod`). Use plain ANSI escape codes; no new dependency.
- Root scripts are in `package.json` lines 25-28.

### What to build
1. New `packages/devtools/src/lead/watch.ts` with pure, exported functions:
   - `liveStep(messages: unknown[]): string | null` (the table above; defensive on unknown shapes: return null, never throw).
   - `parseChangedFiles(nameStatus: string, porcelain: string): { path: string; kind: 'created' | 'modified' | 'deleted' }[]` (skip paths under `work/`; keep the order: created, modified, deleted, each sorted).
   - `modelLabel(model: string, variant: string | undefined): string` (`meta/muse-spark-1.3-contributor` and `low` → `muse-spark-1.3-contributor (low)`).
   - `renderWatch(view: WatchView, width: number, frame: number, color: boolean): string[]` returning the screen lines; `WatchView` holds the clock text and one entry per task (id, title, model label, total age, phase, running flag, step, files). With `color` false it emits no escape codes. No line is longer than `width` visible characters.
2. In the same file, `runWatch()`: every 3 seconds collect the snapshot, then for each active task the live step (worker or pre-review session, `listMessages(id, 5)`) and the changed files (git in the worktree; skip if the worktree is missing); redraw every 120 ms with the latest data and the next animation frame; redraw at once on `process.stdout` `resize`. A failed refresh keeps the previous data and shows `refresh failed, retrying` dimmed in the header; it never exits.
3. `cli.ts`: a `watch` command that calls `runWatch()`, and one line in `HELP`: `watch                                                     live terminal view of every running task`.
4. Root `package.json`: script `"lead:watch": "pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts watch"`.
5. Tests in new `packages/devtools/src/lead/watch.test.ts`: each `liveStep` case of the table plus an empty list and a junk entry; `parseChangedFiles` with A, M, D, R, `??` and a `work/` path; `modelLabel` with and without a variant; `renderWatch` without colour at width 60 and 100 (one running task with 8 files shows 6 and `+2 more`; a waiting task shows `●`; the frame number changes the spinner character; no line exceeds the width; the empty view shows `No tasks in flight.`).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/snapshot.ts`, `packages/devtools/src/lead/collect-snapshot.ts` (lines 1-130 and 219-227), `packages/devtools/src/lead/cli.ts` (lines 1-60 and 270-345), `packages/devtools/src/lead/git.ts`, `packages/devtools/src/lead/client.ts` (lines 40-77 and 255-275).

### Allowed files
`packages/devtools/src/lead/watch.ts` (new), `packages/devtools/src/lead/watch.test.ts` (new), `packages/devtools/src/lead/cli.ts`, `package.json`, `work/T-0209-lead-watch-terminal.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts
pnpm gate
```
The lead runs `pnpm lead:watch` in a small terminal before merging.

### Acceptance
- `pnpm lead:watch` shows every running task with its model, phase, live step and changed files, animates, adapts to the window width and quits cleanly on `q` and Ctrl-C.
- The view never writes to `~/.zilar-lead/state.json`, never sends anything to a session, and never runs a git command that changes a worktree (read-only).
- No new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Keyboard navigation, scrolling, opening a task, merged or queued lists, token counts, sound.

---

## Report (written by the worker when done)

## Review (written by Claude)
