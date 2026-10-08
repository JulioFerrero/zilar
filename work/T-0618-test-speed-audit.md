---
id: T-0618
title: "Audit: make the server test suite faster and lighter on CPU (measure the baseline; try vitest pool threads vs forks, isolate:false, fileParallelism, maxWorkers, shared PGlite snapshot, test sharding, and whether another runner is worth it); write docs/audit/test-speed.md with measured numbers and a recommended change list; no code changes"
status: todo
milestone: M5
branch: task/T-0618-test-speed-audit
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0618: a faster, lighter test setup (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-08: "find a better way, a newer testing system that is faster and uses less cpu". The `apps/server` suite (152 test files) took 441-741 s per gate run under load. With several workers it saturated the machine: load up to 153, 30 s hook timeouts, SIGKILLed forks.

### Verified facts (do not re-derive)
- `apps/server/package.json:10`: `"test": "vitest run --testTimeout=30000 --hookTimeout=30000"`. Vitest is 5.0.2, and `apps/server` has no vitest config file, so the defaults apply (the pool is `forks`).
- **`apps/server/src/test-support.ts:287-301`:** each test worker migrates one PGlite once, keeps a `dumpDataDir` snapshot, and starts each database from it (`new PGlite({ loadDataDir })`). `createTestContext` is at 304.
- **Workers run with `--maxWorkers=2`** (`packages/devtools/src/gate/plan.ts:48`).

### What to build (an audit only; no change to config, tests or code)
1. **Baseline.** Run the full server suite once with today's command. Record:
   - wall time;
   - user and system CPU time (`/usr/bin/time -l`);
   - peak memory;
   - the 10 slowest files (`--reporter=json` or vitest's duration output).
2. **Experiments.** Pass options on the command line only, never by committing a config. Run each one fully, and record the same numbers and whether every test still passes:
   - `--pool=threads`;
   - `--pool=forks --isolate=false` (and threads with `isolate=false`);
   - `--maxWorkers` of 1, 2 and 4;
   - `--no-file-parallelism` for the PGlite-heavy files, if relevant.
   
   Note which tests break under `isolate=false`, and why.
3. **Ideas, with evidence.** For each, write the expected gain and the cost:
   - sharing one migrated PGlite snapshot across workers (for example a global setup that writes the snapshot to a temp file);
   - lighter setup in the slowest files;
   - `vitest --shard`;
   - whether another runner (for example Bun's test runner, or Node's built-in test runner) would be faster for this codebase given PGlite and Effect.
   
   Read the official docs or release notes for what you claim, and cite them. Do not install anything.
4. **Write `docs/audit/test-speed.md`:** the measurements as a table, the findings, and a ranked list of recommended changes, each with its expected gain and which files it touches. These become the lead's next tasks.

**Run measurements one at a time, in the foreground.** The lead launches this task when no other worker is running tests.

### Read first
`AGENTS.md`, `apps/server/package.json`, `apps/server/src/test-support.ts` (lines 230-340) and `packages/devtools/src/gate/plan.ts`.

### Allowed files
`docs/audit/test-speed.md`, `work/T-0618-test-speed-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/test-speed.md` has real measured numbers for the baseline and every experiment, plus a ranked recommendation list.
- No other file changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
