---
id: T-0774
title: "CI on main stops cancelling: concurrency cancel-in-progress only for pull requests, so a running main check finishes and GitHub keeps just the newest push queued behind it (busy merge days never finished a main run)"
status: todo
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

## Review (written by Claude)
