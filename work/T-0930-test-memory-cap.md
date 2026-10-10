---
id: T-0930
title: "Test memory: cap the web vmThreads pool (memory limit, worker count) and the lead's combined check, measured peak footprint before and after"
status: todo
milestone: M5
branch: task/T-0930-test-memory-cap
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0930: Cap test memory

## Spec (written by Claude, do not edit)

### Why
On 2026-10-10 at 15:05 the machine (18 GB RAM, 11 CPUs) reached load 273. The lead measured it with `top`:
- 203 MB free, 8.2 GB in the compressor, 2.9 GB of 4 GB swap used, and `kernel_task` at 257% CPU;
- the lead's combined check (`lead batch check`, in the `zilar-wave` worktree) held:
  - **the web vitest main process at 7.5 → 9.2 GB**, growing during the run;
  - about 10 server vitest workers at 550-760 MB each;
- the idle Android emulator held 5.9 GB. The lead has stopped it.

The causes in the code:
- `apps/web/vite.config.ts:36` sets `pool: 'vmThreads'`, so every web worker is a thread inside the one main process. There is no memory limit and no worker cap. The Vitest docs warn that vm pools can leak memory and offer a memory limit that recycles a worker.
- Neither `apps/web` nor `apps/server` sets `maxWorkers`, so each defaults to about one worker per CPU. Server tests run as `vitest run --testTimeout=30000 --hookTimeout=30000` (`apps/server/package.json:12`).
- `packages/devtools/src/lead/batch.ts:486-488` runs the package suites 2 at a time (`runPool(..., 2, ...)`), without `--maxWorkers`. The web and server suites can therefore run together, with about 20 workers.

### What to build
1. **Measure first,** with nothing else heavy running (check `uptime`), and write the numbers in the Report:
   - `/usr/bin/time -l pnpm --filter @zilar/web exec vitest run --reporter=dot` gives the peak memory footprint, the wall time and the test count;
   - the same for `@zilar/server`.
2. **Web:** in `apps/web/vite.config.ts`, add the Vitest 5 option that caps vm-pool memory, so a worker is recycled above a limit (check the installed Vitest's docs or types under `node_modules/vitest` for the exact name), plus a `maxWorkers` cap. Pick values from measurement: the lowest peak with a wall time no more than about 15% slower. Report 2 or 3 tried settings.
3. **Server:** if a `maxWorkers` cap in `apps/server/vitest.config.ts` (or wherever the server's test config lives) lowers the peak at a similar wall time, add it; otherwise leave the server alone and say so.
4. **Combined check:** in `packages/devtools/src/lead/batch.ts`, pass `--maxWorkers=<n>` to each package's vitest run, so two packages at once stay under about 8 GB together. Keep `runPool(..., 2)`, unless measurement shows that running one at a time is no slower. Update `packages/devtools/src/lead/batch.test.ts`, the test at `:278-282` that checks the vitest args.
5. **Same tests:** the test counts stay the same, and no test is weakened.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `apps/web/vite.config.ts`, `apps/server/package.json`, the server's vitest config, `packages/devtools/src/lead/batch.ts:470-525` and `packages/devtools/src/lead/batch.test.ts`.

### Allowed files
`apps/web/vite.config.ts`, `apps/server/vitest.config.ts`, `apps/server/package.json`, `packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch.test.ts`, `work/T-0930-test-memory-cap.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/devtools exec vitest run --reporter=dot src/lead/batch.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/devtools typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- The Report gives:
  - the before and after peak footprint, wall time and test count for web and server;
  - the settings tried;
  - the `--maxWorkers` value the check now passes.
- Only the Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
