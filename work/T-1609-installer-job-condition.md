---
id: T-1609
title: "images.yml installer job was skipped on v0.2.1: a job whose ancestors include a skipped job (tip) is skipped unless its if uses a status function; use !cancelled() && needs.build.result == 'success' && a v* tag"
status: merged
milestone: M5
branch: task/T-1609-installer-job-condition
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1609: Make the installer job actually run on a tag

## Spec (written by Claude, do not edit)

### Why
- **What happened:** on the v0.2.1 tag push, "Production images" run 38812219602 built all six images, but the job "Attach the installer to the release" (T-1607) shows `skipped`.
- **The cause:** GitHub Actions skips a job when any job up its `needs` chain was skipped, unless its `if` includes a status function. `tip` is always skipped on a tag push. `build` runs anyway, because its `if` starts with `always()`, but `installer` only checks the ref.
- **Recovered by hand:** the lead uploaded `install.sh` from the v0.2.1 tag to the release by hand.

### Facts (the lead read them on 2026-10-16, main `df3471bf3`)
- `.github/workflows/images.yml:62`: `build` has `needs: [tip]`, and `:67` has `if: always() && (…)`.
- `.github/workflows/images.yml:319-325`: `installer:` with `needs: [build]` and `if: startsWith(github.ref, 'refs/tags/v')` (`:324`).

### Steps
1. Change the `installer` job's `if` to:
   ```yaml
   if: ${{ !cancelled() && needs.build.result == 'success' && startsWith(github.ref, 'refs/tags/v') }}
   ```
   Add a one-line comment: `tip` is skipped on tags, so the job needs a status function (v0.2.1 was skipped).
2. **Change nothing else.**

### Tests
None. The lead checks it on the next tag.

### Allowed files
- `.github/workflows/images.yml`
- `work/T-1609-installer-job-condition.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The diff is the `if` line and its comment only.**

---

## Report (written by the worker when done)

### What I did
- Changed the `installer` job's `if` in `.github/workflows/images.yml` (was line 324) from
  `if: startsWith(github.ref, 'refs/tags/v')` to
  `if: ${{ !cancelled() && needs.build.result == 'success' && startsWith(github.ref, 'refs/tags/v') }}`,
  and added the one-line comment above it:
  `# `tip` is skipped on tags, so the job needs a status function (v0.2.1 was skipped).`
- Nothing else changed. `git diff` shows only the `if` line, its comment, and the task file's front matter.

### Checks run
- `pnpm install`: Done in 10.1s using pnpm v10.32.1 (no errors).
- `pnpm gate` (repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.7s)
  PASS  lint  (1.5s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the task says tests are none and the change is workflow-only.

### Notes for the lead
- The comment sits directly above the `if` line, matching the existing comment style in this workflow (e.g. the `build` job's comment above its `if` at lines 63-66).
- `needs.build.result == 'success'` keeps the installer from running when the build matrix fails, and `!cancelled()` is the status function that stops GitHub from skipping the job because `tip` was skipped on the tag push.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **The diff** is the one `if` line plus its comment: `!cancelled() && needs.build.result == 'success' && startsWith(github.ref, 'refs/tags/v')`.
- **v0.2.1's missing asset was fixed by hand:** the lead uploaded `install.sh` from the v0.2.1 tag to the release. `releases/latest/download/install.sh` then served the same SHA-256 as `git show v0.2.1:deploy/install.sh`.
- **The real check is the next tag** (v0.2.2, for T-1610): the "Attach the installer to the release" job must run, not be skipped.
