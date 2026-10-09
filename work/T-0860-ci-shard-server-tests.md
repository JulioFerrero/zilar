---
id: T-0860
title: "CI: run the server tests in 3 shards next to a job for the other packages"
status: todo
milestone: M5
branch: task/T-0860-ci-shard-server-tests
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0860: CI: run the server tests in 3 shards next to a job for the other packages

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding H-F1 in `docs/audit/simplify-2026-10-09/H-tooling.md`.
- **Where the time goes:** the CI `Test` job (`.github/workflows/ci.yml:75-92`) runs `pnpm test` for all packages in one job. Server tests take 644 of its 682 s, so the whole CI run lasts 11.4 min.
- **The fix:** vitest supports `--shard=i/n`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Split the `Test` job into a matrix:
- `server 1/3`, `server 2/3` and `server 3/3`, each running `pnpm --filter @zilar/server exec vitest run --shard=i/3` with the package's test flags;
- one `rest` job running every other package's tests through turbo with `--filter=!@zilar/server`.

Set `fail-fast: false`. Keep the same install, cache and Node setup steps as today. If a required-check name is referenced elsewhere (branch protection, or `images.yml` waiting for "CI"), keep the workflow name and make sure the images workflow still triggers on a green CI. Read `images.yml`'s `workflow_run` trigger.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`.github/workflows/ci.yml`, `work/T-0860-ci-shard-server-tests.md`.

### Checks (wave mode)
```bash
# No local test run: re-read ci.yml and images.yml twice. The first CI run on main after the merge is the check (the lead watches it).
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: The lead checks the first CI run on main after the merge.

---

## Report (written by the worker when done)

## Review (written by Claude)
