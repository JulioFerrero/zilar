---
id: T-1608
title: "Android release: if `gh release create` loses the race to images.yml's installer job, fall back to edit + upload --clobber instead of failing the APK job (T-1607 follow-up)"
status: merged
milestone: M5
branch: task/T-1608-android-release-create-race
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1608: Android release survives the release-create race

## Spec (written by Claude, do not edit)

### Why
- **What changed in T-1607:** `images.yml` gained an `installer` job that creates or updates the GitHub Release on a `v*` tag push. Its fallback is race-safe; `android-release.yml` has no matching fallback.
- **The race:** if the installer job creates the release between Android's `gh release view` (a miss) and its `gh release create`, the create fails under `set -euo pipefail`. The APK job then goes red and never uploads the APKs.
- **How likely:** rare (the images take about 15 minutes, the APK job about 22), but loud when it happens.

### Facts (the lead read them on 2026-10-15, main after T-1607)
- `.github/workflows/android-release.yml:206-211`:
  ```sh
  if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
    gh release edit "$RELEASE_TAG" --title "$RELEASE_TAG" --notes-file "$out/notes.md"
    gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber
  else
    gh release create "$RELEASE_TAG" "${assets[@]}" --title "$RELEASE_TAG" --notes-file "$out/notes.md"
  fi
  ```
- **The mirror to copy:** the `installer` job in `.github/workflows/images.yml` (T-1607) does `create`, and if that fails, `upload --clobber`.

### Steps
1. In that block, change the `else` branch so that a failed `create` runs the same `edit` plus `upload --clobber` as the first branch. The Android notes must win: they are the full release notes, while the installer job's are a one-liner.
2. Add a one-line comment naming the race and T-1607.
3. **Change nothing else.**

### Tests
None.

### Allowed files
- `.github/workflows/android-release.yml`
- `work/T-1608-android-release-create-race.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The diff is limited to that block and its comment.**

---

## Report (written by the worker when done)

### What I did

- In `.github/workflows/android-release.yml`, replaced the plain `else` branch of the release-publish block with `elif ! gh release create ...; then`. A failed `create` now runs the same `gh release edit` + `gh release upload --clobber` pair as the first branch, so the Android notes overwrite the installer job's one-liner and the APKs are still uploaded.
- Added one comment line naming the race and T-1607 (mirrors the fallback pattern in `images.yml`).
- Changed nothing else: the diff is limited to lines 209-212 of that file plus the task front matter / Report.

### Checks run

- `pnpm install` (at the start): completed, `Done in 10.7s`. One pre-existing peer warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm gate` from the repo root, real summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (1.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No tests were run: the task says "Tests: None", and the change touches no source code (gate reported `SKIP effect`).

### Notes for the lead

- The spec said "add a one-line comment"; I used a single-line comment. `images.yml`'s equivalent comment is two lines, but I kept one line per the spec.
- As in `images.yml`, if `create` fails for an unrelated reason the `edit` will also fail, so the job still goes red — that matches the existing installer pattern.
- Diff files: `.github/workflows/android-release.yml` and `work/T-1608-android-release-create-race.md`. Both are in Allowed files.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff** is the one block: `else create` became `elif ! create; then edit + upload --clobber`, with a one-line comment naming T-1607. The Android notes win, as asked.
- **Merged before tagging v0.2.1,** so that release can't hit the race.
