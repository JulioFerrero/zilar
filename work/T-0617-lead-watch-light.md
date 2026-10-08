---
id: T-0617
title: "lead watch: far fewer processes per refresh (today about six spawns per active task every 3 s: two git calls, up to three opencode2 message lists of the same session, and the changed-file git calls); fetch each session's messages once per refresh, slow the refresh, cache git results by HEAD; same screen"
status: todo
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

## Review (written by Claude)
