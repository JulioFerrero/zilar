---
id: T-0754
title: "CI faster: ci.yml skips docs-only pushes (paths-ignore work/**, docs/**, **/*.md), splits the single job into parallel jobs (format+lint, typecheck, test, build) with a restored Turborepo cache, so a code push to main verifies in ~5 min instead of ~15 and lead board commits stop cancelling CI"
status: todo
milestone: M5
branch: task/T-0754-ci-faster
model: auto
effort: default
depends_on: [T-0755]
estimate: 0.2 day
---

# T-0754: faster CI

## Spec (written by Claude, do not edit)

### Why
Measured on 2026-10-09:
- **Cancellations:** 21 of the last 30 CI runs on `main` were cancelled. Every push restarts CI (`concurrency` `cancel-in-progress: true`, `.github/workflows/ci.yml:8-11`), including the lead's `work/` board and status commits, which change no code.
- **Duration:** green runs take 15 min on average (11 to 17).

The images workflow runs after CI, so the time from a merge to a deploy is CI plus the images.

### Verified facts (do not re-derive)
- **`.github/workflows/ci.yml`:**
  - the trigger is `on: push: branches: [main]` plus `pull_request:` (lines 3-6);
  - one job, `checks`, runs `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` and `build` in sequence (lines 17-37), with `timeout-minutes: 30`.
- **Root scripts:** `typecheck`, `test` and `build` are `turbo typecheck`, `turbo test` and `turbo build` (`package.json:12-17`); `turbo` is at `^2.11.4` (line 36).
- **`turbo.json`** caches `build` (outputs `dist/**`), `typecheck` and `test`, with no outputs.
- **The images workflow** listens for a successful CI run (`workflow_run`). T-0755 changes its tip check so a docs-only commit on top no longer blocks the build; **this task merges after T-0755**.

### What to build
1. **Docs-only skip:** under `on.push` add `paths-ignore: ['work/**', 'docs/**', '**/*.md']`, and keep `branches: [main]`. Leave `pull_request` as it is.
2. **Parallel jobs.** Replace `checks` with four jobs that run in parallel, each with `timeout-minutes: 20` and the same setup steps (checkout, pnpm, node with `cache: pnpm`, install):
   - `static`: `pnpm format:check` and `pnpm lint`;
   - `typecheck`: `pnpm typecheck`;
   - `test`: `pnpm test`;
   - `build`: `pnpm build`.

   Keep the workflow `name: CI`; the images workflow listens for the workflow name and needs the whole run to succeed. Check in `.github/workflows/images.yml` which name it listens for.
3. **Turborepo cache:** in the typecheck, test and build jobs, restore and save the local Turborepo cache with `actions/cache`. Use the path from turbo 2's documented local cache directory (check the docs for 2.x: `.turbo/cache`), the key `turbo-${{ runner.os }}-${{ github.job }}-${{ github.sha }}` and the restore key `turbo-${{ runner.os }}-${{ github.job }}-`, so packages that did not change are cache hits. Do not use the remote cache, and add no secrets.
4. **A comment block at the top** explaining the docs-only skip and the job split, citing the measured numbers above.

### Read first
`AGENTS.md`, `.github/workflows/ci.yml`, `.github/workflows/images.yml` (lines 1-50), `turbo.json`, `package.json`.

### Allowed files
`.github/workflows/ci.yml`, `work/T-0754-ci-faster.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `ci.yml` has the docs-only skip, the four parallel jobs and the cache steps.
- The workflow name is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks the first real run on GitHub.

---

## Report (written by the worker when done)

## Review (written by Claude)
