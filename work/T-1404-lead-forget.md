---
id: T-1404
title: "lead forget: drop finished tasks from ~/.zilar-lead/state.json (by id, or --finished for every task whose worktree is gone or whose status is merged or eval-*) so lead watch and status show live work only"
status: merged
milestone: M5
branch: task/T-1404-lead-forget
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1404: lead forget

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "In the lead watch i see a lot of task, there is something wrong?" Nothing is wrong: `~/.zilar-lead/state.json` keeps every task it ever tracked (46 today). Only 2 are live; the rest are old merged tasks and deleted eval worktrees. He chose to clean them up.

### Facts (the lead checked them, 2026-10-14)
- **State module:** `packages/devtools/src/lead/state.ts` (105 lines): `loadState` (`:31`), `saveState` (`:85`), `updateState` (`:94`), `appendLog` (`:101`). Tasks are under `state.tasks`.
- **CLI:** `packages/devtools/src/lead/cli.ts` (415 lines, already over the limit). The usage text and the `status` command are at `:396`.
- **`lead status`** shows entries whose task file is missing as `(missing)`; the eval tasks show `eval-done` or `eval-stopped`.

### What to build
1. **`lead forget <T-XXXX> [<T-YYYY> ...]`** removes those entries from `state.tasks` through `updateState`.
   - It **refuses** an entry whose session is running or busy, or whose task status is `todo`, `in-progress` or `review`, with one line saying why.
   - It logs one line per removed task with `appendLog`.
2. **`lead forget --finished`** removes every entry that is either:
   - one whose worktree folder no longer exists **and** whose session is idle; or
   - one whose task status is `merged`, `(missing)`, `eval-done`, `eval-stopped` or `eval-dq`, with an idle session.

   It prints the ids removed and a count. With `--dry-run`, it only prints.
3. **The command goes in a new file** `packages/devtools/src/lead/forget.ts`. `cli.ts` only dispatches to it and gains the usage line. Keep `cli.ts` from growing: if you must add lines, move another command's body out of `cli.ts` so the file shrinks below 415. It must not grow.
4. **The autopilot** reads state fresh each loop. Make sure a forgotten task isn't re-added, and isn't touched again (no resume prompts, no nudges).
5. **No test** (dev tooling, not crucial code).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/state.ts`, `cli.ts`, `status.ts`, `autopilot.ts` (how it iterates `state.tasks`).

### Allowed files
`packages/devtools/src/lead/forget.ts`, `packages/devtools/src/lead/cli.ts`, `packages/devtools/src/lead/state.ts`, `packages/devtools/src/lead/autopilot.ts`, `packages/devtools/src/lead/status.ts`, `work/T-1404-lead-forget.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; `cli.ts` is not longer than it was.
- The Report shows `lead forget --finished --dry-run` output run against a **copy** of the state: `ZILAR_LEAD_STATE=/tmp/<copy>.json`. Never write the real `~/.zilar-lead/state.json`; the lead runs the real one after the merge.

---

## Report (written by the worker when done)

### What I did
- New `packages/devtools/src/lead/forget.ts`: `forgetTasks(deps, options)` plus the CLI glue `runForget(positional, args)`.
  - `lead forget <T-XXXX> [...]` refuses an entry whose task status is `todo`/`in-progress`/`review`, whose session is `running`, or whose session state cannot be read (treated as possibly busy). It prints one line per id (`forgot`/`refused`/`not tracked`) and removes the accepted ids through a single `updateState`, logging one line per removal with `appendLog`.
  - `lead forget --finished [--dry-run]` selects every entry whose task status is `merged`/`(missing)`/`eval-done`/`eval-stopped`/`eval-dq`, or whose worktree folder is gone, **and** whose session is `idle`; it prints the ids and a count and, unless `--dry-run`, removes them through `updateState` and logs each with `appendLog`. `--dry-run` only prints.
  - `--finished` with positional ids (or no ids and no `--finished`) raises the usage error.
- `cli.ts` only dispatches: added `import { runForget } from './forget.js'` and the `forget` branch, added the usage line. To keep it from growing I moved the `runStatus` command body into `status.ts` (next to its collector) and import it. `cli.ts` went from 415 to **411** lines.
- `status.ts`: exported the existing `taskStatusOf` so `forget.ts` reuses it (no duplicate status parsing), and added the moved `runStatus`.
- `autopilot.ts`: comment only — documented that the existing write-back guard (writes a record back only when the task is still in the freshly re-read state) also covers forgotten tasks, so a forgotten task is never re-added and the next tick neither resumes nor nudges it. Verified `tickOnce` loads state fresh at the start of each tick and `applyActions`/`fresh-session.ts`/`start-prereview.ts` never write state entries themselves.

### Files changed
- Added `packages/devtools/src/lead/forget.ts` (151 lines).
- `packages/devtools/src/lead/cli.ts` (415 → 411 lines).
- `packages/devtools/src/lead/status.ts` (88 → 98 lines).
- `packages/devtools/src/lead/autopilot.ts` (comment only).
- `work/T-1404-lead-forget.md`.

### Commands and real results
- `pnpm install` (required first): "Done in 11.3s", one pre-existing warning about `@types/react-dom` peer `@types/react` in `apps/mobile` (unrelated to this task).
- `pnpm gate` (final run, after formatting):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.7s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/devtools  (11.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (First gate run failed only on format for `forget.ts`; fixed with `pnpm exec prettier --write packages/devtools/src/lead/forget.ts` and re-ran the gate.)
- No test file was run standalone: the spec says no test, and I did not touch crucial code (dev tooling). The gate's `tests @zilar/devtools` step passed.
- Acceptance check, dry-run against a **copy** of the real state, never the real file:
  ```
  $ ZILAR_LEAD_STATE=/tmp/t1404-state.json pnpm --filter @zilar/devtools exec tsx src/lead/cli.ts forget --finished --dry-run
  DRY: would forget T-0071, T-0101, T-0102, T-0103, T-0107, T-0110, T-0116, T-0131, T-0136, T-0137, T-0150, T-0151, T-0168, T-0180, T-0185, T-0192, T-0475, T-0478, T-0925, T-1338, T-1365, T-1366, T-1367, T-1368, T-1369, T-1370, T-1371, T-1372, T-1373, T-1374, T-1375, T-1376, T-1377, T-1378, T-1380, T-1381, T-1382, T-1383, T-1387, T-1388, T-1389, T-1390, T-1391, T-1392
  DRY: would remove 44 task(s)
  exit=0
  ```
  The 3 not selected were `T-1399` and `T-1403` (status `review`) and `T-1404` (status `in-progress`), i.e. the live tasks. The copy was `/tmp/t1404-state.json` (47 tasks); the real `~/.zilar-lead/state.json` still had 47 tasks afterward and my commands never pointed at it (`ZILAR_LEAD_STATE` was set on every run; the write test below logged to `/tmp/lead.log`, the copy's directory).
- Explicit path, also on the copy:
  ```
  $ ... forget --dry-run T-1404 T-1399 T-0071
  DRY: T-1404: refused, task status is in-progress
  DRY: T-1399: refused, task status is review
  DRY: T-0071: forgot (status (missing), session idle)
  ```
- Write path, on the copy: `... forget T-0071` printed `T-0071: forgot (status (missing), session idle)`, the copy dropped to 46 tasks (`hasT0071 false`), and `/tmp/lead.log` grew by one line. The copy was then restored from the real file.
- Usage errors: `... forget` and `... forget --finished T-0071` both exit 1 with `lead: usage: lead forget <T-XXXX> [...] | lead forget --finished [--dry-run]`; `... forget --dry-run T-9999` prints `DRY: T-9999: not tracked`.

### Notes / deviations
- I added one refusal the Spec did not name: an unreadable session (`unknown`) is refused for explicit `forget`, because it might be busy and dropping it could hide a live worker. `--finished` already requires `idle`, so an unreadable session is not removed there either.
- `--finished` also logs one line per removed task with `appendLog` (the Spec only required the id-form logging); it is harmless and consistent.
- No dependency added; no test written.

### Blocked / needs a decision
None.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit 2: forget prints its lines before the write; a task forgotten mid-tick can still get that tick's action; both harmless for dev tooling). cli.ts shrank from 415 to 411 lines. The lead runs the real --finished after the merge.
