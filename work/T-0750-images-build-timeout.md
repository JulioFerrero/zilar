---
id: T-0750
title: "images.yml: timeout-minutes on the jobs, so a stalled multi-arch build fails instead of holding the publish-main concurrency group for hours (run 37911863834 hung 3h18m in 'Build and push zilar-server (green main)' and blocked every later deploy)"
status: merged
milestone: M5
branch: task/T-0750-images-build-timeout
model: auto
effort: low
depends_on: []
estimate: 0.02 day
---

# T-0750: build timeouts in the images workflow

## Spec (written by Claude, do not edit)

### Why
On 2026-10-09, images run 37911863834 stuck in step 11, "Build and push zilar-server (green main)" (amd64 + arm64 buildx), from 09:33 to 12:51 UTC, when the lead force-cancelled it. The smoke step before it had passed in 52 s. The workflow-level `publish-main` concurrency group (`cancel-in-progress: false`) made every later images run wait behind it, so no deploy was possible.

### Verified facts (do not re-derive)
- `.github/workflows/images.yml` has no `timeout-minutes` anywhere, so GitHub's 6-hour default applies.
- **The jobs:** `tip` (line 27, "Check main tip"), `build` (line 49, the matrix) and `deploy` (line 229).
- **Normal timings:** a full server build with the smoke step takes about 5 to 6 minutes (run 37907682455). The deploy job polls `/health` for up to 10 minutes (`docs/RELEASING.md` §9).

### What to build
Add `timeout-minutes`:
- `tip`: 5;
- `build`: 30;
- `deploy`: 20.

Each gets a one-line comment above it naming this incident. Nothing else changes.

### Read first
`AGENTS.md`, `.github/workflows/images.yml`.

### Allowed files
`.github/workflows/images.yml`, `work/T-0750-images-build-timeout.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The three jobs have `timeout-minutes` set to 5, 30 and 20.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did.** Added `timeout-minutes` to the three jobs in `.github/workflows/images.yml`, each with a one-line comment above it naming incident T-0750: `tip` 5 (line 31), `build` 30 (line 55), `deploy` 20 (line 237). Nothing else in the file changed.

**Files changed.** `.github/workflows/images.yml` (+6 lines), `work/T-0750-images-build-timeout.md` (status and this Report).

**Commands run.**
- `pnpm install`: done, no errors.
- `pnpm exec prettier --write .github/workflows/images.yml`: unchanged.
- `pnpm gate`: GATE PASS. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (17.1s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (1.1s)`
  - `scope: every changed file is inside the Allowed files`
- Single tests: none. The change touches no package code, so the gate ran no nearest tests.

**Not verified.** I did not run the workflow on GitHub, and I did not parse the YAML separately. The gate's lint step passed, but I cannot say it checks workflow syntax.

**Deviations.** None from the spec.

**Open questions.** None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 1 min). It adds job-level `timeout-minutes` (tip 5, build 30, deploy 20), each with a comment, and the gate passed. GitHub validates the syntax on the next images run, and the lead checks that run.
