---
id: T-0209
title: Lead tooling: `lead watch`, a live terminal view of every running task (step, model, files) with small animations
status: merged
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

### What I did

Built `pnpm lead:watch`: a live terminal view of every running worker task. The package now exports `liveStep`, `parseChangedFiles`, `modelLabel`, `renderWatch` (pure, tested) and `runWatch` (the terminal loop). The `lead` CLI got a new `watch` subcommand and the root `package.json` got the `lead:watch` script.

The renderer matches the spec example at width 60 and width 100, restores the terminal on `q`, Ctrl-C and `process.on('exit')`, and keeps the previous tasks visible with a dimmed `refresh failed, retrying` in the header when the snapshot throws. Files are read from `git merge-base main HEAD` + `git diff --name-status <base>` + `git status --porcelain ??`, in the worktree (skipped if the worktree is gone, falls back to the cached list), with `work/` paths dropped and a `+N more` after 6 entries.

The live step uses the pre-review session while the pre-review is running, otherwise the worker session. Phase colors: coding/fixing cyan, pre-review magenta, waiting/blocked/idle yellow, quota red.

### Files I changed

- `packages/devtools/src/lead/watch.ts` (new) — pure helpers + `runWatch` loop
- `packages/devtools/src/lead/watch.test.ts` (new) — 23 tests covering every spec bullet
- `packages/devtools/src/lead/cli.ts` — added `runWatch` import, HELP line, `watch` dispatch
- `package.json` — added `"lead:watch": "pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts watch"`
- `work/T-0209-lead-watch-terminal.md` — this Report and the `status: review` flip

### Commands I ran

```
pnpm install                                                        # 12 packages, 0 errors
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot \
  src/lead/watch.test.ts                                            # 23 passed (23)
pnpm exec prettier --write packages/devtools/src/lead/watch.ts \
  packages/devtools/src/lead/watch.test.ts                          # fixed: 2 files
pnpm gate                                                           # GATE PASS
```

`pnpm gate` summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (0.8s)
PASS  format  (10.8s)
PASS  lint  (0.4s)
PASS  typecheck  (1.9s)
PASS  tests @zilar/devtools  (10.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 5 changed files are exactly the 5 in the Allowed list. No new dependency; the devtools package still has only `zod` plus `tsx`/`@xmpp/client` in devDeps.

### Problems and deviations

- The lead state does not carry `effort`; `collectSnapshot` doesn't surface it either. I read it from the task file's front matter (`work/<task>.md`) inside `buildView` using the existing `findTaskFile` + `parseFrontMatter` helpers. Both are exported, so no other files were touched.
- The spec lists "modelLabel with and without a variant" (2 cases). I added a third case for a bare model id without a provider prefix (`modelLabel('bar', 'medium')`) as a small belt-and-braces check. Spec list still satisfied.
- I added one extra `renderWatch` test ("puts the clock on the right and the title on the left of the header") because the spec describes the layout in words and an assertion feels cheap insurance. The spec list of required tests is still covered.
- The gate initially failed with a prettier complaint on the two new files, then with one unused variable. Both fixed before the final GATE PASS; the formatting was applied with `pnpm exec prettier --write`.

### Blocked / needs a decision

None.

### Round (fix round)

The PREREVIEW named one must-fix and two should-fix findings; I fixed all three and left the three nits alone (per "Do not touch nits unless they are in a line you already change").

Findings fixed:

- **Finding 1 (must-fix)** — `q`/`Ctrl-C` quit path no longer leaks raw mode. Extracted `disableRawMode(stdin, ref)` (exported) and called it from `restore()` so the cleanup runs whether or not `process.exit` interrupts the `finally`. Hoisted the `stdin` and `stdinRaw` declarations above `restore` so the closure can see them. New test: `disableRawMode > clears raw mode when the ref says it is on` (asserts the ref's `raw` becomes `false`) plus a `> is a no-op when raw mode was never enabled` sanity check. Each test uses a fake stdin with a recorded call list.
- **Finding 2 (should-fix)** — `collectFiles` now returns the previous `fallback` when either `merge-base` or `diff --name-status` fails. Promoted `collectFiles` to an exported function and added three tests under `describe('collectFiles')`: merge-base fails → fallback, diff fails → fallback, both succeed → parses both `name-status` and porcelain correctly (the third is the happy-path spec for the new function shape).
- **Finding 3 (should-fix)** — meta line and file rows are now clipped to `width` visible characters. `renderEntry` clips `meta` and `third` with `clip(..., width)`. `renderFiles` clips each `left`/`right` column item to `itemBudget = max(0, colWidth - 1)` and the single-column items to `itemBudget = max(0, width - 6)`. New test: `renderWatch > clips the meta line and file rows when basenames are longer than the width` (entry has a 60-char `modelLabel` and a 56-char basename; renders at width 60; asserts every line's `length` ≤ 60).

Disagreements: none.

Tests added: 6. New `it(...)` cases: 1 in `renderWatch` (clip meta + file rows when basenames are wider than `width`), 2 in a new `describe('disableRawMode')` (clears raw mode when ref says it is on, no-op when never enabled), 3 in a new `describe('collectFiles')` (merge-base fails → fallback, diff fails → fallback, both succeed → parses name-status + porcelain). Suite size: 25 → 31.

Commands I ran:

```
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts   # 31 passed (31)
pnpm exec prettier --write packages/devtools/src/lead/watch.ts \
  packages/devtools/src/lead/watch.test.ts                                                  # reformatted: 2
pnpm gate                                                                                   # GATE PASS
```

`pnpm gate` summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (13.6s)
PASS  lint  (0.6s)
PASS  typecheck  (2.3s)
PASS  tests @zilar/devtools  (12.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Five new commits on the branch (after `684adc98`):

```
18ca93cc T-0209: typecheck-safe fake stdin for disableRawMode test
390d823a T-0209: prettier reformat of watch.ts and watch.test.ts
431e499b T-0209: fix finding 3 - clip meta line and file rows to width
d3b43cd7 T-0209: fix finding 2 - return fallback from collectFiles when git merge-base or diff fails
a32f4ca9 T-0209: fix finding 1 - clear stdin raw mode inside restore() so q/Ctrl-C do not leak raw mode
```

`git diff main...HEAD --name-only` still lists the same 5 files as the original Allowed list; no new dependency.

### Lead round

The lead ran `pnpm lead:watch` in a 60x25 pseudo-terminal for 12 seconds: it renders correctly, but the animation freezes and the screen flickers. Two must-fix items, two commits.

**Lead 1 (animation blocking)** — fixed in `T-0209: fix lead 1 - refresh in a child process, animation never blocks` (7784ab2f).

- `runWatch` used to await `buildView` inside the redraw loop, so the synchronous git and OpenCode CLI calls froze the spinner for the second of every 3-second refresh. `q` was also unreadable during a refresh.
- New `runWatchData()` in `watch.ts` builds the view once with the existing `buildView` and prints one JSON line. Hidden `--data` flag on `lead watch` (handled in `cli.ts`'s `watch` dispatch).
- `runWatch` now runs the redraw on `setInterval(REDRAW_INTERVAL_MS)` and the refresh on `setInterval(REFRESH_INTERVAL_MS)`. The refresh interval spawns a child with `execFile(process.execPath, [...process.execArgv, process.argv[1], 'watch', '--data'], { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }, cb)`; a `refreshing` flag prevents a second child while one is running. On success it parses the JSON line; on error (or parse failure) it keeps the previous view and sets `refreshFailed = true`.
- The child's `process.execArgv` carries `tsx`'s `--require`/`--import` hooks so the `.ts` file runs in the child the same way the parent was launched.
- File cache: the child returns the files it found as part of each entry, so the parent doesn't need to track a cross-process cache. (The lead explicitly said this was OK: "the child returns the files it found".)

**Lead 2 (flicker)** — fixed in `T-0209: fix lead 2 - redraw in place without clearing` (db9878e2).

- Every frame used to write `ESC.clearScreen` (`\u001b[2J\u001b[H`), blanking the whole screen for one tick and producing visible flicker.
- Extracted `frameText(lines: string[]): string` (exported, tested). It writes `\u001b[H` (cursor home), then each line followed by `\u001b[K` (clear to end of line) and a newline, then `\u001b[J` (clear to end of screen) once at the end. No `\u001b[2J`. Tested: the result contains no `\u001b[2J` and ends with `\u001b[J`.
- `ESC.clearScreen` is now used only on entering the alternate screen, on `process.stdout` `resize` (tracked by a `needsClear` flag consumed on the next redraw), and on `restore()` (final cleanup before exit).
- New ESC constants `cursorHome`, `clearLine`, `clearScreenBelow` keep the prefix fragments readable.

### New tests (9 total)

- `parseWatchView` (6): round-trips a valid view, junk string, empty string, wrong field type, missing entry field, bad file kind. Junk → `null`.
- `frameText` (3): no `\u001b[2J` and ends with `\u001b[J`; full sequence including per-line `\u001b[K`; empty `lines` list does not crash.

Suite size: 31 → 40. All pass.

### Commands I ran

```
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts   # 40 passed (40)
pnpm gate                                                                                # GATE PASS
pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts watch --data 2>&1 | head -1 \
  | grep -o '"id":"[^"]*"'                                                                 # T-0191, T-0209 (child prints one JSON line and exits)
(pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts watch 2>&1 &) ; sleep 1 ; \
  pkill -f "tsx src/lead/cli.ts watch"                                                   # redraw frames seen: [H ... [K per line ... [J (no [2J between frames)
```

`pnpm gate` summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (12.0s)
PASS  lint  (0.5s)
PASS  typecheck  (0.6s)
PASS  tests @zilar/devtools  (11.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

`git diff main...HEAD --name-only` is still the same 5 files as before; no new dependency.

### Disagreements

None.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Verdict:** Approved after two automatic rounds and one lead round (MiniMax). `pnpm lead:watch` shows every task in flight with spinner, model and effort, run time, phase, live step and changed files, in an alternate screen, and restores the terminal on `q`, Ctrl-C and exit. The automatic rounds fixed raw mode left on after `q`, files vanishing on a failed git call and over-long lines. The lead ran it in a 60x25 pseudo-terminal: before the lead round it dropped from 8 to 2-3 frames per second during every refresh (synchronous `spawnSync` calls inside the redraw loop) and cleared the whole screen every frame; after it, the data comes from a child process (`lead watch --data`), redraws run on their own timer at a steady 8 frames per second, and the screen is cleared once, then redrawn in place. Accepted nits: three small ones from the last pre-review. Follow-up: T-0210 adds the speed line.
