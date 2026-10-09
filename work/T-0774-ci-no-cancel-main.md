---
id: T-0774
title: "CI on main stops cancelling: concurrency cancel-in-progress only for pull requests, so a running main check finishes and GitHub keeps just the newest push queued behind it (busy merge days never finished a main run)"
status: merged
milestone: M5
branch: task/T-0774-ci-no-cancel-main
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0774: a running CI on main always finishes

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09 the lead merged a task every few minutes. Every merge cancelled the running CI, the test job needs about 10 minutes, and main went more than an hour with no finished run: runs `a7abe70f`, `d0c8496e`, `09b3e6e9` and `272d108f` were all cancelled. Without a cancel, GitHub lets the running job finish and keeps only the **newest** pending run in a concurrency group (older pending runs are replaced), so main gets a verified commit at least every ~10 minutes.

### Verified facts (do not re-derive)
- **`.github/workflows/ci.yml:15-18`:** a comment line, then `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
- **The images workflow** (`.github/workflows/images.yml`, the `tip` job) builds only when the finished CI run's sha is the last commit on main that changed code (T-0755). A finished CI on an older commit is skipped there, so this change cannot deploy a stale commit.

### What to build
1. **In `.github/workflows/ci.yml`:** set `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
2. **Replace the comment above the block** with two lines explaining that pull requests cancel stale runs, while on main the running check finishes and GitHub keeps only the newest pending run, citing this incident.

Change nothing else.

### Read first
`AGENTS.md`, `.github/workflows/ci.yml`.

### Allowed files
`.github/workflows/ci.yml`, `work/T-0774-ci-no-cancel-main.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The concurrency block is as above.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `.github/workflows/ci.yml`: the concurrency block now reads `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. The two-line comment above it replaces the old one and explains that pull requests cancel stale runs while main lets the running check finish, citing the 2026-10-09 incident. The `group` line is unchanged.
- Nothing else in the workflow changed.

**Files changed**
- `.github/workflows/ci.yml`
- `work/T-0774-ci-no-cancel-main.md` (status and this Report)

**Commands run**
- `pnpm install`: completed (Done in 15s).
- `pnpm exec prettier --write .github/workflows/ci.yml`: unchanged (prettier parsed the YAML).
- `pnpm gate` from `/Users/julio/personal-projects/zilar-T-0774`: GATE PASS. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems / deviations**
- None. No single tests were run: the task's Checks list only `pnpm gate`. The gate output has no test step; it only ran install, format, lint and typecheck, and skipped the effect check because no source files changed.
- I did not push or trigger any workflow, so the new concurrency behaviour is not exercised on GitHub yet.

**Blocked / needs a decision**
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly: `cancel-in-progress` now applies only to pull requests, with the comment as specified. The gate passed.
