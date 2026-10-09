---
id: T-0754
title: "CI faster: ci.yml skips docs-only pushes (paths-ignore work/**, docs/**, **/*.md), splits the single job into parallel jobs (format+lint, typecheck, test, build) with a restored Turborepo cache, so a code push to main verifies in ~5 min instead of ~15 and lead board commits stop cancelling CI"
status: merged
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

### What I did
- `.github/workflows/ci.yml` only:
  - `on.push` keeps `branches: [main]` and adds `paths-ignore: ['work/**', 'docs/**', '**/*.md']`; `pull_request` unchanged.
  - The single `checks` job is replaced by four parallel jobs, each `timeout-minutes: 20`, each with checkout, pnpm/action-setup@v6, setup-node@v7 (`.nvmrc`, `cache: pnpm`) and `pnpm install --frozen-lockfile`:
    - `static`: `pnpm format:check`, `pnpm lint`;
    - `typecheck`: cache step, `pnpm typecheck`;
    - `test`: cache step, `pnpm test`;
    - `build`: cache step, `pnpm build`.
  - Cache step in the three jobs: `actions/cache@v6`, path `.turbo/cache`, key `turbo-${{ runner.os }}-${{ github.job }}-${{ github.sha }}`, restore-keys `turbo-${{ runner.os }}-${{ github.job }}-`. No remote cache, no secrets.
  - Workflow `name: CI` unchanged. `concurrency` block unchanged.
  - Header comment block at the top with the measured numbers (21 of 30 cancelled, 15 min average, 11 to 17).
- Checked `.github/workflows/images.yml`: it listens for `workflows: [CI]` (line 10), so the name is unchanged.
- Read the Turborepo cache location from the public docs (turborepo.dev/docs/reference/configuration): the documented default `cacheDir` is `.turbo/cache`. `.turbo/` is already in `.gitignore` (line 9).
- Checked the latest `actions/cache` release (github.com/actions/cache/releases/latest): v6.1.0, so `@v6`.
- Did not push, trigger workflows, or change GitHub settings.

### Commands run (real results)
- `pnpm install --frozen-lockfile`: done (turbo 2.11.4, typescript 7.0.2, vitest 5.0.2).
- `pnpm exec prettier --write .github/workflows/ci.yml`: unchanged.
- YAML parse with the `yaml@2.9.1` package already in `node_modules` (via `node`): parses; `name: CI`; push filter as specified; jobs `static`, `typecheck`, `test`, `build` with the steps above.
- `command -v actionlint`: not installed, so not run (not installed, per the instruction).
- `pnpm gate` (from `/Users/julio/personal-projects/zilar-T-0754`, exit 0). Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (17.5s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (2.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No single test was run: the change touches no package code, and the gate ran no tests (no test step in its output).

### Deviations and open points
- The Turborepo docs page I fetched carries no version, so `.turbo/cache` is confirmed as the default for the docs in general, not specifically for 2.11.4. The task says `.turbo/cache`; I used it.
- The workflow is not run on GitHub here. The lead checks the first real run.
- Merge order: this task depends on T-0755 (images tip check). Until T-0755 lands, a docs-only commit on top of a code commit would not publish via images.yml, as the spec notes.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **What changed:** pushes touching only docs (`work/**`, `docs/**`, `**/*.md`) no longer start CI, and the single job is now four parallel jobs (static, typecheck, test, build). The last three restore the Turborepo cache from `.turbo/cache` (the turbo 2 default), keyed per job and per sha.
- **Kept as before:** the workflow name `CI` (the images workflow listens for it) and the concurrency block.
- **Merge order:** after T-0755, whose image-build check finds the last commit that changed code, so a docs-only commit does not leave main unbuilt.
- **To check:** the first real run on main, which should show cache hits from the second run on.
