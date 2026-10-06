---
id: T-0289
title: "CI: a newer push to main cancels the older in-progress CI run, so the tip gets verified (and auto-deployed) sooner"
status: merged
milestone: M5
branch: task/T-0289-ci-cancel-superseded
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0289: cancel superseded CI runs on main

## Spec (written by Claude, do not edit)

### Why
The lead merges often during the night, and each push to main starts a full CI run. At 00:26 UTC on 2026-10-06, `gh run list --workflow ci.yml --branch main` showed 9 runs in progress at once, each taking 9-14 minutes.

T-0260's images workflow (`.github/workflows/images.yml`) only builds and deploys when the CI run that finished is for the **tip** of main (the `tip` job). So while merges keep coming, every finished run is already stale and nothing gets built: every images run so far ended with `Build production images=skipped`. Cancelling the older runs frees runners, so the tip's run finishes sooner.

### Verified facts (do not re-derive)
- `.github/workflows/ci.yml`:
  - triggers on `push` to `main` and on `pull_request` (lines 3-6);
  - one job, `checks`, with `timeout-minutes: 30`;
  - no `concurrency` key.
- `.github/workflows/images.yml`:
  - the `tip` job (line 30) and the `build` job (line 57) run only when `github.event.workflow_run.conclusion == 'success'`;
  - so a cancelled CI run (conclusion `cancelled`) builds nothing, which is correct.

### What to build
1. In `.github/workflows/ci.yml`, add a workflow-level `concurrency`:
   - group per ref: `ci-${{ github.ref }}`; for PRs, `github.ref` is the PR merge ref, so each PR gets its own group;
   - `cancel-in-progress: true`, for pushes to main and for PRs alike;
   - add a one-line comment saying why (the tip matters, older runs are superseded).
2. In `docs/RELEASING.md`, in the auto-deploy section T-0260 added, add one sentence: older main CI runs are cancelled when a newer push arrives, and only a green run on the tip builds and deploys.

### Read first
`AGENTS.md`, `.github/workflows/ci.yml`, `.github/workflows/images.yml`, `docs/RELEASING.md` (the auto-deploy section).

### Allowed files
`.github/workflows/ci.yml`, `docs/RELEASING.md`, `work/T-0289-ci-cancel-superseded.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `ci.yml` has the concurrency block. The YAML parses: the gate's format step runs Prettier on it.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `.github/workflows/ci.yml`: added a workflow-level `concurrency` block after the `on:` triggers:
  - `group: ci-${{ github.ref }}` — one group per ref, so each PR merge ref gets its own group and pushes to `main` share one;
  - `cancel-in-progress: true` — a newer push cancels the older in-progress run;
  - a one-line comment saying a newer push to `main` makes older runs stale, so cancel them and verify the tip sooner.
- `docs/RELEASING.md`: added one sentence to the §9 auto-deploy paragraph. It states that the CI `ci-${{ github.ref }}` concurrency group with `cancel-in-progress: true` cancels an older `main` run as soon as a newer push arrives, so only a green run on the tip builds and deploys.

**Files changed**
- `.github/workflows/ci.yml`
- `docs/RELEASING.md`
- `work/T-0289-ci-cancel-superseded.md`

**Commands and results**
- `pnpm install`: exit 0, 13 workspace projects, 1170 packages added, 17.6s.
- `pnpm gate` (once, from the repo root): exit 0, summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (24.1s)
  PASS  lint  (1.5s)
  PASS  typecheck  (1.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No package tests ran because no package was touched (the changed files are a workflow, docs and this task file). I ran no single test file; there is no code under test in this task.

**Deviations from the spec**
- None.

**Security checklist**
- Not applicable: no secrets, routes, database writes, deletes or audit entries are involved.

**Blocked / needs a decision**
- None.

## Review (written by Claude)

Approved. Clean pre-review, no fix rounds.

**What changed:**
- `ci.yml` gets `concurrency: ci-${{ github.ref }}` with `cancel-in-progress: true`, and a one-line why.
- `RELEASING.md` gets one sentence on it.

**Why it is safe:** a cancelled run has conclusion `cancelled`, and `images.yml` only builds on `success`.
