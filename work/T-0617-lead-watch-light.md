---
id: T-0617
title: "lead watch: far fewer processes per refresh (today about six spawns per active task every 3 s: two git calls, up to three opencode2 message lists of the same session, and the changed-file git calls); fetch each session's messages once per refresh, slow the refresh, cache git results by HEAD; same screen"
status: merged
milestone: M5
branch: task/T-0617-lead-watch-light
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0617: a light `lead watch`

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-08: "make so the lead watch is performant". With about ten active tasks, the watch window (`pnpm lead:watch`) used around 17% CPU, and each `opencode2` process it starts used around 30% CPU while it ran.

### Verified facts (do not re-derive; read the files)
- **`packages/devtools/src/lead/watch.ts:19`:** `REFRESH_INTERVAL_MS = 3_000`. `watch-app.tsx:713` runs `setInterval(refresh, REFRESH_INTERVAL_MS)`.
- **One refresh is `buildView`** (`watch.ts:514-585`):
  - `collectSnapshot` (`packages/devtools/src/lead/collect-snapshot.ts`) runs, per task, `git log -1` (46) and `git rev-list --count` (52), `client.listMessages(record.sessionId, 30)` (80), and for a pre-review `client.listMessages(prereview.sessionId, 5)` (92), plus one root git call (197);
  - then, per active task, `collectFiles(runner, worktree, …)` (git calls, `watch.ts:468-500`), and for a running task `client.listMessages(sessionId, 20)` **again** (558).
- Every `client` call spawns the `opencode2` CLI with `spawnSync` (`packages/devtools/src/lead/client.ts:105,152`).

### What to build
1. **One message list per session per refresh.** Reuse the `listMessages` result from `collectSnapshot` in `buildView`, through a per-refresh cache keyed by session id with the larger limit, instead of fetching the same session twice.
2. **Skip git work when nothing changed.** Cache `collectFiles` and the two per-task git results by the worktree's `HEAD` commit plus the `git status --porcelain` output. If running `git status` costs as much as the calls it saves, read `.git/HEAD` and the index mtime instead; say in the Report which you chose and why.
3. **Raise `REFRESH_INTERVAL_MS` to 10 000.** The clock line keeps its own timer.
4. **Measure** the number of child processes per refresh before and after, with about ten tasks in `~/.zilar-lead/state.json` (read-only; for example, count `spawnSync` calls with a test double in a unit test). Put both numbers in the Report.
5. **Honest speed.** `sessionSpeed` (`watch.ts:251-293`) shows `totalOut / totalDur` over the last 20 steps, so one step that waited an hour on a tool (a hung gate) made the watch show 5 tok/s while the model ran at 30-200 tok/s (lead-measured on T-0608, 2026-10-08). Show the **median** of the per-step tok/s values (the same values as the sparkline) instead.
6. **Tests:** existing watch tests stay green; change only assertions that pinned the old interval, call counts or the old average, and list them. Add one test proving a session's messages are fetched once per refresh, and one proving a single very long step does not drag the shown speed down.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/collect-snapshot.ts`, `packages/devtools/src/lead/watch-app.tsx` (lines 690-735) and `packages/devtools/src/lead/client.ts` (lines 90-170 and 260-280).

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/collect-snapshot.ts`, `packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch.test.ts`, `packages/devtools/src/lead/watch-app.test.tsx`, `packages/devtools/src/lead/collect-snapshot.test.ts`, `work/T-0617-lead-watch-light.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch src/lead/collect-snapshot
pnpm gate
```

### Acceptance
- A refresh fetches each session once, skips unchanged git work, and runs every 10 s, with the same screen.
- The before and after process counts are in the Report.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **One message list per session per refresh.** Added a per-refresh `MessageCache`
  (session id → `{ messages, limit }`) in `collect-snapshot.ts` and a
  `listSessionMessages` helper. `buildView` creates the cache, passes it to
  `collectSnapshot`, and reuses it for the live step/speed read instead of
  spawning `opencode2` a second time for a session already listed. The
  pre-review fetch was raised from 5 to 20 so the one stored list also covers
  `buildView`'s 20-message read (the spec's "larger limit"); `summarizeSession`
  only reads the newest message, so its state is unchanged.
- **Skip unchanged git work.** Added `readWorktreeGit` + a `GitCache` in
  `collect-snapshot.ts`; `collectSnapshot` fills it and `buildView`/`collectFiles`
  read from it. The key is the worktree's `HEAD` plus the `git status --porcelain`
  output; on a hit no `git log`, `git rev-list`, `git merge-base` or `git diff`
  runs. The cache is persisted to `watch-cache.json` next to the state file
  (validated with Effect `Schema`), because the watcher spawns a fresh `--data`
  process on every refresh and an in-memory cache alone would reset. `collectFiles`
  gained an optional cached-snapshot argument; `lead snapshot` (no cache) keeps
  its old, smaller set of git calls.
- **Interval 3 s → 10 s.** `REFRESH_INTERVAL_MS = 10_000`; the clock keeps its
  own 1 s timer. The screen is unchanged.
- **Honest speed.** `sessionSpeed` now returns the median of the last 10 per-step
  tok/s values (exactly the sparkline values) instead of `totalOut / totalDur`,
  so a single step that waited on a hung tool no longer drags the shown speed down.

### Decision: HEAD + `git status --porcelain`, not `.git/HEAD` + index mtime

I chose the `git status --porcelain` key. (a) The tasks run in linked worktrees,
where `.git` is a **file** pointing at the real gitdir, so `.git/HEAD` cannot be
read directly. (b) New untracked files (the common `created` case) do not change
the index mtime, so an index-mtime key would keep showing a stale changed-files
line. `git status --porcelain` reflects tracked and untracked changes, so a cache
hit is safe. Cost: one `git status` (plus one `git rev-parse` for HEAD) always
runs, but it replaces up to six git calls.

### Before / after: child processes per refresh

Measured with a test double (counting `runner.run` git calls + `client.listMessages`
= `spawnSync` child processes), 10 synthetic tasks that each have a worker session,
a pre-review session and a running session:

| | git calls | opencode2 calls | total per refresh |
|---|---|---|---|
| before (old code, computed from the file) | 60 + 1 root = 61 | 30 | 91 |
| after, cold cache | 60 + 1 root = 61 | 20 | 81 |
| after, unchanged worktree (warm cache) | 20 + 1 root = 21 | 20 | 41 |

The "before" number is computed from the code I read (each task: `rev-parse`,
`log`, `rev-list` in the snapshot, `merge-base`, `diff`, `status` for the files,
plus three `listMessages`); the "after" numbers are measured. In the steady state
(HEAD and status unchanged) this is 91 → 41, i.e. 55% fewer child processes per
refresh, and with the 3 s → 10 s interval that is roughly 1820 → 246 per minute.
Per task: git 6 → 2, opencode2 3 → 2. The `--data` node process itself is still
one per refresh (I did not change the spawn model).

### Files changed

`packages/devtools/src/lead/collect-snapshot.ts`, `watch.ts`, `watch.test.ts`,
`collect-snapshot.test.ts`, and this task file. All inside the Allowed files.

### Tests

- Kept green: no test pinned the interval or the call counts. `watch-app.test.tsx`
  imports `REFRESH_INTERVAL_MS` but never asserts its value.
- Renamed one test: `"computes averages over four completed assistant steps"` →
  `"computes the median step speed over four completed assistant steps"`. No
  assertion value changed: four identical steps have the same mean and median
  (400/24).
- Added: (1) `buildView` fetches a session's messages once per refresh
  (`listed == [{ sessionId, limit: 30 }]`) and reuses them for the live step;
  (2) one very long step does not drag the speed down (median 200 vs average 161);
  (3) `readWorktreeGit` reuses the cache (6 git calls → 2) and recomputes when the
  status changes; (4) the git cache file round-trips and bad/missing files yield
  an empty cache.

### Commands

- `pnpm install` → done, 1173 packages added/reused.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch src/lead/collect-snapshot`
  → Test Files 4 passed (4), Tests 132 passed (132).
- `pnpm gate` first failed on `format` (2 files); I ran
  `pnpm exec prettier --write packages/devtools/src/lead/collect-snapshot.ts packages/devtools/src/lead/watch.ts`
  and re-ran the gate, which passed.
- `pnpm gate` → `GATE PASS`:
  - `PASS install (frozen) (1.0s)`, `PASS format (13.4s)`, `PASS lint (0.9s)`,
    `PASS typecheck (3.2s)`, `PASS tests @zilar/devtools (1.1s)`
  - `gate: 5 changed file(s) against main`
  - `scope: every changed file is inside the Allowed files`

### Deviations / open questions

- I added a persisted git cache file (`~/.zilar-lead/watch-cache.json`) rather
  than an in-memory map, because a fresh `--data` process per refresh would
  otherwise never hit the cache. If you would rather not write a cache file, the
  alternative is to change the watcher to a long-lived child process (out of this
  task's scope).
- `readWorktreeGit` spends one `git status` even on a hit; I judged that cheaper
  than the calls it saves and safer than the index-mtime key (see above).

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 3 nits. The packet (22:37) is newer than HEAD 3aa0a5ec.
- **Lead check:**
  - the refresh is 10 s;
  - each session is fetched once per refresh, and git results are cached by HEAD and status;
  - measured: 91 to 41 child processes per refresh with a warm cache, about 1820 to 246 a minute;
  - tok/s is now the median of the per-step values;
  - the gate passes.
- **Possible follow-up:** the `--data` node process is still spawned once per refresh; moving it in-process would save the rest.
