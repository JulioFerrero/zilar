---
id: T-0860
title: "CI: run the server tests in 3 shards next to a job for the other packages"
status: merged
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

**Changed:** `.github/workflows/ci.yml` only (+24 / -4). `images.yml` is unchanged.

**New job layout.** The `test` job is now a matrix with `fail-fast: false` and `timeout-minutes: 20`. Each leg's display name is `Test (<name>)`. Every leg runs the same install, pnpm setup, Node setup and turbo cache steps as before.

| Leg | Command |
|---|---|
| `server 1/3` | `pnpm --filter @zilar/server exec vitest run --shard=1/3 --testTimeout=30000 --hookTimeout=30000` |
| `server 2/3` | same, `--shard=2/3` |
| `server 3/3` | same, `--shard=3/3` |
| `rest` | `pnpm exec turbo test --filter='!@zilar/server'` |

- The turbo cache key now includes the matrix `id` (`server-1`, `rest`, ...). Without it the parallel legs would share one cache entry. The shard legs never touch turbo, so their cache step is a no-op. I kept it because the spec asks for the same cache steps.
- The workflow name stays `CI`, so `images.yml` is unchanged. Its `workflow_run: workflows: [CI], types: [completed]` fires once per CI run, after all legs finish. Its conclusion is `success` only when every leg passes, so a failing shard blocks the image build and deploy exactly as a failing `Test` job did.
- No branch protection (`gh api .../branches/main/protection` returns 404) and no rulesets, so no required-check name depends on `Test`.

**Checks run:**
- `pnpm exec prettier --write .github/workflows/ci.yml`: unchanged. `prettier --check` on both workflow files passes.
- `pnpm exec oxlint .github/workflows/ci.yml`: "No files found to lint", because oxlint does not lint YAML. `pnpm lint` (root oxlint .) ran without reported errors.
- Both workflow files parse as YAML with the `yaml` package bundled in the workspace. Job lists are `static,typecheck,test,build` for CI and `tip,build,deploy` for images.
- No local test run, as the Checks section asks. The first CI run on main is the check.
- `pnpm install --frozen-lockfile` ran in the worktree, which had no `node_modules`.

**Facts that differ from the spec:**
- The old `test` job was at `ci.yml:71-96` (`pnpm test` at line 96), not 75-92.
- `apps/server/src` has 162 `*.test.ts` files, which matches the audit.
- The Acceptance section says to run the tests 3 times, but the Checks section says no local test run. I followed Checks.

**Not measured:** shard file counts and timings. Nothing was run locally, so the wall-time gain is unverified until the first CI run on main.

**Unsure:** whether turbo honours `--filter='!@zilar/server'` without a `--` separator. It should, but the first CI run on main will show it.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** CI runs the server tests in 3 shards, next to a job for the other packages. The first CI run on main after the merge is the real check, and the lead watches it.
