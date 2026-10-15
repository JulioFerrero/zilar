---
id: T-1467
title: "Phone builds clear Metro's cache before bundling, so a new expo-router route file is never left out of the APK (found when T-1465's +not-found was missing from the bundle)"
status: merged
milestone: M5
branch: task/T-1467-phone-build-metro-cache
model: auto
effort: default
depends_on: []
estimate: 0.05 day
---

# T-1467: Fresh Metro cache for phone builds

## Spec (written by Claude, do not edit)

### Why
T-1465 added `apps/mobile/src/app/+not-found.tsx`.
- **What went wrong:** `pnpm phone:smoke` built and installed the branch, yet the app still showed Expo's stock "Unmatched Route" page. The APK's `assets/index.android.bundle` held "Chat not found" but no "Page not found" and no `+not-found.tsx`.
- **The fix that worked:** after the lead deleted `$TMPDIR/metro-cache` (66 MB) and rebuilt, the screen was there. Expo Router's route list comes from `require.context`, and Metro's persisted cache kept the old list.
- **Who is affected:** every local build that reuses that cache can silently drop a new route: phone smokes, `pnpm phone:install`, and the local release recipe. CI release builds start on a fresh runner and are not affected.

### Facts (the lead read them on main, 2026-10-15)
- **`scripts/phone/install.sh`** (93 lines) builds in the detached worktree `zilar-phone-build`. It has two paths:
  - **native inputs changed:** `expo prebuild --clean`, then `./gradlew assembleRelease` (`:55-58`);
  - **JS only:** `./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease` (`:66-69`).
  - Neither path touches Metro's cache.
- **`docs/RELEASING.md:51-62`** is the local "prod" Android build recipe, ending in `./gradlew assembleRelease` (`:59`).
- **Metro's cache** lives at `${TMPDIR}/metro-cache` on macOS (`os.tmpdir()`).

### What to build
1. **In `scripts/phone/install.sh`,** right after `cd apps/mobile` (before the `if`), remove Metro's cache:
   - `rm -rf "${TMPDIR:-/tmp}/metro-cache"`;
   - add one comment line saying why: a stale cache drops new expo-router routes.
   - Both build paths then bundle from a clean cache.
2. **In `docs/RELEASING.md`,** add the same `rm -rf "${TMPDIR:-/tmp}/metro-cache"` line to the recipe's code block, before `./gradlew assembleRelease`, with a short comment.
3. Nothing else changes.

### Tests
None (dev script).

### Allowed files
`scripts/phone/install.sh`, `docs/RELEASING.md`, `work/T-1467-phone-build-metro-cache.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's next phone smoke prints no error from the new line.

---

## Report (written by the worker when done)

### What I did
- `scripts/phone/install.sh`: added, right after `cd apps/mobile` and before the `if`, a one-line comment saying a stale cache drops new expo-router routes and `rm -rf "${TMPDIR:-/tmp}/metro-cache"`. Both build paths (native and JS-only) now bundle from a clean Metro cache.
- `docs/RELEASING.md`: added the same comment and `rm -rf "${TMPDIR:-/tmp}/metro-cache"` line to the section 7 recipe code block, between `cd android` and `./gradlew assembleRelease`.
- No other files changed.

### Files changed
- `scripts/phone/install.sh` (lines 54-55)
- `docs/RELEASING.md` (lines 59-60)
- `work/T-1467-phone-build-metro-cache.md` (status + this Report)

### Commands I ran (real results)
- `pnpm install`: Done in 15.2s, 1137 packages; one pre-existing peer-dependency warning (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18), unrelated to this task.
- `bash -n scripts/phone/install.sh`: syntax ok.
- `pnpm gate`: ended with `GATE PASS`, `3 changed file(s) against main`, `scope: every changed file is inside the Allowed files`. Per-check: `PASS install (frozen) (1.7s)`, `PASS format (0.6s)`, `PASS lint (1.0s)`, `PASS typecheck (1.3s)`, `SKIP effect (no source files changed)`.

I ran no unit tests: the spec says none are required for this dev script, and the gate's test step found nothing to run.

### Deviations from the spec
None. The comment in `docs/RELEASING.md` is phrased slightly differently from the one in `install.sh` ("clear it before bundling") because the script comment needs to name the `require.context` cause while the doc line is shorter; both say why. `rm -rf` on a missing path exits 0, so the note in Acceptance that the lead's next phone smoke prints no error from the new line holds, and `set -euo pipefail` is unaffected.

### Open questions
None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- `scripts/phone/install.sh` and the `docs/RELEASING.md` recipe both clear `${TMPDIR:-/tmp}/metro-cache` before bundling, each with a one-line reason.
