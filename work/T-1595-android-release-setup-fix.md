---
id: T-1595
title: "Android release workflow: setup-android installs only platform-tools (packages: 'platform-tools'), because the runner's cmdline-tools 16.0 has no 'tools' package and the v0.2.0 release run failed there; keep the license log quiet"
status: merged
milestone: M5
branch: task/T-1595-android-release-setup-fix
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1595: Fix the Android release setup step

## Spec (written by Claude, do not edit)

### Why
- **What failed:** the `v0.2.0` tag's "Android release" run (GitHub run 38788684166, 2026-10-15) failed at `android-actions/setup-android@v3`. sdkmanager printed "Warning: Failed to find package 'tools'" and exited 1 (`/usr/local/lib/android/sdk/cmdline-tools/16.0/bin/sdkmanager`), so no APKs were built.
- **Why:** the runner image now ships cmdline-tools 16.0, which no longer has the old `tools` package.
- **The six v0.2.0 images were not affected;** they built fine.

### Facts (the lead read them on 2026-10-15)
- **`.github/workflows/android-release.yml:52`:** `- uses: android-actions/setup-android@v3`, with no `with:`.
- **The action's inputs** (`android-actions/setup-android` `v3` `action.yml`):
  - `packages`: "Additional packages to install", default `'tools platform-tools'`;
  - `log-accepted-android-sdk-licenses`: default `'true'`;
  - `cmdline-tools-version` and `accept-android-sdk-licenses`.
- **Re-running for the existing tag:** the workflow has `workflow_dispatch` with a `tag` input (`:6-11`) and checks out that tag (`:44-47`). After this merges, the lead runs it on main with `tag=v0.2.0`.

### Steps
1. **In `android-release.yml`,** give the setup step:
   ```yaml
   with:
     packages: 'platform-tools'
     log-accepted-android-sdk-licenses: 'false'
   ```
   Add a one-line comment saying why (cmdline-tools 16 has no `tools` package; run 38788684166).
2. **Change nothing else.**

### Tests
None. The lead's manual run is the check.

### Allowed files
- `.github/workflows/android-release.yml`
- `work/T-1595-android-release-setup-fix.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The diff** is limited to the `with:` block and its comment.

---

## Report (written by the worker when done)

### What I did
- In `.github/workflows/android-release.yml` (the only source file changed), added a
  three-line comment above `android-actions/setup-android@v3` explaining why the inputs
  are set, and gave the step a `with:` block:
  ```yaml
  with:
    packages: 'platform-tools'
    log-accepted-android-sdk-licenses: 'false'
  ```
  This overrides the action's default `packages: 'tools platform-tools'`, which fails on
  the runner's cmdline-tools 16.0 because it no longer ships a `tools` package (the
  `v0.2.0` `Android release` run 38788684166 failed there). No other change; the diff is
  limited to the `with:` block and its comment.

### Checks run
- `pnpm install` — Done in 11.3s (only a pre-existing peer-dependency warning for
  `@types/react-dom`).
- `pnpm gate` — output:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No unit tests were run: the task says "Tests: None" and the change is CI YAML only.

### Notes for the lead
- Files changed: `.github/workflows/android-release.yml` and this task file.
- The check is your manual re-run on main with `tag=v0.2.0` (the workflow's
  `workflow_dispatch` `tag` input), as the spec states.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff** is only the setup step's `with:` (`packages: 'platform-tools'`, `log-accepted-android-sdk-licenses: 'false'`) plus a 3-line comment citing run 38788684166.
- **The real check** is the lead's manual run after merge: `gh workflow run android-release.yml --ref main -f tag=v0.2.0`. Its result goes in `work/NOW.md`.
